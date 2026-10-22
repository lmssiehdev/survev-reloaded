import { Config } from "@survev/config/serverConfig.ts";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "src/db/schema.ts",
    out: "./src/db/drizzle",
    dbCredentials: {
        url: Config.database.file,
    },
});
