import { defaultGameOptions, type GameMode } from "@survev/game/gameOptions.ts";
import { GameRunner } from "@survev/game/gameRunner.ts";
import { LocalConnection } from "@survev/game/localConnection.ts";

/** starts a game in this page with a join token for one player, the game ends by itself once they leave */
export function connectLocalGame(mode: GameMode, joinToken: string) {
    const runner = new GameRunner({
        // debug logs land in the browser's verbose level
        gameOptions: () => ({ ...defaultGameOptions(console), gameTps: 60 }),
    });
    runner.create(crypto.randomUUID(), mode);
    runner.game!.addJoinTokens([{ joinToken, userId: null, ip: "" }], true);
    return new LocalConnection(runner);
}
