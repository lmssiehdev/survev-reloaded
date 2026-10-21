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

export type SessionEnv = {
    Variables: {
        user: AuthUser | null;
        session: AuthSession | null;
    };
};

export type AuthEnv = {
    Variables: {
        user: AuthUser;
        session: AuthSession;
    };
};

/** sets the request's user + session (null when logged out) and forwards refreshed session cookies */
async function loadSession(c: Context) {
    const { headers, response } = await auth.api.getSession({
        headers: c.req.raw.headers,
        returnHeaders: true,
    });
    for (const cookie of headers.getSetCookie()) {
        c.header("set-cookie", cookie, { append: true });
    }
    c.set("user", response?.user ?? null);
    c.set("session", response?.session ?? null);
    return response;
}

/**
 * Optional session, for routes that also serve anonymous players.
 * Banned users are still set; a failing session lookup counts as logged out.
 */
export const sessionMiddleware = createMiddleware<SessionEnv>(async (c, next) => {
    c.set("user", null);
    c.set("session", null);
    if (Config.database.enabled) {
        await loadSession(c).catch((err) => logger.error("Failed to load session", err));
    }
    await next();
});

/** required session: 401 when logged out */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
    if (!(await loadSession(c))) {
        return c.json({ error: "Authentication failed" }, 401);
    }
    await next();
});

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
