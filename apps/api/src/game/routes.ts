import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { logErrorToWebhook } from "@survev/config/utils/logger.ts";
import { HTTPRateLimit } from "@survev/config/utils/rateLimit.ts";
import { type FindGameResponse, type SiteInfoRes, zFindGameBody } from "@survev/shared/types/api.ts";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { settings } from "../admin/settings.ts";
import { sessionMiddleware } from "../auth/session.ts";
import { env } from "../env.ts";
import { getHonoIp, isBehindProxy, verifyTurnstile } from "../lib/ip.ts";
import { rateLimitMiddleware, validateParams } from "../lib/middleware.ts";
import { banInfo, findIpBan } from "../moderation/bans.ts";
import { findGame, getFindGamePlayerData, siteRegions } from "./regions.ts";

// not using the middleware here to not add extra indentation... smh
const findGameRateLimit = new HTTPRateLimit(5, 3000);

/** what the client needs to show the play menu and join a game */
export const GameRouter = new Hono()
    .get("/site_info", (c) => {
        return c.json<SiteInfoRes>({
            modes: [...settings.modes],
            regions: siteRegions(),
            turnstileSiteKey: env.TURNSTILE_SITE_KEY,
            logins: { discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_SECRET_ID), mock: env.ALLOW_MOCK_ACCOUNT },
            youtube: { name: "", link: "" },
            twitch: [],
            country: "US",
            gitRevision: GIT_VERSION,
            captchaEnabled: settings.captchaEnabled,
            clientTheme: settings.clientTheme,
        }, 200);
    })
    .post("/find_game", (c) => {
        return c.json({ error: "invalid_protocol" });
    })
    .post("/find_game_v2", validateParams(zFindGameBody), sessionMiddleware, async (c) => {
        const ip = getHonoIp(c, env.PROXY_IP_HEADER);

        if (!ip) {
            return c.json<FindGameResponse>({ type: "error", error: "invalid_ip" }, 500);
        }

        if (findGameRateLimit.isRateLimited(ip)) {
            return c.json<FindGameResponse>({ type: "error", error: "rate_limited" }, 429);
        }

        const ban = await findIpBan(ip);
        if (ban) {
            return c.json<FindGameResponse>({ type: "banned", ...banInfo(ban) });
        }

        const joinToken = randomUUID();
        // banned accounts can still play, just not as their account
        const user = c.var.user?.banned ? null : c.var.user;

        if (await isBehindProxy(ip, !user)) {
            return c.json<FindGameResponse>({ type: "error", error: "behind_proxy" });
        }

        const body = c.req.valid("json");

        const mode = settings.modes[body.gameModeIdx];
        if (!mode || !mode.enabled) {
            return c.json<FindGameResponse>({ type: "error", error: "mode_disabled" });
        }

        if (settings.captchaEnabled && !user) {
            if (!body.turnstileToken) {
                return c.json<FindGameResponse>({ type: "error", error: "invalid_captcha" });
            }

            const captcha = await verifyTurnstile(body.turnstileToken, ip);
            if (captcha.isErr()) {
                return c.json<FindGameResponse>({ type: "error", error: "invalid_captcha" }, 500);
            }
            if (!captcha.value) {
                return c.json<FindGameResponse>({ type: "error", error: "invalid_captcha" });
            }
        }

        const playerData = await getFindGamePlayerData([
            {
                joinToken,
                userId: user?.id || null,
                ip,
            },
        ]);

        const data = await findGame({
            region: body.region,
            version: body.version,
            mapName: mode.mapName,
            teamMode: mode.teamMode,
            autoFill: true,
            playerData,
        });

        if ("error" in data) {
            return c.json<FindGameResponse>({ type: "error", error: data.error });
        }

        return c.json<FindGameResponse>({
            type: "success",
            res: {
                joinToken,
                urls: data.urls,
            },
        });
    })
    .post("/report_error", rateLimitMiddleware(5, 60 * 1000), async (c) => {
        const content = await c.req.json();

        let stackTrace: string | undefined;
        if (
            typeof content.data === "object"
            && "stacktrace" in content.data
            && typeof content.data.stacktrace === "string"
            && content.data.stacktrace
        ) {
            stackTrace = `### Stacktrace:\n \`\`\`${content.data.stacktrace.replaceAll("`", "\\`")}\`\`\``;
            delete content.data.stacktrace;
        }

        if (stackTrace) {
            logErrorToWebhook("client", content, stackTrace);
        } else {
            logErrorToWebhook("client", content);
        }
        return c.json({ success: true }, 200);
    });
