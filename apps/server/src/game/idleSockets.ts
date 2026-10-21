import type { ServerWebSocket } from "bun";

export interface IdleSocketData {
    /** performance.now() of the last frame received from the client (messages, pings and pongs) */
    lastReceived: number;
    /** if a ping was sent since lastReceived */
    pinged: boolean;
}

/**
 * uWS times a websocket out `idleTimeout` seconds after the last frame it RECEIVED
 * (pongs included): it sends a ping first, then closes the socket abruptly (the client sees 1006).
 *
 * Bun's `idleTimeout` is also reset whenever the SERVER sends, and joined game clients
 * get updates ~33 times a second, so a client that stops sending would never time out.
 * This emulates the uWS behavior with a single timer for all tracked sockets,
 * Bun's own `idleTimeout` should stay as the fallback.
 */
export class IdleSocketMonitor<T extends IdleSocketData> {
    private readonly _sockets = new Set<ServerWebSocket<T>>();
    private _timer?: ReturnType<typeof setInterval>;

    constructor(
        readonly timeoutMs: number,
        readonly pingMs: number,
    ) {}

    static initialData(): IdleSocketData {
        return { lastReceived: performance.now(), pinged: false };
    }

    add(socket: ServerWebSocket<T>): void {
        this.received(socket);
        this._sockets.add(socket);
    }

    delete(socket: ServerWebSocket<T>): void {
        this._sockets.delete(socket);
    }

    received(socket: ServerWebSocket<T>): void {
        socket.data.lastReceived = performance.now();
        socket.data.pinged = false;
    }

    check(now = performance.now()): void {
        for (const socket of this._sockets) {
            const idleTime = now - socket.data.lastReceived;
            if (idleTime > this.timeoutMs) {
                this._sockets.delete(socket);
                // abrupt close like uWS, the websocket close() handler still runs
                socket.terminate();
            } else if (idleTime > this.pingMs && !socket.data.pinged) {
                socket.data.pinged = true;
                socket.ping();
            }
        }
    }

    start(intervalMs: number): this {
        this.stop();
        this._timer = setInterval(() => this.check(), intervalMs);
        return this;
    }

    stop(): void {
        clearInterval(this._timer);
        this._timer = undefined;
    }
}
