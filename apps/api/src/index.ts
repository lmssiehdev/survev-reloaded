import { Config } from "@survev/config/serverConfig.ts";
import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { logErrorToWebhook, ServerLogger } from "@survev/config/utils/logger.ts";
import { websocket } from "hono/bun";
import pkgJson from "../../../package.json" with { type: "json" };
import { app } from "./app.ts";
import { deleteExpiredSessions } from "./auth/auth.ts";
import { cleanupOldPlayerIps } from "./bans.ts";
import { watchRegions } from "./regions.ts";
import { teamMenu } from "./teamMenu.ts";

const logger = new ServerLogger("Server");

process.on("uncaughtException", async (err) => {
    console.error(err);

    await logErrorToWebhook("server", "API server error:", err);

    process.exit(1);
});

// Bun keeps an inherited "ignore SIGINT" disposition (e.g. when started as a background
// job by a script), Node resets it to the default. Exit on SIGINT like Node does by default
process.on("SIGINT", () => {
    process.exit(130);
});

watchRegions();
teamMenu.start();

Bun.serve({
    fetch: app.fetch,
    port: Config.apiServer.port,
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
        await deleteExpiredSessions();
        logger.info("Deleted old player IPs and expired sessions");
    } catch (err) {
        logger.error("Failed to run cleanup script", err);
    }
});

logger.info(`Survev API Server v${pkgJson.version} - GIT ${GIT_VERSION}`);
logger.info(`Listening on ${Config.apiServer.host}:${Config.apiServer.port}`);
logger.info("Press Ctrl+C to exit.");
