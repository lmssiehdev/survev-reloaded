import { parseEnv } from "@survev/config/env.ts";
import { z } from "zod";

/** the bot's environment variables, documented in .env.example */
export const env = parseEnv({
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_GUILD_ID: z.string().min(1),
    /** members with this role can use the commands */
    DISCORD_ROLE_ID: z.string().min(1),
    API_URL: z.url().default("http://127.0.0.1:8000"),
    /** the website's public URL, spectate links point to it */
    PUBLIC_URL: z.url().default("http://127.0.0.1:3000"),
});
