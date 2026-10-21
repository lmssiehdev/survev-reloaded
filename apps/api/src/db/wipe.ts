import { Config } from "@survev/config/serverConfig.ts";
import { SQL } from "bun";

const sql = new SQL({
    hostname: Config.database.host,
    port: Config.database.port,
    username: "postgres",
    password: "postgres",
    database: "postgres",
});

try {
    await sql.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'survev'`,
    );
    await sql.unsafe(`DROP DATABASE IF EXISTS survev`);
    await sql.unsafe(`CREATE DATABASE survev OWNER survev`);
    console.log("Database wiped successfully");
} catch (error) {
    console.error("Error dropping database:", error);
} finally {
    await sql.close();
}
