import { Config } from "@survev/config/serverConfig.ts";
import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import type { TeamMode } from "@survev/shared/gameConfig.ts";
import { Game } from "../src/game/game.ts";

export function createGame(teamMode: TeamMode, mapName: MapDefKey) {
    // we dont want vitest spammed with stdout logs so only log warns and errors
    Config.logging.logDate = false;
    Config.logging.debugLogs = false;
    Config.logging.infoLogs = false;
    Config.logging.warnLogs = true;
    Config.logging.errorLogs = true;

    const game = new Game("test", { mapName, teamMode });
    return game;
}
