import { loggingOptions, sharedEnv } from "@survev/config/env.ts";
import { HTTPRateLimit, WebSocketRateLimit } from "@survev/config/utils/rateLimit.ts";
import type { SaveGameBody } from "@survev/contracts";
import type { Client } from "@survev/game/client.ts";
import type { QuestProgress } from "@survev/game/game.ts";
import { GameRunner } from "@survev/game/gameRunner.ts";
import { type ProcessMsg, ProcessMsgType } from "@survev/game/ipcTypes.ts";
import { ClientSocket } from "@survev/game/socket.ts";
import { flatStats } from "@survev/game/tickStats.ts";
import {
    flushLogs,
    getLogger,
    installCrashHandlers,
    setupServerLogging,
    startProcessStats,
} from "@survev/logger/node.ts";
import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import type { ServerWebSocket } from "bun";
import path from "node:path";
import { env } from "../env.ts";
import { apiPrivateRouter, checkIp } from "../utils/apiRouter.ts";
import { getIp } from "../utils/ip.ts";
import { serverGameOptions } from "../utils/serverGameOptions.ts";
import { LOST_GAME_DATA_DIR } from "../utils/types.ts";
import { UWS_BACKPRESSURE_LIMIT } from "../utils/websocket.ts";
import { type IdleSocketData, IdleSocketMonitor } from "./idleSockets.ts";

const port = parseInt(process.argv[2]);

// the child shares the parent's stdout, its records are told apart by app: "game-proc"
await setupServerLogging(loggingOptions("game-proc", sharedEnv.REGION));
installCrashHandlers();

const procLogger = getLogger(["game-proc"]).with({ port });

//
// Keep saveGame and sendQuestProgress separated from the game class
// This ensures that waiting for the network request doesn't prevent the game instance from being GC'd
//

async function saveGame(gameId: string, values: SaveGameBody["matchData"]) {
    let res: Pick<Response, "ok"> | undefined = undefined;
    try {
        res = await apiPrivateRouter.save_game.$post({
            json: {
                matchData: values,
            },
        });
    } catch (err) {
        procLogger.error("game.save_failed", { gameId, err });
    }

    if (!res || !res.ok) {
        procLogger.error("game.save_fallback_local", { gameId });

        try {
            // Bun.write creates the directory if needed
            await Bun.write(path.resolve(LOST_GAME_DATA_DIR, `${gameId}.json`), JSON.stringify(values));
        } catch (err) {
            procLogger.error("game.save_local_failed", { gameId, err });
        }
    }
}

async function sendQuestProgress(userId: string, progress: QuestProgress) {
    try {
        const req = await apiPrivateRouter.quest_progress.$post({
            json: {
                userId,
                progress,
            },
        });
        const res = await req.json();
        if (!req.ok || !(res as { success: boolean }).success) {
            procLogger.error("quest.progress_failed", { userId, status: req.status, res });
        }
    } catch (err) {
        procLogger.error("quest.progress_failed", { userId, err });
    }
}

const runner = new GameRunner({
    updateData(game) {
        process.send!({ type: ProcessMsgType.UpdateData, ...game.getData() });
    },
    gameOptions: serverGameOptions,
    saveGame(game) {
        // don't save games that never started
        if (!game.started) return;
        const values = game.matchData().map(row => ({ ...row, region: env.REGION }));
        // only save the game if it has more than 2 players lol
        if (values.length < 2) return;
        saveGame(game.id, values);
    },
    sendQuestProgress,
    onGameStopped(game) {
        // make sure game is properly free'd (dev only, Bun.gc(true) is a blocking full collection)
        if (process.env.NODE_ENV === "production") return;
        const gameRef = new WeakRef(game);
        // defer so the current stack no longer holds the game
        setImmediate(() => {
            Bun.gc(true);
            if (gameRef.deref()) {
                procLogger.warn("game.possible_leak");
            }
        });
    },
});
// also a keep alive, the manager kills processes it hasn't heard from in 10 seconds
setInterval(() => {
    if (runner.game) runner.game.updateData();
    else process.send!({ type: ProcessMsgType.KeepAlive });
}, 5000);

process.on("disconnect", async () => {
    procLogger.info("game.proc.parent_disconnected", { gameId: runner.game?.id });
    runner.abort("server_restart");
    await flushLogs();
    process.exit();
});

// installCrashHandlers logs the crash and exits, this only tells the players
process.on("uncaughtException", () => {
    runner.abort("server_crashed");
});

// one game per process; the windows are reset on every read, the game-lifetime stats are not
startProcessStats(() => {
    const game = runner.game;
    if (!game) return { gameId: undefined, alivePlayers: 0 };
    const stats = {
        gameId: game.id,
        alivePlayers: game.playerBarn.livingPlayers.length,
        ...flatStats("tick", game.tickWindow),
        ...flatStats("netSync", game.netSyncWindow),
    };
    game.tickWindow.reset();
    game.netSyncWindow.reset();
    return stats;
}, sharedEnv.PROCESS_STATS_MS);

let lastMsgTime = Date.now();
process.on("message", (msg: ProcessMsg) => {
    lastMsgTime = Date.now();
    switch (msg.type) {
        case ProcessMsgType.Create:
            runner.create(msg.id, msg.config);
            break;
        case ProcessMsgType.AddJoinToken:
            runner.game?.addJoinTokens(msg.tokens, msg.autoFill);
            break;
        case ProcessMsgType.AddSpectateToken:
            runner.game?.addSpectateToken(msg.token, msg.data);
            break;
    }
});

setInterval(async () => {
    if (Date.now() - lastMsgTime > 10000) {
        procLogger.warn("game.proc.parent_silent", { gameId: runner.game?.id });
        await flushLogs();
        process.exit();
    }
}, 5000);

interface GameSocketData extends IdleSocketData {
    ip: string;
    rateLimit: Record<symbol, number>;
    disconnectReason?: GameWsDisconnectReason;
    clientSocket?: BunSocket;
}

class BunSocket extends ClientSocket<Client> {
    private _socket: ServerWebSocket<GameSocketData>;
    private _ip: string;

    _closed = false;
    constructor(socket: ServerWebSocket<GameSocketData>, ip: string) {
        super();
        this._socket = socket;
        this._ip = ip;
    }

    ip(): string {
        return this._ip;
    }

    closed(): boolean {
        return this._closed;
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        if (this._closed) return;
        this._socket.sendBinary(data);
    }

    close(reason?: GameWsDisconnectReason): void {
        if (this._closed) return;
        this._closed = true;
        if (reason) {
            this._socket.close(3000, reason);
        } else {
            this._socket.close();
        }
    }
}

// uWS-like idle timeout for game sockets, see IdleSocketMonitor.
// uWS pings ~8s before closing an idle socket
const idleSockets = new IdleSocketMonitor<GameSocketData>(30_000, 22_000).start(1000);

const gameHTTPRateLimit = new HTTPRateLimit(5, 1000);
const gameWsRateLimit = new WebSocketRateLimit(500, 1000, 5);

const textEncoder = new TextEncoder();

const app = Bun.serve({
    hostname: env.GAME_HOST,
    port,
    tls: env.ssl,

    routes: {
        "/play": async (req, httpServer) => {
            const game = runner.game;
            if (!game) {
                procLogger.info("ws.upgrade_rejected", { reason: "no_game" });
                return new Response();
            }

            const ip = getIp(req, httpServer, env.PROXY_IP_HEADER);

            if (!ip) {
                game.logger.warn("ws.invalid_ip");
                return new Response();
            }

            if (gameHTTPRateLimit.isRateLimited(ip) || gameWsRateLimit.isIpRateLimited(ip)) {
                game.logger.info("ws.upgrade_rejected", { reason: "rate_limited" });
                return new Response("429 Too Many Requests", { status: 429 });
            }

            gameWsRateLimit.ipConnected(ip);

            let disconnectReason: GameWsDisconnectReason | undefined = undefined;

            const ipData = await checkIp(ip);

            if (ipData?.banned) {
                disconnectReason = "ip_banned";
            } else if (ipData?.behindProxy) {
                disconnectReason = "behind_proxy";
            }

            const upgraded = httpServer.upgrade(req, {
                data: {
                    rateLimit: {},
                    ip,
                    disconnectReason,
                    clientSocket: undefined,
                    ...IdleSocketMonitor.initialData(),
                },
            });
            if (!upgraded) {
                // request aborted or not a websocket request, close() won't be called
                gameWsRateLimit.ipDisconnected(ip);
                return new Response("426 Upgrade Required", { status: 426 });
            }
            return undefined;
        },
    },

    fetch() {
        return new Response("404 Not Found", { status: 404 });
    },

    websocket: {
        data: {} as GameSocketData,
        backpressureLimit: UWS_BACKPRESSURE_LIMIT,
        idleTimeout: 30,
        maxPayloadLength: 1024,

        open(socket) {
            // Bun defaults to node Buffers, ClientBarn.handleMsg only accepts ArrayBuffers
            socket.binaryType = "arraybuffer";

            const data = socket.data;

            if (data.disconnectReason) {
                socket.close(3000, data.disconnectReason);
                return;
            }

            data.clientSocket = new BunSocket(socket, data.ip);
            idleSockets.add(socket);
        },

        ping(socket) {
            idleSockets.received(socket);
        },

        pong(socket) {
            idleSockets.received(socket);
        },

        message(socket, message) {
            idleSockets.received(socket);
            const data = socket.data;
            if (!data.clientSocket) {
                socket.terminate();
                return;
            }
            if (gameWsRateLimit.isRateLimited(data.rateLimit)) {
                (runner.game?.logger ?? procLogger).info("ws.message_rate_limited");
                socket.close(3000, "rate_limited");
                return;
            }
            // uWS delivered text frames as ArrayBuffers too
            const buff = typeof message === "string" ? textEncoder.encode(message).buffer : message;
            // binaryType is "arraybuffer" (see open), bun's types just don't know it
            if (!(buff instanceof ArrayBuffer)) return;
            runner.socketMessage(data.clientSocket, buff);
        },

        close(socket) {
            idleSockets.delete(socket);
            const data = socket.data;
            gameWsRateLimit.ipDisconnected(data.ip);
            if (data.clientSocket) {
                data.clientSocket._closed = true;
                runner.socketClosed(data.clientSocket);
            }
        },
    },
});

procLogger.info("game.proc.listening", { host: app.hostname });
