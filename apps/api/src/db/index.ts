import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { Config } from "../../config.ts";
import { server } from "../apiServer.ts";
import * as schema from "./schema.ts";

const client = new SQL({
    hostname: Config.database.host,
    port: Config.database.port,
    username: Config.database.user,
    password: Config.database.password,
    database: Config.database.database,
    idleTimeout: 60,
    onconnect: (err) => {
        if (err) {
            server.logger.error("database connection error:", err);
            return;
        }
        server.logger.info("Connected to database");
    },
});

export const db = drizzle({
    client,
    schema,
});

/**
 * Number of rows affected by an update / delete query without .returning()
 * (node-postgres had `rowCount`, Bun SQL results have `count`)
 */
export function rowCount(result: unknown): number {
    return (result as { count?: number }).count ?? 0;
}
