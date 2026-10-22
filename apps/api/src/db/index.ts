import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { relations } from "./relations.ts";

const logger = new ServerLogger("Database");

// postgres.js connects lazily, on the first query
const client = postgres({
    host: Config.database.host,
    port: Config.database.port,
    username: Config.database.user,
    password: Config.database.password,
    database: Config.database.database,
    idle_timeout: 60,
    onnotice: (notice) => logger.info("database notice:", notice.message),
});

export const db = drizzle({
    client,
    relations,
});
