import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import type { TeamMode } from "@survev/shared/gameConfig.ts";

/**
 * Directory (relative to the server cwd) where games that failed to save are stored,
 * written by the game process and retried by the game server.
 */
export const LOST_GAME_DATA_DIR = "lost_game_data";

export interface ServerGameConfig {
    readonly mapName: MapDefKey;
    readonly teamMode: TeamMode;
}
