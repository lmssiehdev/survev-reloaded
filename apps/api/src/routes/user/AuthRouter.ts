import { Config } from "@survev/config/serverConfig.ts";
import { Hono } from "hono";
import { auth, isProviderEnabled, type SocialProvider } from "../../auth/auth.ts";
import { databaseEnabledMiddleware, rateLimitMiddleware } from "../../auth/middleware.ts";

/**
 * Keeps the client facing URLs from before better-auth:
 * GET /api/auth/{discord,google} starts a login, GET /api/auth/{discord,google}/callback finishes it.
 * Everything else under /api/auth is better-auth's own handler (sign-out, mock login, ...).
 */
export const AuthRouter = new Hono()
    .use(databaseEnabledMiddleware)
    .use(rateLimitMiddleware(5, 60 * 1000))
    .get("/:provider{discord|google}", async (c) => {
        const provider = c.req.param("provider") as SocialProvider;
        if (!isProviderEnabled(provider)) {
            return c.text(`${provider} login is not supported`, 500);
        }

        const res = await auth.api.signInSocial({
            body: { provider, callbackURL: Config.oauthBasePath, errorCallbackURL: Config.oauthBasePath },
            headers: c.req.raw.headers,
            returnHeaders: true,
        });

        // the oauth state cookie has to reach the browser together with the redirect
        for (const cookie of res.headers.getSetCookie()) {
            c.header("set-cookie", cookie, { append: true });
        }
        return c.redirect(res.response.url!);
    })
    .get("/:provider{discord|google}/callback", (c) => {
        const url = new URL(c.req.url);
        url.pathname = `/api/auth/callback/${c.req.param("provider")}`;
        return auth.handler(new Request(url, c.req.raw));
    })
    .on(["GET", "POST"], "/*", (c) => auth.handler(c.req.raw));
