import { ServerLogger } from "@survev/config/utils/logger.ts";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import { relations } from "./relations.ts";

const logger = new ServerLogger("Database");

// postgres.js connects lazily, on the first query
const client = postgres(env.DATABASE_URL, {
    idle_timeout: 60,
    onnotice: (notice) => logger.info("database notice:", notice.message),
});

export const db = drizzle({
    client,
    relations,
});
