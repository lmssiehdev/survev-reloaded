import { zValidator } from "@hono/zod-validator";
import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import { HTTPRateLimit } from "@survev/config/utils/rateLimit.ts";
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { getHonoIp } from "../apiHelpers.ts";
import { errorResponse, Forbidden, InvalidParams, RateLimited, Unauthorized } from "../errors.ts";
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
    c.set("user", null);
    c.set("session", null);
    if (!Config.database.enabled) return next();

    const res = await auth.api
        .getSession({ headers: c.req.raw.headers, returnHeaders: true })
        .catch((err) => void logger.error("Failed to load session", err));

    for (const cookie of res?.headers.getSetCookie() ?? []) {
        c.header("set-cookie", cookie, { append: true });
    }
    if (res?.response) {
        c.set("user", res.response.user);
        c.set("session", res.response.session);
    }
    await next();
});

/** use after sessionMiddleware: 401 when logged out */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.get("user")) {
        return errorResponse(c, new Unauthorized({ message: "Authentication failed" }));
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
            // plain Response: keep the error out of the typed client's route outputs
            const res: Response = response
                ? c.json(response, 400)
                : errorResponse(c, new InvalidParams({ message: "Invalid params", issues: result.error.issues }));
            return res;
        }
    });
}

export async function databaseEnabledMiddleware(c: Context, next: Next) {
    if (!Config.database.enabled) {
        return errorResponse(c, new Forbidden({ message: "Database is disabled" }));
    }
    await next();
}

export async function privateMiddleware(c: Context, next: Next) {
    if (c.req.header("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
        return errorResponse(c, new Forbidden({ message: "Invalid API key" }));
    }
    await next();
}

export function rateLimitMiddleware(limit: number, interval: number) {
    const rateLimit = new HTTPRateLimit(limit, interval);

    return async function(c: Context, next: Next) {
        const ip = getHonoIp(c, Config.apiServer.proxyIPHeader);

        if (!ip) {
            return errorResponse(c, new InvalidParams({ message: "Invalid IP" }));
        }

        if (rateLimit.isRateLimited(ip)) {
            return errorResponse(c, new RateLimited({ message: "Rate limited" }));
        }

        await next();
    };
}
