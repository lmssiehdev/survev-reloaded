import { zValidator } from "@hono/zod-validator";
import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import { HTTPRateLimit } from "@survev/config/utils/rateLimit.ts";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { getHonoIp } from "../apiHelpers.ts";
import { auth, type AuthSession, type AuthUser } from "./auth.ts";

const logger = new ServerLogger("Auth");

export type AuthEnv = {
    Variables: {
        user: AuthUser;
        session: AuthSession;
    };
};

/** rejects requests without a valid session; forwards refreshed session cookies */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
    const { headers, response } = await auth.api.getSession({
        headers: c.req.raw.headers,
        returnHeaders: true,
    });
    for (const cookie of headers.getSetCookie()) {
        c.header("set-cookie", cookie, { append: true });
    }

    if (!response) {
        return c.json({ error: "Authentication failed" }, 401);
    }

    c.set("user", response.user);
    c.set("session", response.session);
    await next();
});

/** the logged in, non banned user of a request, if any; never throws */
export async function getOptionalUser(headers: Headers): Promise<AuthUser | null> {
    if (!Config.database.enabled) return null;
    try {
        const res = await auth.api.getSession({ headers });
        return res && !res.user.banned ? res.user : null;
    } catch (err) {
        logger.error("Failed to validate session", err);
        return null;
    }
}

/**
 * middleware for validating JSON request parameters against a Zod schema.
 */
export function validateParams<Schema extends z.ZodSchema>(
    schema: Schema,
    response?: object,
) {
    return zValidator("json", schema, (result, c) => {
        if (!result.success) {
            return c.json(
                response ?? {
                    error: "Invalid params",
                    issues: result.error.issues,
                },
                400,
            );
        }
    });
}

export async function databaseEnabledMiddleware(c: Context, next: Next) {
    if (!Config.database.enabled) {
        return c.json({ error: "Database is disabled" }, 403);
    }
    await next();
}

export async function privateMiddleware(c: Context, next: Next) {
    if (c.req.header("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
        return c.json({ error: "Forbidden" }, 403);
    }
    await next();
}

export function rateLimitMiddleware(limit: number, interval: number) {
    const rateLimit = new HTTPRateLimit(limit, interval);

    return async function(c: Context, next: Next) {
        const ip = getHonoIp(c, Config.apiServer.proxyIPHeader);

        if (!ip) {
            return c.json({ error: "invalid_ip" }, 500);
        }

        if (rateLimit.isRateLimited(ip)) {
            return c.json({ error: "rate_limited" }, 429);
        }

        await next();
    };
}
