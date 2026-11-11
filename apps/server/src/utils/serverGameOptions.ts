import { sharedEnv } from "@survev/config/env.ts";
import { defaultGameOptions, type GameMode, type GameOptions } from "@survev/game/gameOptions.ts";
import { getLogger } from "@survev/logger/node.ts";
import { env } from "../env.ts";

/** game options for a game hosted by this server, read from the environment */
export function serverGameOptions(gameId: string, config: GameMode): GameOptions {
    const logger = getLogger(["game"]).with({ gameId, mapName: config.mapName, teamMode: config.teamMode });
    return {
        ...defaultGameOptions(logger),
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
