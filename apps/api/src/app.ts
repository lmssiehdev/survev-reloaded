import { HTTPRateLimit } from "@survev/config/utils/rateLimit.ts";
import { getLogger, withContext } from "@survev/logger/node.ts";
import { Elysia, NotFound, ParseError, status, ValidationError } from "elysia";
import { autoHead } from "elysia/auto-head";
import { AdminPrivateRoutes } from "./admin/privateRoutes.ts";
import { auth, trustedOrigins } from "./auth/auth.ts";
import { GamePrivateRoutes } from "./game/privateRoutes.ts";
import { GameRoutes } from "./game/routes.ts";
import { TeamMenuRoutes } from "./game/teamMenu/routes.ts";
import { type ErrorBody, errorResponse, InvalidParams, isApiError } from "./lib/errors.ts";
import { macros } from "./lib/macros.ts";
import { noteRequest, trackRequest } from "./lib/requestLog.ts";
import { ModerationPrivateRoutes } from "./moderation/privateRoutes.ts";
import { OgRoutes } from "./og/routes.ts";
import { PassPrivateRoutes } from "./pass/privateRoutes.ts";
import { StatsPrivateRoutes } from "./stats/privateRoutes.ts";
import { StatsRoutes } from "./stats/routes.ts";
import { UserRoutes } from "./user/routes.ts";

const logger = getLogger(["api", "http"]);

/** /private: only the game server and the discord bot call these, both send the api key */
const privateRoutes = new Elysia({ prefix: "/private" })
    .use(macros)
    .guard({ private: true })
    .use(GamePrivateRoutes)
    .use(PassPrivateRoutes)
    .use(StatsPrivateRoutes)
    .use(ModerationPrivateRoutes)
    .use(AdminPrivateRoutes);

export type PrivateRouteApp = typeof privateRoutes;

/** the JSON routes the client calls through its Eden client */
const publicRoutes = new Elysia()
    .use(UserRoutes)
    .use(StatsRoutes)
    .use(GameRoutes);

export type PublicRouteApp = typeof publicRoutes;

// better-auth's own endpoints: /sign-in/social, /callback/discord, /sign-out, /mock (dev)
// parse: "none" leaves the body to better-auth
const authRateLimit = new HTTPRateLimit(5, 60 * 1000);
const authRoutes = new Elysia({ prefix: "/api/auth" })
    .use(macros)
    .guard({ rateLimit: authRateLimit, parse: "none" })
    .get("/*", ({ request }) => auth.handler(request))
    .post("/*", ({ request }) => auth.handler(request));

/** every route; importing this starts nothing, index.ts serves it and starts the timers */
export const app = new Elysia({ strictPath: true })
    // outermost, so it also sees the response onError builds. Everything inside runs with the requestId in the log context
    .wrap((fetch) => (request: Request, ...rest: unknown[]) => {
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return fetch(request, ...rest);
        return withContext({ requestId: crypto.randomUUID() }, async () => {
            const start = performance.now();
            const info = trackRequest(request);
            const res = await fetch(request, ...rest);
            logger[res.status >= 500 ? "error" : "info"]("http.request", {
                method: request.method,
                // no route matched (404, CORS preflight): a constant, the path would be unbounded
                route: info.route ?? "*",
                status: res.status,
                durationMs: Math.round(performance.now() - start),
                userId: info.userId,
            });
            return res;
        });
    })
    // the pattern of the matched route, `route` is only set for dynamic ones. The hook runs for every matched route
    .onTransform("global", ({ request, route, path }) => {
        noteRequest(request, { route: route ?? path });
    })
    // expected failures are returned (or thrown by a macro) ApiErrors, any other error is a bug
    .onError("global", ({ error, request, route, path }) => {
        // parse errors happen before onTransform. A NotFound matched no route, `path` is just the URL
        if (!(error instanceof NotFound)) noteRequest(request, { route: route ?? path });

        if (isApiError(error)) return errorResponse(error);
        if (error instanceof ValidationError) {
            return errorResponse(new InvalidParams({ message: "Invalid params", issues: error.errors }));
        }
        if (error instanceof NotFound) {
            return status(
                404,
                { error: "NotFound", message: `${request.method} ${path} not found` } satisfies ErrorBody,
            );
        }
        // the body hono sent for invalid json
        if (error instanceof ParseError) {
            return new Response("Malformed JSON in request body", { status: 400 });
        }
        logger.error("http.unhandled", { err: error, route: route ?? path });
        return status(500, { error: "InternalError", message: "Internal Server Error" } satisfies ErrorBody);
    })
    // CORS for /api only. @elysia/cors can't be limited to a path
    // and sends extra headers (vary: *, every request header as expose-headers)
    .onRequest(({ request, set }) => {
        const { pathname } = new URL(request.url);
        if (pathname !== "/api" && !pathname.startsWith("/api/")) return;
        // browsers drop cookies on a `*` answer: the origins better-auth trusts get theirs echoed back
        const origin = request.headers.get("origin");
        if (origin && trustedOrigins.includes(origin)) {
            set.headers["access-control-allow-origin"] = origin;
            set.headers["access-control-allow-credentials"] = "true";
        } else {
            set.headers["access-control-allow-origin"] = "*";
        }
        set.headers.vary = "Origin";
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    ...set.headers as Record<string, string>,
                    "access-control-max-age": "3600",
                    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
                    "access-control-allow-headers": "Origin,Content-Type,Accept,X-Requested-With",
                    vary: "Origin, Access-Control-Request-Headers",
                },
            });
        }
    });

// @TODO: figure out the origins for this..
// app.use(csrf())

app
    .use(publicRoutes)
    .use(authRoutes)
    .use(OgRoutes)
    .use(privateRoutes)
    .use(TeamMenuRoutes)
    // HEAD for every GET route, like hono
    .use(autoHead());
