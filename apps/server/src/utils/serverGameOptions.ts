import { sharedEnv } from "@survev/config/env.ts";
import type { GameMode, GameOptions } from "@survev/game/gameOptions.ts";
import { getLogger } from "@survev/logger/node.ts";
import { env } from "../env.ts";

export const GAME_TPS = 100;
export const NET_SYNC_TPS = 33;

/** game options for a game hosted by this server, read from the environment */
export function serverGameOptions(gameId: string, config: GameMode): GameOptions {
    const logger = getLogger(["game"]).with({ gameId, mapName: config.mapName, teamMode: config.teamMode });
    return {
        logger,
        debugLogs: sharedEnv.LOG_LEVEL === "debug",
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
