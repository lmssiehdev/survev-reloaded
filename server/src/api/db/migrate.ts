// Applies drizzle migrations with Bun SQL.
// drizzle-kit migrate needs the `pg` or `postgres` driver package installed,
// this uses the same migrations journal table without any extra dependency.
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import path from "node:path";
import { Config } from "../../config.ts";

const client = new SQL({
    hostname: Config.database.host,
    port: Config.database.port,
    username: Config.database.user,
    password: Config.database.password,
    database: Config.database.database,
});

try {
    await migrate(drizzle({ client }), {
        migrationsFolder: path.resolve(import.meta.dirname, "drizzle"),
    });
    console.log("Migrations applied successfully");
} finally {
    await client.close();
}
