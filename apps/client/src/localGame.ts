import { defaultGameOptions, type GameMode } from "@survev/game/gameOptions.ts";
import { GameRunner } from "@survev/game/gameRunner.ts";
import { LocalConnection } from "@survev/game/localConnection.ts";

/**
 * starts a game in this page with a join token for one player, the game ends by itself once they leave.
 * It starts as soon as they join and pauses while the page is hidden, nobody else is in it
 */
export function connectLocalGame(mode: GameMode, joinToken: string) {
    const onVisibilityChange = () => {
        if (document.hidden) runner.pause();
        else runner.resume();
    };
    const runner = new GameRunner({
        gameOptions: () => ({
            // debug logs land in the browser's verbose level
            ...defaultGameOptions(console),
            gameTps: 60,
            minPlayers: 1,
            waitForActivePlayers: false,
        }),
        onGameStopped: () => document.removeEventListener("visibilitychange", onVisibilityChange),
    });
    runner.create(crypto.randomUUID(), mode);
    runner.game!.addJoinTokens([{ joinToken, userId: null, ip: "" }], true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return new LocalConnection(runner);
}
