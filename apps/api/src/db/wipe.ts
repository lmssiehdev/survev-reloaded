import postgres from "postgres";
import { env } from "../env.ts";

// drops and recreates the database in DATABASE_URL, connecting to the "postgres" database as the same user
const url = new URL(env.DATABASE_URL);
const name = url.pathname.slice(1);
const owner = decodeURIComponent(url.username);
url.pathname = "/postgres";

const sql = postgres(url.toString(), { max: 1 });

try {
    await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name}`;
    await sql`DROP DATABASE IF EXISTS ${sql(name)}`;
    await sql`CREATE DATABASE ${sql(name)} OWNER ${sql(owner)}`;
    console.log("Database wiped successfully");
} catch (error) {
    console.error("Error dropping database:", error);
} finally {
    await sql.end();
}
