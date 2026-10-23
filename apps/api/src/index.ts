import { loggingOptions, sharedEnv } from "@survev/config/env.ts";
import {
    getLogger,
    installCrashHandlers,
    logProcessStart,
    setupServerLogging,
    startProcessStats,
} from "@survev/logger/node.ts";
import { lt } from "drizzle-orm";
import { websocket } from "hono/bun";
import pkgJson from "../../../package.json" with { type: "json" };
import { settings } from "./admin/settings.ts";
import { app } from "./app.ts";
import { db } from "./db/index.ts";
import { sessions } from "./db/schema.ts";
import { env } from "./env.ts";
import { teamMenu } from "./game/teamMenu.ts";
import { cleanupOldPlayerIps } from "./moderation/bans.ts";

// nothing imported above logs while it loads, so logging can be set up here
await setupServerLogging(loggingOptions("api"));
installCrashHandlers();
logProcessStart({ version: pkgJson.version });
startProcessStats(() => ({ teamMenuSockets: teamMenu.socketCount }), sharedEnv.PROCESS_STATS_MS);

const logger = getLogger(["api"]);

await settings.load();
teamMenu.start();

Bun.serve({
    fetch: app.fetch,
    port: env.API_PORT,
    websocket,
    // Bun's default of 10 seconds is too short for some slow database queries
    idleTimeout: 60,
});

// run clean up scripts every midnight
// Bun.cron runs in the system timezone. Keep the try/catch: a throw or rejection
// becomes an uncaughtException/unhandledRejection, which exits the process
Bun.cron("0 0 * * *", async () => {
    try {
        await cleanupOldPlayerIps();
        // better-auth only drops an expired session when it is looked up again
        await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
        logger.info("cleanup.done");
    } catch (err) {
        logger.error("cleanup.failed", { err });
    }
});

logger.info("api.listening", { host: env.API_HOST, port: env.API_PORT });
