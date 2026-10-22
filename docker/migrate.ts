// Applies the API's drizzle migrations on container start (same journal table as `bun run db:migrate`,
// which needs drizzle-kit, a dev dependency). Bundled to apps/api/dist/migrate.js by the Dockerfile,
// the migrations are copied to apps/api/dist/drizzle.
import { Config } from "@survev/config/serverConfig.ts";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import postgres from "postgres";

if (Config.database.enabled) {
    const client = postgres({
        host: Config.database.host,
        port: Config.database.port,
        username: Config.database.user,
        password: Config.database.password,
        database: Config.database.database,
        max: 1,
        onnotice: () => {},
    });
    try {
        await migrate(drizzle({ client }), {
            migrationsFolder: path.resolve(import.meta.dirname, "drizzle"),
        });
        console.log("Migrations applied successfully");
    } finally {
        await client.end();
    }
}
