import { sharedEnv } from "@survev/config/env.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import type { GameOptions } from "@survev/game/gameOptions.ts";
import { env } from "../env.ts";

export const GAME_TPS = 100;
export const NET_SYNC_TPS = 33;

/** game options for a game hosted by this server, read from the environment */
export function serverGameOptions(gameId: string): GameOptions {
    const logger = new ServerLogger(`Game #${gameId.substring(0, 4)}`);
    return {
        logger,
        debugLogs: logger.enabled("debug"),
        gameTps: GAME_TPS,
        netSyncTps: NET_SYNC_TPS,
        rateLimitsEnabled: sharedEnv.RATE_LIMITS,
        uniqueInGameNames: env.UNIQUE_IN_GAME_NAMES,
        defaultItems: env.DEFAULT_ITEMS,
        debug: {
            spawnMode: env.spawnPos ? "fixed" : "default",
            spawnPos: env.spawnPos,
            allowBots: env.ALLOW_BOTS,
            allowEditMsg: env.ALLOW_EDIT_MSG,
        },
    };
}
