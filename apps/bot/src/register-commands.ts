import { REST, Routes } from "discord.js";
import { commandsToRegister } from "./commands/index.ts";
import { env } from "./env.ts";
import { botLogger } from "./utils.ts";

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
    try {
        botLogger.info("Started refreshing application (/) commands.");
        await rest.put(
            Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
            {
                body: commandsToRegister.map((command) => command.toJSON()),
            },
        );
        botLogger.info("Successfully reloaded application (/) commands.");
    } catch (error) {
        botLogger.error("Failed to refresh application commands:", error);
    }
}

await registerCommands();
