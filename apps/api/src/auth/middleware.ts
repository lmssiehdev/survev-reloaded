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

/**
 * better-auth's hono session middleware: sets `user` / `session` (null when logged out, banned users included).
 * returnHeaders: getSession extends active sessions, the refreshed cookie has to reach the browser too.
 */
export const sessionMiddleware = createMiddleware<SessionEnv>(async (c, next) => {
    const res = Config.database.enabled
        ? await auth.api
            .getSession({ headers: c.req.raw.headers, returnHeaders: true })
            .catch((err) => void logger.error("Failed to load session", err))
        : undefined;

    for (const cookie of res?.headers.getSetCookie() ?? []) {
        c.header("set-cookie", cookie, { append: true });
    }
    c.set("user", res?.response?.user ?? null);
    c.set("session", res?.response?.session ?? null);
    await next();
});

/** use after sessionMiddleware: 401 when logged out */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.get("user")) {
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
