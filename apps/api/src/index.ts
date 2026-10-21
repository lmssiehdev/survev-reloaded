import { Config } from "@survev/config/serverConfig.ts";
import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { logErrorToWebhook } from "@survev/config/utils/logger.ts";
import { HTTPRateLimit } from "@survev/config/utils/rateLimit.ts";
import { type FindGameResponse, type SiteInfoRes, zFindGameBody } from "@survev/shared/types/api.ts";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import pkgJson from "../../../package.json" with { type: "json" };
import { getFindGamePlayerData } from "./apiHelpers.ts";
import { getHonoIp, verifyTurnstile } from "./apiHelpers.ts";
import { server } from "./apiServer.ts";
import { deleteExpiredSessions } from "./auth/auth.ts";
import { rateLimitMiddleware, sessionMiddleware, validateParams } from "./auth/middleware.ts";
import { banInfo, cleanupOldPlayerIps, findIpBan } from "./bans.ts";
import { type ErrorBody, errorResponse, NotFound } from "./errors.ts";
import { PrivateRouter } from "./routes/private/private.ts";
import { StatsRouter } from "./routes/stats/StatsRouter.ts";
import { AuthRouter } from "./routes/user/AuthRouter.ts";
import { UserRouter } from "./routes/user/UserRouter.ts";
import { isBehindProxy } from "./utils/proxyCheck.ts";

process.on("uncaughtException", async (err) => {
    console.error(err);

    await logErrorToWebhook("server", "API server error:", err);

    process.exit(1);
});

// Bun keeps an inherited "ignore SIGINT" disposition (e.g. when started as a background
// job by a script), Node resets it to the default. Exit on SIGINT like Node does by default
process.on("SIGINT", () => {
    process.exit(130);
});

const app = new Hono();

// a thrown error is a bug, expected failures are Results (see errors.ts)
app.onError((err: unknown, c) => {
    server.logger.error(`${c.req.path} Error:`, err);
    if (err instanceof HTTPException) {
        return err.getResponse();
    }
    return c.json<ErrorBody>({ error: "InternalError", message: "Internal Server Error" }, 500);
});

app.notFound((c) => errorResponse(c, new NotFound({ message: `${c.req.method} ${c.req.path} not found` })));

if (server.logger.config.debugLogs) {
    app.use("*", async (ctx, next) => {
        const url = ctx.req.path;
        server.logger.debug(`start: ${url}`);
        const start = performance.now();
        await next();

        const time = Math.round(performance.now() - start);
        server.logger.debug(`end  : ${url} time: ${time}ms`);
    });
}

app.use(
    "/api/*",
    cors({
        origin: "*",
        credentials: true,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Origin", "Content-Type", "Accept", "X-Requested-With"],
        maxAge: 3600,
    }),
);

// @TODO: figure out the origins for this..
// app.use(csrf())

app.route("/api/user/", UserRouter);
app.route("/api/auth/", AuthRouter);
app.route("/api/", StatsRouter);
app.route("/private/", PrivateRouter);

server.init(app, upgradeWebSocket);

app.get("/api/site_info", (c) => {
    return c.json<SiteInfoRes>(server.getSiteInfo(), 200);
});

// not using the middleware here to not add extra indentation... smh
const findGameRateLimit = new HTTPRateLimit(5, 3000);

app.post("/api/find_game", (c) => {
    return c.json({ error: "invalid_protocol" });
});

app.post("/api/find_game_v2", validateParams(zFindGameBody), sessionMiddleware, async (c) => {
    const ip = getHonoIp(c, Config.apiServer.proxyIPHeader);

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

    const mode = server.modes[body.gameModeIdx];
    if (!mode || !mode.enabled) {
        return c.json<FindGameResponse>({ type: "error", error: "mode_disabled" });
    }

    if (server.captchaEnabled && !user) {
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

    const data = await server.findGame({
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
});

app.post("/api/report_error", rateLimitMiddleware(5, 60 * 1000), async (c) => {
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

// reset player count to 0 if region seems to be down
setInterval(() => {
    for (const regionId in server.regions) {
        const region = server.regions[regionId];
        if (Date.now() - region.lastUpdateTime > 60000) {
            server.logger.warn(
                `Region ${regionId} has not sent player count in more than 60 seconds`,
            );
            region.playerCount = 0;
        }
    }
}, 60000);

Bun.serve({
    fetch: app.fetch,
    port: Config.apiServer.port,
    websocket,
    // Bun's default of 10 seconds is too short for some slow database queries
    idleTimeout: 60,
});

// run clean up scripts every midnight
// Bun.cron runs in the system timezone. Keep the try/catch: a throw or rejection
// becomes an uncaughtException/unhandledRejection, which exits the process
Bun.cron("0 0 * * *", async () => {
    try {
        await cleanupOldPlayerIps();
        await deleteExpiredSessions();
        server.logger.info("Deleted old player IPs and expired sessions");
    } catch (err) {
        server.logger.error("Failed to run cleanup script", err);
    }
});

server.logger.info(`Survev API Server v${pkgJson.version} - GIT ${GIT_VERSION}`);
server.logger.info(`Listening on ${Config.apiServer.host}:${Config.apiServer.port}`);
server.logger.info("Press Ctrl+C to exit.");
