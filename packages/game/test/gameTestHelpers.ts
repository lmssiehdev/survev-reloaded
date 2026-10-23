import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import type { TeamMode } from "@survev/shared/gameConfig.ts";
import { Game } from "../game.ts";
import { defaultGameOptions, type GameOptions } from "../gameOptions.ts";

// only log warns and errors so test output stays readable
export const testOptions: GameOptions = {
    ...defaultGameOptions({
        debug() {},
        info() {},
        warn: console.warn,
        error: console.error,
    }),
    debug: {
        spawnMode: "default",
        allowBots: true,
        allowEditMsg: true,
    },
};

export function createGame(teamMode: TeamMode, mapName: MapDefKey) {
    return new Game("test", { mapName, teamMode }, testOptions);
}
