import type { PrivateRouteApp } from "@survev/api/types";
import { sharedEnv } from "@survev/config/env.ts";
import { getLogger } from "@survev/logger/node.ts";
import type {
    ButtonInteraction,
    ComponentType,
    Interaction,
    Message,
    RepliableInteraction,
    StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { hc } from "hono/client";
import { env } from "./env.ts";

// we love enums
export const enum Command {
    BanIp = "ban_ip",
    FindDiscordUserSlug = "find_discord_user_slug",
    BanAccount = "ban_account",
    SearchPlayer = "search_player",
    SpectatePlayer = "spectate_player",
    UnbanAccount = "unban_account",
    UnbanIp = "unban_ip",
    SetMatchDataName = "set_match_data_name",
    SetAccountName = "set_account_name",
    GiveItem = "give_item",
    RemoveItem = "remove_item",
    SetGameMode = "set_game_mode",
    SetClientTheme = "set_client_theme",
    ResetPass = "reset_pass",
    GiveXp = "give_xp",
    LogoutFromGame = "logout_from_game",
    ResetStats = "reset_stats",
    ClearCache = "clear_cache",
}

export const honoClient = hc<PrivateRouteApp>(`${env.API_URL}/private`, {
    headers: {
        "survev-api-key": sharedEnv.SURVEV_API_KEY,
    },
});

export function isAdmin(interaction: Interaction) {
    if (interaction.guild?.id !== env.DISCORD_GUILD_ID) {
        return false;
    }

    if (interaction.inCachedGuild()) {
        return interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    }

    return false;
}

export function hasBotPermission(interaction: Interaction): boolean {
    if (interaction.guild?.id !== env.DISCORD_GUILD_ID) {
        return false;
    }

    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    if (interaction.inCachedGuild()) {
        return interaction.member.roles.cache.has(env.DISCORD_ROLE_ID);
    }

    return false;
}

const TIMEOUT_IN_SECONDS = 60;

/**
 * generic collector that handles timeouts and only allows interactions buy the original user
 */
export function createCollector<
    T extends ButtonInteraction | StringSelectMenuInteraction,
>({
    response,
    onCollect,
    options,
}: {
    response: Message;
    onCollect: (interaction: T) => Promise<void>;
    options: {
        interaction: RepliableInteraction;
        originalUserId: string;
        componentType: ComponentType.Button | ComponentType.StringSelect;
    };
}) {
    const collector = response.createMessageComponentCollector({
        filter: (i) => i.user.id === options.originalUserId,
        componentType: options.componentType,
        time: TIMEOUT_IN_SECONDS * 1000,
    });

    collector.on("collect", async (interaction: T) => {
        await onCollect(interaction);
        collector.stop("completed");
    });

    collector.on("ignore", async (interaction: RepliableInteraction) => {
        await interaction.reply({
            content: "You are not the original creator. Please create a new command.",
            flags: MessageFlags.Ephemeral,
        });
    });

    collector.on("end", async (_, reason) => {
        if (reason === "time") {
            await options.interaction.editReply({
                content: "Timed out, please try again.",
                components: [],
                embeds: [],
            });
            return;
        }
    });
}

export const botLogger = getLogger(["bot"]);

/** every API reply, ok or error, carries a message; fall back for non json errors (proxies, crashes) */
export async function apiMessage(res: Pick<Response, "json" | "status">): Promise<string> {
    const body = (await res.json().catch(() => undefined)) as { message?: unknown } | undefined;
    return typeof body?.message === "string" ? body.message : `Request failed (${res.status})`;
}
