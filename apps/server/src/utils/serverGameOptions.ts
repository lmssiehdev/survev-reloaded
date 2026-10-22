import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import type { GameOptions } from "../game/gameOptions.ts";

/** game options for a game hosted by this server, read from the server config */
export function serverGameOptions(gameId: string): GameOptions {
    return {
        logger: new ServerLogger(`Game #${gameId.substring(0, 4)}`),
        debugLogs: Config.logging.debugLogs,
        gameTps: Config.gameTps,
        netSyncTps: Config.netSyncTps,
        rateLimitsEnabled: Config.rateLimitsEnabled,
        uniqueInGameNames: Config.uniqueInGameNames,
        defaultItems: Config.defaultItems,
        debug: Config.debug,
    };
}
