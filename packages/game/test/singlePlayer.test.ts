import { GameConfig, TeamMode } from "@survev/shared/gameConfig.ts";
import { v2 } from "@survev/shared/utils/v2.ts";
import { expect, test } from "bun:test";
import { createGame, testOptions } from "./gameTestHelpers.ts";

const minActiveTime = GameConfig.player.minActiveTime + 1;

test("A game with minPlayers 1 starts alone and ends when the player dies", () => {
    const game = createGame(TeamMode.Solo, "test_normal", { ...testOptions, minPlayers: 1 });
    const player = game.playerBarn.addTestPlayer({});

    game.step(minActiveTime);
    expect(game.started).toBeTrue();
    expect(game.over).toBeFalse();

    player.damage({
        amount: 999,
        damageType: GameConfig.DamageType.Gas,
        dir: v2.randomUnit(),
    });

    expect(game.over).toBeTrue();
    expect(game.winningTeamId).toBe(0);
});

test("A game with the default minPlayers waits for a second player", () => {
    const game = createGame(TeamMode.Solo, "test_normal");
    game.playerBarn.addTestPlayer({});

    game.step(minActiveTime);
    expect(game.started).toBeFalse();

    game.playerBarn.addTestPlayer({});
    game.step(minActiveTime);
    expect(game.started).toBeTrue();
});
