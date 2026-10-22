import { Config } from "@survev/config/serverConfig.ts";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "src/db/schema.ts",
    out: "./src/db/drizzle",
    dbCredentials: {
        ...Config.database,
        ssl: false,
    },
});
