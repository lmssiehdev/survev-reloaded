// Applies the drizzle migrations, `bun run db:migrate` from source and on container start from dist
// (the build copies src/db/drizzle to dist/drizzle, next to dist/migrate.js)
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import postgres from "postgres";
import { env } from "../env.ts";

const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
    await migrate(drizzle({ client }), {
        migrationsFolder: path.resolve(import.meta.dirname, "drizzle"),
    });
    console.log("Migrations applied successfully");
} finally {
    await client.end();
}
