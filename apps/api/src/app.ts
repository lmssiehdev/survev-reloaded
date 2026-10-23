import { getLogger, withContext } from "@survev/logger/node.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { AdminPrivateRouter } from "./admin/privateRoutes.ts";
import { auth } from "./auth/auth.ts";
import { GamePrivateRouter } from "./game/privateRoutes.ts";
import { GameRouter } from "./game/routes.ts";
import { teamMenu } from "./game/teamMenu.ts";
import { type ErrorBody, errorResponse, NotFound } from "./lib/errors.ts";
import { privateMiddleware, rateLimitMiddleware } from "./lib/middleware.ts";
import { ModerationPrivateRouter } from "./moderation/privateRoutes.ts";
import { PassPrivateRouter } from "./pass/privateRoutes.ts";
import { StatsPrivateRouter } from "./stats/privateRoutes.ts";
import { StatsRouter } from "./stats/routes.ts";
import { UserRouter } from "./user/routes.ts";

const logger = getLogger(["api", "http"]);

/** /private: only the game server and the discord bot call these, both send the api key */
const privateRouter = new Hono()
    .use(privateMiddleware)
    .route("/", GamePrivateRouter)
    .route("/", PassPrivateRouter)
    .route("/", StatsPrivateRouter)
    .route("/", ModerationPrivateRouter)
    .route("/", AdminPrivateRouter);

export type PrivateRouteApp = typeof privateRouter;

/** every route; importing this starts nothing, index.ts serves it and starts the timers */
export const app = new Hono();

// a thrown error is a bug, expected failures are Results (see errors.ts)
app.onError((err: unknown, c) => {
    if (err instanceof HTTPException && err.status < 500) {
        return err.getResponse();
    }
    logger.error("http.unhandled", { err, route: routePath(c) });
    return c.json<ErrorBody>({ error: "InternalError", message: "Internal Server Error" }, 500);
});

app.notFound((c) => errorResponse(c, new NotFound({ message: `${c.req.method} ${c.req.path} not found` })));

/** the session middleware only runs on some routes, `user` is unset elsewhere */
type MaybeUserEnv = { Variables: { user?: { id: string } | null } };

// outermost, so it also sees the response onError builds. Everything inside runs with the requestId in the log context
app.use(
    "*",
    createMiddleware<MaybeUserEnv>(async (c, next) => {
        if (c.req.header("upgrade")?.toLowerCase() === "websocket") return next();
        await withContext({ requestId: crypto.randomUUID() }, async () => {
            const start = performance.now();
            await next();
            const status = c.res.status;
            logger[status >= 500 ? "error" : "info"]("http.request", {
                method: c.req.method,
                route: routePath(c),
                status,
                durationMs: Math.round(performance.now() - start),
                userId: c.get("user")?.id,
            });
        });
    }),
);

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
// better-auth's own endpoints: /sign-in/social, /callback/discord, /sign-out, /mock (dev)
app.use("/api/auth/*", rateLimitMiddleware(5, 60 * 1000));
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/", StatsRouter);
app.route("/api/", GameRouter);
app.route("/private/", privateRouter);
app.route("/", teamMenu.router);
