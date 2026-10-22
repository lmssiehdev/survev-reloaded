import { ServerLogger } from "@survev/config/utils/logger.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type ErrorBody, errorResponse, NotFound } from "./errors.ts";
import { GameRouter } from "./routes/GameRouter.ts";
import { PrivateRouter } from "./routes/private/private.ts";
import { StatsRouter } from "./routes/stats/StatsRouter.ts";
import { AuthRouter } from "./routes/user/AuthRouter.ts";
import { UserRouter } from "./routes/user/UserRouter.ts";
import { teamMenu } from "./teamMenu.ts";

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
app.route("/api/auth/", AuthRouter);
app.route("/api/", StatsRouter);
app.route("/api/", GameRouter);
app.route("/private/", PrivateRouter);
app.route("/", teamMenu.router);
