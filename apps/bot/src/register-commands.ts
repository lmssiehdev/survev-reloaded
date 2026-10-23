import { loggingOptions } from "@survev/config/env.ts";
import { flushLogs, setupServerLogging } from "@survev/logger/node.ts";
import { REST, Routes } from "discord.js";
import { commandsToRegister } from "./commands/index.ts";
import { env } from "./env.ts";
import { botLogger } from "./utils.ts";

await setupServerLogging(loggingOptions("bot"));

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
    try {
        botLogger.info("bot.commands_refresh_started");
        await rest.put(
            Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
            {
                body: commandsToRegister.map((command) => command.toJSON()),
            },
        );
        botLogger.info("bot.commands_refreshed");
    } catch (error) {
        botLogger.error("bot.commands_refresh_failed", { err: error });
    }
}

await registerCommands();
await flushLogs();
