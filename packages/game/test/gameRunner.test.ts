import { GameConfig, TeamMode } from "@survev/shared/gameConfig.ts";
import * as net from "@survev/shared/net/net.ts";
import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import { afterEach, expect, test } from "bun:test";
import type { Client } from "../client.ts";
import type { Game, GameData } from "../game.ts";
import { GameRunner } from "../gameRunner.ts";
import { ClientSocket } from "../socket.ts";
import { testOptions } from "./gameTestHelpers.ts";

class TestSocket extends ClientSocket<Client> {
    sent: ArrayBuffer[] = [];
    closeReason?: GameWsDisconnectReason;
    private _closed = false;

    ip() {
        return "127.0.0.1";
    }
    closed() {
        return this._closed;
    }
    send(data: Uint8Array<ArrayBuffer>) {
        this.sent.push(data.slice().buffer);
    }
    close(reason?: GameWsDisconnectReason) {
        this._closed = true;
        this.closeReason = reason;
    }

    receivedTypes() {
        return this.sent.map((buff) => new net.MsgStream(buff).deserializeMsgType());
    }
}

const runners: GameRunner[] = [];
// clears the tick timers of games a test left running
afterEach(() => {
    for (const runner of runners.splice(0)) runner.abort("server_restart");
});

function createRunner() {
    const updates: GameData[] = [];
    const saved: Game[] = [];
    const stopped: Game[] = [];
    const runner = new GameRunner({
        gameOptions: () => testOptions,
        updateData: (game) => updates.push(game.getData()),
        saveGame: (game) => saved.push(game),
        onGameStopped: (game) => stopped.push(game),
    });
    runners.push(runner);
    runner.create("test", { mapName: "main", teamMode: TeamMode.Solo });
    const lastData = () => updates.at(-1);
    return { runner, saved, stopped, lastData };
}

function joinMsg(joinToken: string) {
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = joinToken;
    msg.name = "runner";
    const stream = new net.MsgStream(new ArrayBuffer(1024));
    stream.serializeMsg(net.MsgType.Join, msg);
    return stream.getBuffer().slice().buffer;
}

function joinPlayer(runner: GameRunner, joinToken = "token") {
    runner.game!.addJoinTokens([{ joinToken, userId: null, ip: "127.0.0.1" }], true);
    const socket = new TestSocket();
    runner.socketMessage(socket, joinMsg(joinToken));
    return socket;
}

test("create reports a joinable game", () => {
    const { runner, lastData } = createRunner();

    expect(runner.game?.id).toBe("test");
    expect(lastData()).toMatchObject({ id: "test", canJoin: true, stopped: false, aliveCount: 0 });
});

test("A player joins through a socket and gets the game", () => {
    const { runner, lastData } = createRunner();
    const socket = joinPlayer(runner);

    expect(runner.game!.playerBarn.livingPlayers.length).toBe(1);
    expect(lastData()?.livingPlayers).toMatchObject([{ name: "runner", disconnected: false }]);

    runner.game!.netSync();
    expect(socket.receivedTypes()).toContain(net.MsgType.Joined);
});

test("An unknown join token closes the socket", () => {
    const { runner } = createRunner();
    const socket = new TestSocket();

    runner.socketMessage(socket, joinMsg("unknown"));

    expect(socket.closed()).toBe(true);
    expect(runner.game!.playerBarn.players.length).toBe(0);
});

test("A closed socket removes its player before the game starts", () => {
    const { runner } = createRunner();
    const socket = joinPlayer(runner);

    runner.socketClosed(socket);

    expect(runner.game!.clientBarn.clients.length).toBe(0);
    expect(runner.game!.playerBarn.players.length).toBe(0);
});

test("A stopped game is saved, reported and dropped", () => {
    const { runner, saved, stopped, lastData } = createRunner();
    const game = runner.game!;
    const socket = joinPlayer(runner);

    game.stop();

    expect(saved).toEqual([game]);
    expect(stopped).toEqual([game]);
    expect(lastData()?.stopped).toBe(true);
    expect(socket.closed()).toBe(true);
    expect(runner.game).toBeUndefined();
});

test("create is ignored while a game runs", () => {
    const { runner } = createRunner();
    const game = runner.game;

    runner.create("other", { mapName: "main", teamMode: TeamMode.Duo });

    expect(runner.game).toBe(game);
});

test("Without a game the runner closes sockets", () => {
    const { runner } = createRunner();
    runner.game!.stop();

    const socket = new TestSocket();
    runner.socketMessage(socket, joinMsg("token"));
    expect(socket.closed()).toBe(true);
});

test("Abort tells the players why", () => {
    const { runner } = createRunner();
    const socket = joinPlayer(runner);

    runner.abort("server_restart");

    expect(socket.closeReason).toBe("server_restart");
    expect(runner.game).toBeUndefined();
});
