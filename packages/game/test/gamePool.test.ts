import type { FindGamePrivateBody } from "@survev/contracts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import { expect, test } from "bun:test";
import { GameHandle, GamePool, HandleState } from "../gamePool.ts";
import { type ProcessMsg, ProcessMsgType } from "../ipcTypes.ts";
import { testOptions } from "./gameTestHelpers.ts";

class TestHandle extends GameHandle {
    sent: ProcessMsg[] = [];

    send(msg: ProcessMsg) {
        this.sent.push(msg);
    }
    logProps() {
        return {};
    }
}

class TestPool extends GamePool<TestHandle> {
    maxRunners = 2;
    killed: Array<[TestHandle, string]> = [];

    constructor() {
        super(testOptions.logger);
    }

    protected spawn() {
        if (this.games.length >= this.maxRunners) return undefined;
        return new TestHandle();
    }

    protected kill(handle: TestHandle, reason: "unresponsive" | "stale") {
        this.killed.push([handle, reason]);
        this.remove(handle);
    }

    /** what the runner reports once the game exists */
    report(handle: TestHandle, data: { canJoin?: boolean; stopped?: boolean; livingPlayers?: [] }) {
        this.handleMsg(handle, {
            type: ProcessMsgType.UpdateData,
            ...handle.gameData,
            canJoin: true,
            ...data,
        });
    }
}

function findBody(teamMode = TeamMode.Solo, joinToken = "token"): FindGamePrivateBody {
    return {
        region: "local",
        version: 0,
        autoFill: true,
        mapName: "main",
        teamMode,
        playerData: [{ joinToken, userId: null, ip: "127.0.0.1" }],
    };
}

test("findGame creates a game and answers once it can be joined", async () => {
    const pool = new TestPool();

    const found = pool.findGame(findBody());
    const handle = pool.games[0];
    expect(handle.state).toBe(HandleState.CreatingGame);
    expect(handle.sent.map(m => m.type)).toEqual([ProcessMsgType.Create]);

    pool.report(handle, {});

    expect(await found).toBe(handle);
    expect(handle.state).toBe(HandleState.Running);
    expect(handle.sent.at(-1)).toMatchObject({ type: ProcessMsgType.AddJoinToken, tokens: [{ joinToken: "token" }] });
    expect(pool.getById(handle.gameData.id)).toBe(handle);
});

test("findGame joins a game of the same mode and creates one for another mode", async () => {
    const pool = new TestPool();

    const first = pool.findGame(findBody());
    const second = pool.findGame(findBody());
    const duo = pool.findGame(findBody(TeamMode.Duo));
    expect(pool.games.length).toBe(2);

    for (const handle of pool.games) pool.report(handle, {});

    expect(await first).toBe(pool.games[0]);
    expect(await second).toBe(pool.games[0]);
    expect(await duo).toBe(pool.games[1]);
});

test("findGame answers undefined when there's no room or the runner dies", async () => {
    const pool = new TestPool();
    pool.maxRunners = 0;
    expect(await pool.findGame(findBody())).toBeUndefined();

    pool.maxRunners = 1;
    const found = pool.findGame(findBody());
    pool.remove(pool.games[0]);
    expect(await found).toBeUndefined();
});

test("A stopped game's runner is reused for the next game", async () => {
    const pool = new TestPool();
    const found = pool.findGame(findBody());
    const handle = pool.games[0];
    pool.report(handle, {});
    await found;
    const oldId = handle.gameData.id;

    pool.report(handle, { canJoin: false, stopped: true });
    expect(handle.state).toBe(HandleState.Idle);

    expect(pool.newGame({ mapName: "main", teamMode: TeamMode.Duo })).toBe(handle);
    expect(pool.games.length).toBe(1);
    expect(handle.reusedCount).toBe(2);
    expect(pool.getById(oldId)).toBeUndefined();
    expect(pool.getById(handle.gameData.id)).toBe(handle);
});

test("tick kills runners that went silent or idled for too long", () => {
    const pool = new TestPool();
    pool.maxRunners = 10;
    pool.minIdleRunners = 1;

    const [silent, ...idle] = [0, 1, 2].map(() => pool.newGame({ mapName: "main", teamMode: TeamMode.Solo })!);
    silent.lastMsgTime = Date.now() - 11000;
    for (const handle of idle) {
        pool.report(handle, { stopped: true });
        handle.stoppedTime = Date.now() - 61000;
    }

    pool.tick();

    expect(pool.killed).toEqual([[silent, "unresponsive"], [idle[0], "stale"]]);
    expect(pool.games).toEqual([idle[1]]);
});

test("findGamesWithPlayer hands out spectate tokens", async () => {
    const pool = new TestPool();
    const found = pool.findGame(findBody());
    const handle = pool.games[0];
    pool.report(handle, {});
    await found;
    pool.handleMsg(handle, {
        type: ProcessMsgType.UpdateData,
        ...handle.gameData,
        livingPlayers: [
            { id: 7, userId: "user", name: "a", disconnected: false },
            { id: 8, userId: "user", name: "b", disconnected: true },
        ],
    });

    const res = await pool.findGamesWithPlayer({ filter: { type: "user_id", value: "user" } });

    expect(res).toEqual([{ joinToken: expect.stringMatching(/^[\w-]{22}$/), game: handle }]);
    expect(handle.sent.at(-1)).toMatchObject({
        type: ProcessMsgType.AddSpectateToken,
        token: res[0].joinToken,
        data: { playerId: 7 },
    });
});
