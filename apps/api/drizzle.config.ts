import { defineConfig } from "drizzle-kit";
import { env } from "./src/env.ts";

export default defineConfig({
    dialect: "postgresql",
    schema: "src/db/schema.ts",
    out: "./src/db/drizzle",
    dbCredentials: { url: env.DATABASE_URL },
});
