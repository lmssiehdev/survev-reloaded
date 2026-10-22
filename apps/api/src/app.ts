import { ServerLogger } from "@survev/config/utils/logger.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { PrivateRouter } from "./admin/routes.ts";
import { auth } from "./auth/auth.ts";
import { GameRouter } from "./game/routes.ts";
import { teamMenu } from "./game/teamMenu.ts";
import { type ErrorBody, errorResponse, NotFound } from "./lib/errors.ts";
import { databaseEnabledMiddleware, rateLimitMiddleware } from "./lib/middleware.ts";
import { StatsRouter } from "./stats/routes.ts";
import { UserRouter } from "./user/routes.ts";

const logger = new ServerLogger("Server");

/** every route; importing this starts nothing, index.ts serves it and starts the timers */
export const app = new Hono();

// a thrown error is a bug, expected failures are Results (see errors.ts)
app.onError((err: unknown, c) => {
    logger.error(`${c.req.path} Error:`, err);
    if (err instanceof HTTPException) {
        return err.getResponse();
    }
    return c.json<ErrorBody>({ error: "InternalError", message: "Internal Server Error" }, 500);
});

app.notFound((c) => errorResponse(c, new NotFound({ message: `${c.req.method} ${c.req.path} not found` })));

if (logger.config.debugLogs) {
    app.use("*", async (ctx, next) => {
        const url = ctx.req.path;
        logger.debug(`start: ${url}`);
        const start = performance.now();
        await next();

        const time = Math.round(performance.now() - start);
        logger.debug(`end  : ${url} time: ${time}ms`);
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
// better-auth's own endpoints: /sign-in/social, /callback/discord, /sign-out, /mock (dev)
app.use("/api/auth/*", databaseEnabledMiddleware, rateLimitMiddleware(5, 60 * 1000));
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/", StatsRouter);
app.route("/api/", GameRouter);
app.route("/private/", PrivateRouter);
app.route("/", teamMenu.router);
