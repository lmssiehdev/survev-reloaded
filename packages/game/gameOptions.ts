import type { ConfigType } from "@survev/config/configType.ts";
import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import type { TeamMode } from "@survev/shared/gameConfig.ts";

/** what to play, picked per game by matchmaking */
export interface ServerGameConfig {
    readonly mapName: MapDefKey;
    readonly teamMode: TeamMode;
}

export interface GameLogger {
    debug(...message: any[]): void;
    info(...message: any[]): void;
    warn(...message: any[]): void;
    error(...message: any[]): void;
}

/**
 * Everything the game needs from whoever hosts it,
 * passed in so the game never reads the server config or does I/O itself
 */
export interface GameOptions extends
    Pick<
        ConfigType,
        "gameTps" | "netSyncTps" | "rateLimitsEnabled" | "uniqueInGameNames" | "defaultItems" | "debug"
    >
{
    logger: GameLogger;
    debugLogs: boolean;
}
