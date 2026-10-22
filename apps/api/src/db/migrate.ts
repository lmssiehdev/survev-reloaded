// Applies the drizzle migrations to the sqlite file from the config, creating it if needed
import { Config } from "@survev/config/serverConfig.ts";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import { db } from "./index.ts";

try {
    migrate(db, {
        migrationsFolder: path.resolve(import.meta.dirname, "drizzle"),
    });
    console.log(`Migrations applied successfully to ${Config.database.file}`);
} finally {
    db.$client.close();
}
