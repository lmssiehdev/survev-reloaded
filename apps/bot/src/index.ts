import { loggingOptions } from "@survev/config/env.ts";
import { flushLogs, installCrashHandlers, logProcessStart, setupServerLogging } from "@survev/logger/node.ts";
import { Client, Events, GatewayIntentBits, type InteractionReplyOptions, MessageFlags } from "discord.js";
import { sendNoPermissionMessage } from "./commands/helpers.ts";
import { commandHandlers } from "./commands/index.ts";
import { env } from "./env.ts";
import { botLogger, type Command, hasBotPermission } from "./utils.ts";

await setupServerLogging(loggingOptions("bot"));
installCrashHandlers();
logProcessStart();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function setupInteractionHandlers() {
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        if (!hasBotPermission(interaction)) {
            await sendNoPermissionMessage(interaction);
            return;
        }

        const commandName = interaction.commandName as Command;
        if (!commandHandlers[commandName]) {
            botLogger.warn("bot.unknown_command", { commandName });
            return;
        }
        try {
            await commandHandlers[commandName](interaction);
        } catch (error) {
            botLogger.error("bot.command_failed", { commandName, err: error });
            const errorMessage: InteractionReplyOptions = {
                content: "There was an error while executing this command!",
                flags: MessageFlags.Ephemeral,
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    });
}

try {
    client.once(Events.ClientReady, (readyClient) => {
        botLogger.info("bot.ready", { tag: readyClient.user.tag });
    });
    setupInteractionHandlers();
    await client.login(env.DISCORD_BOT_TOKEN);
} catch (error) {
    botLogger.error("bot.start_failed", { err: error });
    await flushLogs();
    process.exit(1);
}
