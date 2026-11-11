import { Connection, ConnectionState } from "@survev/shared/net/connection.ts";
import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import type { Client } from "./client.ts";
import type { GameRunner } from "./gameRunner.ts";
import { ClientSocket } from "./socket.ts";

/**
 * Connects a client to a GameRunner in the same page, in place of a WebSocket to a game server.
 * Everything is delivered in order in a later microtask like a WebSocket would,
 * so neither side runs inside the other's call and messages sent before a close still arrive
 */
export class LocalConnection extends Connection {
    state = ConnectionState.Connecting;
    readonly bufferedAmount = 0;

    private readonly socket = new LocalSocket(this);

    constructor(private readonly runner: GameRunner) {
        super();
        // open once the caller has set its handlers
        queueMicrotask(() => {
            if (this.state !== ConnectionState.Connecting) return;
            this.state = ConnectionState.Open;
            this.onOpen();
        });
    }

    send(data: BufferSource) {
        if (this.state !== ConnectionState.Open) return;
        // copy, the caller reuses its buffer
        const bytes = ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);
        const buff = bytes.slice().buffer;
        queueMicrotask(() => this.runner.socketMessage(this.socket, buff));
    }

    close(reason?: string) {
        if (this.state === ConnectionState.Closed) return;
        this.state = ConnectionState.Closed;
        queueMicrotask(() => {
            this.runner.socketClosed(this.socket);
            this.onClose(1000, reason ?? "");
        });
    }
}

/** the game's side of a LocalConnection */
class LocalSocket extends ClientSocket<Client> {
    constructor(private readonly connection: LocalConnection) {
        super();
    }

    ip() {
        return "";
    }

    closed() {
        return this.connection.state !== ConnectionState.Open;
    }

    send(data: Uint8Array<ArrayBuffer>) {
        if (this.closed()) return;
        // copy, the game reuses its message stream
        const buff = data.slice().buffer;
        queueMicrotask(() => this.connection.onMessage(buff));
    }

    close(reason?: GameWsDisconnectReason) {
        this.connection.close(reason);
    }
}
