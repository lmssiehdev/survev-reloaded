import type { ServerWebSocket } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { type IdleSocketData, IdleSocketMonitor } from "../../server/src/game/idleSockets.ts";

// scaled down from the game server's 30s timeout / 22s ping
const TIMEOUT_MS = 600;
const PING_MS = 300;

const monitor = new IdleSocketMonitor<IdleSocketData>(TIMEOUT_MS, PING_MS);
const serverClosed = new Set<number>();
const serverOpen = new Set<ServerWebSocket<IdleSocketData & { id: number }>>();
let server: ReturnType<typeof Bun.serve<IdleSocketData & { id: number }>>;
let sendTimer: ReturnType<typeof setInterval>;

beforeAll(() => {
    let nextId = 0;
    server = Bun.serve<IdleSocketData & { id: number }>({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, srv) {
            srv.upgrade(req, { data: { id: nextId++, ...IdleSocketMonitor.initialData() } });
            return undefined;
        },
        websocket: {
            idleTimeout: 30,
            open(ws) {
                serverOpen.add(ws);
                monitor.add(ws);
            },
            message(ws) {
                monitor.received(ws);
            },
            ping(ws) {
                monitor.received(ws);
            },
            pong(ws) {
                monitor.received(ws);
            },
            close(ws) {
                serverOpen.delete(ws);
                monitor.delete(ws);
                serverClosed.add(ws.data.id);
            },
        },
    });
    // like the game's netSync: the server keeps sending, which resets Bun's own idleTimeout
    sendTimer = setInterval(() => {
        for (const ws of serverOpen) ws.sendBinary(new Uint8Array(16));
    }, 20);
    monitor.start(25);
});

afterAll(() => {
    monitor.stop();
    clearInterval(sendTimer);
    server.stop(true);
});

function frame(opcode: number, payload: Uint8Array = new Uint8Array()) {
    const mask = randomBytes(4);
    const out = Buffer.alloc(6 + payload.length);
    out[0] = 0x80 | opcode;
    out[1] = 0x80 | payload.length;
    mask.copy(out, 2);
    for (let i = 0; i < payload.length; i++) out[6 + i] = payload[i] ^ mask[i % 4];
    return out;
}

/**
 * Raw websocket client, unlike WebSocket it can ignore pings.
 */
function connect(opts: { answerPings: boolean; sendEveryMs?: number }) {
    const sock = net.connect(server.port!, "127.0.0.1");
    const state = { pings: 0, closeFrame: false, ended: false, endedAfterMs: 0 };
    let lastSent = performance.now();
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let sendTimer: ReturnType<typeof setInterval> | undefined;

    const send = (data: Buffer) => {
        sock.write(data);
        lastSent = performance.now();
    };

    const ended = new Promise<void>((resolve) => {
        sock.on("close", () => {
            clearInterval(sendTimer);
            state.ended = true;
            state.endedAfterMs = performance.now() - lastSent;
            resolve();
        });
    });
    sock.on("error", () => {});

    sock.on("connect", () => {
        sock.write(
            `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
                + `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
    });

    sock.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!upgraded) {
            const end = buf.indexOf("\r\n\r\n");
            if (end === -1) return;
            upgraded = true;
            buf = buf.subarray(end + 4);
            // "join"
            send(frame(0x2, new Uint8Array([1, 2, 3])));
            if (opts.sendEveryMs) {
                sendTimer = setInterval(() => send(frame(0x2, new Uint8Array([4]))), opts.sendEveryMs);
            }
        }
        while (buf.length >= 2) {
            const opcode = buf[0] & 0x0f;
            let len = buf[1] & 0x7f;
            let offset = 2;
            if (len === 126) {
                if (buf.length < 4) return;
                len = buf.readUInt16BE(2);
                offset = 4;
            }
            if (buf.length < offset + len) return;
            const payload = buf.subarray(offset, offset + len);
            buf = buf.subarray(offset + len);
            if (opcode === 0x9) {
                state.pings++;
                if (opts.answerPings) send(frame(0xa, payload));
            } else if (opcode === 0x8) {
                state.closeFrame = true;
            }
        }
    });

    return { state, ended, destroy: () => sock.destroy() };
}

test("closes a joined client that ignores pings while the server keeps sending", async () => {
    const before = serverClosed.size;
    const client = connect({ answerPings: false });
    await client.ended;

    expect(client.state.pings).toBe(1);
    // terminated, no close frame: the client sees 1006 like with uWS
    expect(client.state.closeFrame).toBe(false);
    expect(client.state.endedAfterMs).toBeGreaterThan(TIMEOUT_MS);
    expect(client.state.endedAfterMs).toBeLessThan(TIMEOUT_MS + 300);
    // the websocket close() handler still ran
    expect(serverClosed.size).toBe(before + 1);
});

test("keeps a client that answers pings", async () => {
    const client = connect({ answerPings: true });
    await Bun.sleep(TIMEOUT_MS * 3);

    expect(client.state.ended).toBe(false);
    expect(client.state.pings).toBeGreaterThanOrEqual(3);
    client.destroy();
    await client.ended;
});

test("keeps a client that keeps sending", async () => {
    const client = connect({ answerPings: false, sendEveryMs: 50 });
    await Bun.sleep(TIMEOUT_MS * 3);

    expect(client.state.ended).toBe(false);
    expect(client.state.pings).toBe(0);
    client.destroy();
    await client.ended;
});
