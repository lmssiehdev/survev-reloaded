import { Config } from "@survev/config/serverConfig.ts";
import { Logger } from "@survev/config/utils/consoleLogger.ts";
import { logErrorToWebhook } from "@survev/config/utils/logger.ts";
import { HTTPRateLimit, WebSocketRateLimit } from "@survev/config/utils/rateLimit.ts";
import type { SaveGameBody } from "@survev/contracts";
import type { Client } from "@survev/game/client.ts";
import { Game } from "@survev/game/game.ts";
import { ClientSocket } from "@survev/game/socket.ts";
import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import type { ServerWebSocket } from "bun";
import path from "node:path";
import { apiPrivateRouter, checkIp } from "../utils/apiRouter.ts";
import { getIp } from "../utils/ip.ts";
import { serverGameOptions } from "../utils/serverGameOptions.ts";
import { LOST_GAME_DATA_DIR } from "../utils/types.ts";
import { UWS_BACKPRESSURE_LIMIT } from "../utils/websocket.ts";
import { type IdleSocketData, IdleSocketMonitor } from "./idleSockets.ts";
import { type ProcessMsg, ProcessMsgType } from "./ipcTypes.ts";

function sendMsg(msg: ProcessMsg) {
    process.send!(msg);
}

let game: ServerGame | undefined;
let gameWeakRef: WeakRef<ServerGame> | undefined;

const procLogger = new Logger(Config.logging, `GameProc-${process.pid}`);

function broadcastDisconnect(reason: GameWsDisconnectReason) {
    if (game) {
        for (const client of game.clientBarn.clients) {
            client.socket.close(reason);
        }
    }
}
process.on("disconnect", () => {
    broadcastDisconnect("server_restart");
    process.exit();
});

process.on("uncaughtException", async (err) => {
    console.error(err);
    broadcastDisconnect("server_crashed");

    game = undefined;
    await logErrorToWebhook("server", "Game process error", err);

    process.exit(1);
});

function stopGame() {
    game = undefined;

    // make sure game is properly free'd (dev only, Bun.gc(true) is a blocking full collection)
    if (process.env.NODE_ENV !== "production") {
        // defer so the current stack no longer holds the game
        setImmediate(() => {
            Bun.gc(true);
            if (gameWeakRef?.deref()) {
                procLogger.warn("Possible memory leak found, something is keeping a reference to the game object!");
            }
        });
    }
}

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
        procLogger.error(`Failed to fetch API save game:`, err);
    }

    if (!res || !res.ok) {
        const region = Config.gameServer.thisRegion.toUpperCase();
        procLogger.error(
            `[${region}] Failed to save game data, saving locally instead`,
        );

        try {
            // Bun.write creates the directory if needed
            await Bun.write(path.resolve(LOST_GAME_DATA_DIR, `${gameId}.json`), JSON.stringify(values));
        } catch (err) {
            procLogger.error(`[${region}] Failed to save game data locally:`, err);
        }
    }
}

async function sendQuestProgress(userId: string, progress: Array<{ id: string; delta: number }>) {
    try {
        const req = await apiPrivateRouter.quest_progress.$post({
            json: {
                userId,
                progress,
            },
        });
        const res = await req.json();
        if (!req.ok || !(res as { success: boolean }).success) {
            procLogger.error(`Failed to save quest progress`, res);
        }
    } catch (err) {
        procLogger.error(`Failed to save quest progress:`, err);
    }
}

/**
 * Implements methods only used when the game is actually running on a server
 */
class ServerGame extends Game {
    override updateData() {
        sendMsg({
            type: ProcessMsgType.UpdateData,
            id: this.id,
            teamMode: this.teamMode,
            mapName: this.mapName,
            canJoin: this.canJoin,
            aliveCount: this.aliveCount,
            startedTime: this.startedTime,
            stopped: this.stopped,
            timeRunning: this.timeRunning,
            livingPlayers: this.playerBarn.livingPlayers.map(p => {
                return {
                    id: p.__id,
                    userId: p.userId,
                    name: p.name,
                    disconnected: p.disconnected,
                };
            }),
        });
        if (this.stopped) {
            stopGame();
        }
    }

    override _saveGameToDatabase() {
        // don't save games that never started
        if (!this.started) return;

        const players = this.modeManager.getPlayersSortedByRank();
        /**
         * teamTotal is for total teams that started the match, i hope?
         *
         * it also seems to be unused by the client so we could also remove it?
         */
        const teamTotal = new Set(players.map(({ player }) => player.teamId)).size;

        const teamKills = players.reduce(
            (acc, curr) => {
                acc[curr.player.teamId] = (acc[curr.player.teamId] ?? 0) + curr.player.kills;
                return acc;
            },
            {} as Record<string, number>,
        );

        const values: SaveGameBody["matchData"] = players.map(({ player, rank }) => {
            return {
                // *NOTE: userId is optional; we save the game stats for non logged users too
                userId: player.userId,
                region: Config.gameServer.thisRegion,
                username: player.name,
                playerId: player.matchDataId,
                teamMode: this.teamMode,
                teamCount: player.group?.players.length ?? 1,
                teamTotal: teamTotal,
                teamId: player.teamId,
                timeAlive: Math.round(player.timeAlive),
                died: player.dead,
                kills: player.kills,
                teamKills: teamKills[player.teamId] ?? 0,
                damageDealt: Math.round(player.damageDealt),
                damageTaken: Math.round(player.damageTaken),
                killerId: player.killedBy?.matchDataId || 0,
                gameId: this.id,
                mapId: this.map.mapId,
                mapSeed: this.map.seed,
                killedIds: player.killedIds,
                rank: rank,
                ip: player.client.ip,
                findGameIp: player.client.findGameIp,
                role: player.role,
            };
        });

        // only save the game if it has more than 2 players lol
        if (values.length < 2) return;
        saveGame(this.id, values);
    }

    override sendQuestProgress(userId: string, progress: Array<{ id: string; delta: number }>) {
        sendQuestProgress(userId, progress);
    }
}

let lastMsgTime = Date.now();
process.on("message", (msg: ProcessMsg) => {
    lastMsgTime = Date.now();

    if (msg.type === ProcessMsgType.Create && !game) {
        game = new ServerGame(msg.id, msg.config, serverGameOptions(msg.id));
        gameWeakRef = new WeakRef(game);
    }

    if (!game) return;

    switch (msg.type) {
        case ProcessMsgType.AddJoinToken:
            game.addJoinTokens(msg.tokens, msg.autoFill);
            break;
        case ProcessMsgType.AddSpectateToken:
            game.addSpectateToken(msg.token, msg.data);
            break;
    }
});

setInterval(() => {
    if (Date.now() - lastMsgTime > 10000) {
        console.log("Game process has not received a message in 10 seconds, exiting");
        process.exit();
    }

    if (game) {
        game?.updateData();
    } else {
        sendMsg({
            type: ProcessMsgType.KeepAlive,
        });
    }
}, 5000);

setInterval(() => {
    game?.update();
}, 1000 / Config.gameTps);

setInterval(() => {
    game?.netSync();
}, 1000 / Config.netSyncTps);

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

const port = parseInt(process.argv[2]);

const app = Bun.serve({
    hostname: Config.gameServer.host,
    port,
    tls: Config.gameServer.ssl && {
        key: Bun.file(Config.gameServer.ssl.keyFile),
        cert: Bun.file(Config.gameServer.ssl.certFile),
    },

    routes: {
        "/play": async (req, httpServer) => {
            if (!game) {
                procLogger.warn("Websocket upgrade closed: process not running a game");
                return new Response();
            }

            const ip = getIp(req, httpServer, Config.gameServer.proxyIPHeader);

            if (!ip) {
                game.logger.warn("Invalid IP Found");
                return new Response();
            }

            if (gameHTTPRateLimit.isRateLimited(ip) || gameWsRateLimit.isIpRateLimited(ip)) {
                game.logger.warn("Websocket upgrade closed: Rate limited");
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
            if (!game || !data.clientSocket) {
                if (data.clientSocket) {
                    data.clientSocket.close();
                } else {
                    socket.terminate();
                }
                return;
            }
            if (gameWsRateLimit.isRateLimited(data.rateLimit)) {
                procLogger.warn("Game websocket rate limited, closing socket.");
                socket.close(3000, "rate_limited");
                return;
            }
            // uWS delivered text frames as ArrayBuffers too
            const buff = typeof message === "string" ? textEncoder.encode(message).buffer : message;
            // binaryType is "arraybuffer" (see open), bun's types just don't know it
            if (!(buff instanceof ArrayBuffer)) return;
            game.clientBarn.handleMsg(buff, data.clientSocket);
        },

        close(socket) {
            idleSockets.delete(socket);
            const data = socket.data;
            gameWsRateLimit.ipDisconnected(data.ip);
            if (data.clientSocket) {
                data.clientSocket._closed = true;
                game?.clientBarn?.handleSocketClose(data.clientSocket);
            }
        },
    },
});

procLogger.info(
    `Listening on ${app.hostname}:${app.port}`,
);
