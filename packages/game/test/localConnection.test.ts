import { GameConfig, TeamMode } from "@survev/shared/gameConfig.ts";
import { ConnectionState } from "@survev/shared/net/connection.ts";
import * as net from "@survev/shared/net/net.ts";
import { afterEach, expect, test } from "bun:test";
import { GameRunner } from "../gameRunner.ts";
import { LocalConnection } from "../localConnection.ts";
import { testOptions } from "./gameTestHelpers.ts";

const runners: GameRunner[] = [];
afterEach(() => {
    for (const runner of runners.splice(0)) runner.abort("server_restart");
});

/** a runner with a game and a join token, and a client connected to it */
function connect() {
    const runner = new GameRunner({ gameOptions: () => testOptions });
    runners.push(runner);
    runner.create("test", { mapName: "main", teamMode: TeamMode.Solo });
    runner.game!.addJoinTokens([{ joinToken: "token", userId: null, ip: "" }], true);

    const connection = new LocalConnection(runner);
    const received: net.MsgType[] = [];
    let closeReason: string | undefined;
    connection.onOpen = () => {
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.joinToken = "token";
        msg.name = "local";
        const stream = new net.MsgStream(new ArrayBuffer(1024));
        stream.serializeMsg(net.MsgType.Join, msg);
        connection.send(stream.getBuffer());
    };
    connection.onMessage = (data) => {
        const stream = new net.MsgStream(data);
        received.push(stream.deserializeMsgType());
    };
    connection.onClose = (_, reason) => {
        closeReason = reason;
    };
    return { runner, connection, received, closeReason: () => closeReason };
}

// lets every queued delivery run
const flush = () => new Promise((resolve) => setTimeout(resolve));

test("A client joins over a LocalConnection and gets the game", async () => {
    const { runner, connection, received } = connect();
    expect(connection.state).toBe(ConnectionState.Connecting);

    await flush();
    expect(connection.state).toBe(ConnectionState.Open);
    expect(runner.game!.playerBarn.livingPlayers.length).toBe(1);

    runner.game!.netSync();
    await flush();
    expect(received).toContain(net.MsgType.Joined);
});

test("Closing the connection removes the player", async () => {
    const { runner, connection } = connect();
    await flush();

    connection.close();
    await flush();

    expect(runner.game!.clientBarn.clients.length).toBe(0);
});

test("The game closing the socket closes the connection with its reason", async () => {
    const { runner, connection, closeReason } = connect();
    await flush();

    runner.abort("server_restart");
    await flush();

    expect(connection.state).toBe(ConnectionState.Closed);
    expect(closeReason()).toBe("server_restart");
});
