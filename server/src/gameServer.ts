import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z, type ZodObject } from "zod";
import pkgJson from "../../package.json" with { type: "json" };
import { GameConfig } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { GameProcess, GameProcessManager, ProcState } from "./game/gameProcessManager.ts";
import { apiPrivateRouter } from "./utils/apiRouter.ts";
import { GIT_VERSION } from "./utils/gitRevision.ts";
import { getIp } from "./utils/ip.ts";
import { logErrorToWebhook, ServerLogger } from "./utils/logger.ts";
import { HTTPRateLimit, WebSocketRateLimit } from "./utils/rateLimit.ts";
import {
    type FindGamePrivateBody,
    type FindGamePrivateRes,
    LOST_GAME_DATA_DIR,
    type SaveGameBody,
    type SpectateGamePrivateBody,
    type SpectateGamePrivateRes,
    zFindGamePrivateBody,
    zSaveGameMatchData,
    zSpectateGamePrivateBody,
} from "./utils/types.ts";
import { UWS_BACKPRESSURE_LIMIT } from "./utils/websocket.ts";

process.on("uncaughtException", async (err) => {
    console.error(err);

    await logErrorToWebhook("server", "Game server error:", err);

    process.exit(1);
});

// Bun keeps an inherited "ignore SIGINT" disposition (e.g. when started as a background
// job by a script), Node resets it to the default. Exit on SIGINT like Node does by default,
// game processes then get "disconnect" and close their sockets with "server_restart"
process.on("SIGINT", () => {
    process.exit(130);
});

class GameServer {
    readonly logger = new ServerLogger("GameServer");

    readonly region = Config.regions[Config.gameServer.thisRegion];
    readonly regionId = Config.gameServer.thisRegion;

    readonly manager = new GameProcessManager();

    getUrlsForGame(game: GameProcess) {
        const protocol = this.region.https ? "wss" : "ws";
        const mainPortUrl = new URL(`${protocol}://${this.region.address}/play`);

        const gamePortUrl = new URL(mainPortUrl.toString());
        gamePortUrl.port = game.port.toString();

        return [gamePortUrl.toString()];
    }

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        if (body.version !== GameConfig.protocolVersion) {
            return { error: "invalid_protocol" };
        }

        if (body.region !== this.regionId) {
            return { error: "invalid_region" };
        }

        const game = await this.manager.findGame({
            region: body.region,
            version: body.version,
            autoFill: body.autoFill,
            mapName: body.mapName,
            teamMode: body.teamMode,
            playerData: body.playerData,
        });
        if (!game) {
            return {
                error: "full",
            };
        }

        return {
            urls: this.getUrlsForGame(game),
        };
    }

    async findGameToSpectate(body: SpectateGamePrivateBody): Promise<SpectateGamePrivateRes> {
        const data = await this.manager.findGamesWithPlayer(body);

        return {
            players: data.map((d) => {
                return {
                    gameId: d.game.gameData.id,
                    mapName: d.game.gameData.mapName,
                    teamMode: d.game.gameData.teamMode,
                    data: {
                        joinToken: d.joinToken,
                        urls: this.getUrlsForGame(d.game),
                    },
                };
            }),
        };
    }

    async sendData() {
        try {
            await apiPrivateRouter.update_region.$post({
                json: {
                    data: {
                        playerCount: this.manager.getPlayerCount(),
                    },
                    regionId: Config.gameServer.thisRegion,
                },
            });
        } catch (err) {
            this.logger.error(`Failed to update region: `, err);
        }
    }

    async tryToSaveLostGames() {
        const games: SaveGameBody["matchData"] = [];

        const dir = path.resolve(LOST_GAME_DATA_DIR);

        if (!existsSync(dir)) return;

        // only the files that were loaded get deleted after a successful save
        const files: string[] = [];

        for (const fileName of await fs.readdir(dir)) {
            const filePath = path.resolve(dir, fileName);

            let data: unknown;
            try {
                data = await Bun.file(filePath).json();
            } catch (err) {
                this.logger.warn(`Skipping unreadable lost game file ${fileName}:`, err);
                continue;
            }

            const parsed = zSaveGameMatchData.safeParse(data);
            if (!parsed.success) {
                this.logger.warn(`Skipping invalid lost game file ${fileName}:`, z.prettifyError(parsed.error));
                continue;
            }

            games.push(...parsed.data);
            files.push(fileName);
        }

        if (games.length < 2) return;

        this.logger.info(`${games.length} lost games found, trying to save...`);

        let res: Pick<Response, "ok"> | undefined = undefined;
        try {
            res = await apiPrivateRouter.save_game.$post({
                json: {
                    matchData: games,
                },
            });
        } catch (err) {
            this.logger.error(`Failed to fetch API save game:`, err);
        }

        if (res?.ok) {
            this.logger.info(`successfully saved lost games!`);
            // if we successfully saved the games we can remove them
            for (const fileName of files) {
                const filePath = path.resolve(dir, fileName);
                await fs.rm(filePath);
            }
        }
    }
}

const server = new GameServer();

if (process.env.NODE_ENV !== "production") {
    server.manager.newGame(Config.modes[0]);
}

const pingHTTPRateLimit = new HTTPRateLimit(1, 3000);
const pingWsRateLimit = new WebSocketRateLimit(50, 1000, 10);

interface PingSocketData {
    rateLimit: Record<symbol, number>;
    ip: string;
}

async function handleJsonPost<T extends ZodObject>(
    req: Request,
    validator: T,
    handler: (body: z.infer<T>) => Promise<Record<string, unknown>>,
): Promise<Response> {
    if (req.headers.get("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
        return new Response("403 Forbidden", { status: 403 });
    }

    const parsed = validator.safeParse(await req.json().catch(() => undefined));
    if (!parsed.success) {
        server.logger.warn(`${new URL(req.url).pathname} error: `, parsed.error);
        return new Response("400 Bad Request", { status: 400 });
    }

    try {
        return Response.json(await handler(parsed.data));
    } catch (error) {
        server.logger.warn(`${new URL(req.url).pathname} error: `, error);
        return new Response("500 Internal Server Error", { status: 500 });
    }
}

const app = Bun.serve({
    hostname: Config.gameServer.host,
    port: Config.gameServer.port,
    tls: Config.gameServer.ssl && {
        key: Bun.file(Config.gameServer.ssl.keyFile),
        cert: Bun.file(Config.gameServer.ssl.certFile),
    },
    // Bun responds with 413 to bigger bodies
    maxRequestBodySize: 1024 * 1024, // 1 MB

    routes: {
        "/health": {
            GET: () => new Response("OK"),
        },

        "/private/status": {
            GET: (req) => {
                if (req.headers.get("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
                    return new Response("403 Forbidden", { status: 403 });
                }

                return Response.json({
                    gameCount: server.manager.processes.length,
                    games: server.manager.processes.map(p => {
                        return {
                            state: ProcState[p.state],
                            reusedCount: p.reusedCount,
                            avaliableSlots: p.avaliableSlots,
                            port: p.port,
                            gameData: p.gameData,
                        };
                    }),
                });
            },
        },

        "/api/find_game": {
            POST: (req) => handleJsonPost(req, zFindGamePrivateBody, (body) => server.findGame(body)),
        },

        "/api/spectate_game": {
            POST: (req) => handleJsonPost(req, zSpectateGamePrivateBody, (body) => server.findGameToSpectate(body)),
        },

        // ping test
        "/ptc": (req, httpServer) => {
            const ip = getIp(req, httpServer, Config.gameServer.proxyIPHeader);

            if (!ip) {
                server.logger.warn("Invalid IP Found:", ip);
                return new Response();
            }

            if (pingHTTPRateLimit.isRateLimited(ip) || pingWsRateLimit.isIpRateLimited(ip)) {
                return new Response("429 Too Many Requests", { status: 429 });
            }

            const upgraded = httpServer.upgrade(req, {
                data: {
                    rateLimit: {},
                    ip,
                },
            });
            if (!upgraded) {
                return new Response("426 Upgrade Required", { status: 426 });
            }
            pingWsRateLimit.ipConnected(ip);
            return undefined;
        },
    },

    fetch() {
        return new Response("404 Not Found", { status: 404 });
    },

    websocket: {
        data: {} as PingSocketData,
        backpressureLimit: UWS_BACKPRESSURE_LIMIT,
        idleTimeout: 10,
        maxPayloadLength: 2,

        open(socket) {
            socket.binaryType = "arraybuffer";
        },

        message(socket, message) {
            if (pingWsRateLimit.isRateLimited(socket.data.rateLimit)) {
                server.logger.warn("Ping websocket rate limited, closing socket.");
                socket.terminate();
                return;
            }
            socket.sendBinary(typeof message === "string" ? Buffer.from(message) : message);
        },

        close(socket) {
            pingWsRateLimit.ipDisconnected(socket.data.ip);
        },
    },
});

server.sendData();
setInterval(() => {
    server.sendData();
}, 20 * 1000);

server.logger.info(`Survev Game Server v${pkgJson.version} - GIT ${GIT_VERSION}`);
server.logger.info(
    `Listening on ${app.hostname}:${app.port}`,
);
server.logger.info("Press Ctrl+C to exit.");

// try to save lost games every hour
// Bun.cron runs in the system timezone. Keep the try/catch: a throw or rejection
// becomes an uncaughtException/unhandledRejection, which exits the process
Bun.cron("0 * * * *", async () => {
    try {
        await server.tryToSaveLostGames();
    } catch (err) {
        server.logger.error("Failed to save lost games", err);
    }
});
