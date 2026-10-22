import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { relations } from "./relations.ts";

const logger = new ServerLogger("Database");

const client = new SQL({
    hostname: Config.database.host,
    port: Config.database.port,
    username: Config.database.user,
    password: Config.database.password,
    database: Config.database.database,
    idleTimeout: 60,
    onconnect: (err) => {
        if (err) {
            logger.error("database connection error:", err);
            return;
        }
        logger.info("Connected to database");
    },
});

export const db = drizzle({
    client,
    relations,
});

/**
 * Number of rows affected by an update / delete query without .returning()
 * (node-postgres had `rowCount`, Bun SQL results have `count`)
 */
export function rowCount(result: unknown): number {
    return (result as { count?: number }).count ?? 0;
}
