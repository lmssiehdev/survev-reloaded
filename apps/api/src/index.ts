import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { logErrorToWebhook, ServerLogger } from "@survev/config/utils/logger.ts";
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
        logger.info("Deleted old player IPs and expired sessions");
    } catch (err) {
        logger.error("Failed to run cleanup script", err);
    }
});

logger.info(`Survev API Server v${pkgJson.version} - GIT ${GIT_VERSION}`);
logger.info(`Listening on ${env.API_HOST}:${env.API_PORT}`);
logger.info("Press Ctrl+C to exit.");
