import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import { createMiddleware } from "hono/factory";
import { errorResponse, Unauthorized } from "../lib/errors.ts";
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
