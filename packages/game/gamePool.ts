import type { FindGamePrivateBody, SpectateGamePrivateBody } from "@survev/contracts";
import { type MapDefKey, MapDefs } from "@survev/shared/defs/mapDefs.ts";
import type { TeamMode } from "@survev/shared/gameConfig.ts";
import { util } from "@survev/shared/utils/util.ts";
import type { GameData, SpectateTokenData } from "./game.ts";
import type { GameLogger, GameMode } from "./gameOptions.ts";
import { type ProcessMsg, ProcessMsgType } from "./ipcTypes.ts";

export enum HandleState {
    Idle,
    CreatingGame,
    Running,
}

/**
 * A GameRunner running somewhere else (a child process, a worker),
 * known only through the messages it sends. Runners are reused for the next game
 */
export abstract class GameHandle {
    gameData: GameData = {
        id: "",
        teamMode: 0 as TeamMode,
        mapName: "" as MapDefKey,
        canJoin: false,
        aliveCount: 0,
        startedTime: 0,
        stopped: false,
        timeRunning: 0,
        livingPlayers: [],
    };

    state = HandleState.Idle;

    createdTime = Date.now();

    stoppedTime = Date.now();
    lastMsgTime = Date.now();

    /** find_game requests waiting for the game to be created, called with false if the runner dies first */
    onCreatedCbs: Array<(created: boolean) => void> = [];

    avaliableSlots = 0;

    reusedCount = 0;

    abstract send(msg: ProcessMsg): void;

    /** what tells this runner apart in logs, eg its pid and port */
    abstract logProps(): Record<string, unknown>;

    create(id: string, config: GameMode) {
        this.send({
            type: ProcessMsgType.Create,
            id,
            config,
        });
        this.gameData.id = id;
        this.gameData.teamMode = config.teamMode;
        this.gameData.mapName = config.mapName;
        this.gameData.stopped = false;
        this.state = HandleState.CreatingGame;

        const mapDef = MapDefs[this.gameData.mapName];
        this.avaliableSlots = mapDef.gameMode.maxPlayers;

        this.reusedCount++;
    }

    addJoinTokens(tokens: FindGamePrivateBody["playerData"], autoFill: boolean) {
        this.send({
            type: ProcessMsgType.AddJoinToken,
            autoFill,
            tokens,
        });
        this.avaliableSlots--;
    }

    addSpectateToken(token: string, data: SpectateTokenData) {
        this.send({
            type: ProcessMsgType.AddSpectateToken,
            token,
            data,
        });
    }
}

/**
 * Matchmaking over a set of game runners: picks or creates the game for a find_game request,
 * reuses runners whose game stopped and kills the ones that hang or idle for too long.
 * Subclasses start and kill the runners
 */
export abstract class GamePool<T extends GameHandle> {
    readonly games: T[] = [];
    readonly gameById = new Map<string, T>();

    /**
     * always keep some runners even if theres no active games on them
     * creating a new one is more expensive than reusing one
     */
    minIdleRunners = 3;

    constructor(readonly logger: GameLogger) {}

    /** starts a runner, undefined when there's no room for another one */
    protected abstract spawn(): T | undefined;

    /** stops a runner, which must call remove() once it's gone */
    protected abstract kill(handle: T, reason: "unresponsive" | "stale"): void;

    start() {
        setInterval(() => this.tick(), 5000);
    }

    tick() {
        // copy, kill removes from the list
        for (const handle of this.games.slice()) {
            handle.send({
                type: ProcessMsgType.KeepAlive,
            });

            // kill runners that didn't send a keep alive msg in 10 seconds
            // because this usually means they are frozen in an infinite loop
            if (Date.now() - handle.lastMsgTime > 10000) {
                this.logger.warn("game.proc.unresponsive", {
                    ...handle.logProps(),
                    gameId: handle.gameData.id || undefined,
                });
                this.kill(handle, "unresponsive");
            }
        }

        const idle = this.games.filter(h => {
            return h.gameData.stopped && (Date.now() - h.stoppedTime) > 60000;
        });

        // kill stale runners if there's too many
        if (idle.length > this.minIdleRunners) {
            idle.sort((a, b) => a.createdTime - b.createdTime);

            const toKill = idle.length - this.minIdleRunners;
            for (let i = 0; i < toKill; i++) {
                this.logger.info("game.proc.stale_kill", idle[i].logProps());
                this.kill(idle[i], "stale");
            }
        }
    }

    handleMsg(handle: T, msg: ProcessMsg) {
        handle.lastMsgTime = Date.now();

        switch (msg.type) {
            case ProcessMsgType.UpdateData:
                if (handle.state === HandleState.CreatingGame && msg.canJoin) {
                    handle.state = HandleState.Running;
                    for (const cb of handle.onCreatedCbs) {
                        cb(true);
                    }
                    handle.onCreatedCbs.length = 0;
                    if (handle.reusedCount === 1) {
                        this.logger.info("game.proc.ready", {
                            ...handle.logProps(),
                            gameId: handle.gameData.id,
                            ms: Date.now() - handle.createdTime,
                        });
                    }
                }

                if (handle.gameData.id !== msg.id) {
                    this.gameById.delete(handle.gameData.id);
                    this.gameById.set(msg.id, handle);
                }
                handle.gameData = msg;
                if (handle.gameData.stopped) {
                    handle.stoppedTime = Date.now();
                    handle.state = HandleState.Idle;
                }
                break;
        }
    }

    getPlayerCount(): number {
        return this.games.reduce((a, b) => {
            return a + b.gameData.aliveCount;
        }, 0);
    }

    newGame(config: GameMode): T | undefined {
        let handle = this.games.find(h => h.gameData.stopped);

        if (handle) {
            this.gameById.delete(handle.gameData.id);
        } else {
            handle = this.spawn();
            if (!handle) return undefined;
            this.games.push(handle);
        }

        const id = crypto.randomUUID();
        handle.create(id, config);
        this.gameById.set(id, handle);

        return handle;
    }

    /** stop routing to a runner; safe to call more than once */
    remove(handle: T) {
        util.removeFrom(this.games, handle);
        if (this.gameById.get(handle.gameData.id) === handle) {
            this.gameById.delete(handle.gameData.id);
        }
        for (const cb of handle.onCreatedCbs.splice(0)) {
            cb(false);
        }
    }

    getById(id: string): T | undefined {
        return this.gameById.get(id);
    }

    async findGame(body: FindGamePrivateBody): Promise<T | undefined> {
        let handle: T | undefined = this.games
            .filter((handle) => {
                const game = handle.gameData;
                return (
                    (game.canJoin || handle.state === HandleState.CreatingGame)
                    && handle.avaliableSlots > 0
                    && game.teamMode === body.teamMode
                    && game.mapName === body.mapName
                );
            })
            .sort((a, b) => {
                return a.gameData.startedTime - b.gameData.startedTime;
            })[0];

        if (!handle) {
            handle = this.newGame({
                teamMode: body.teamMode,
                mapName: body.mapName as MapDefKey,
            });
        }

        if (!handle) {
            return undefined;
        }

        // if the game has not finished creating
        // wait for it to be created to send the find game response
        if (handle.state !== HandleState.Running) {
            const pending = handle;
            return await new Promise((resolve) => {
                pending.onCreatedCbs.push((created) => {
                    if (!created) return resolve(undefined);
                    pending.addJoinTokens(body.playerData, body.autoFill);
                    resolve(pending);
                });
            });
        }

        handle.addJoinTokens(body.playerData, body.autoFill);

        return handle;
    }

    async findGamesWithPlayer(body: SpectateGamePrivateBody): Promise<{ joinToken: string; game: T }[]> {
        const filterFn = (p: GameData["livingPlayers"][0]) => {
            if (body.filter.type === "user_id") {
                return p.userId === body.filter.value;
            } else {
                return p.name === body.filter.value;
            }
        };

        const res = [];
        for (const handle of this.games) {
            if (handle.state !== HandleState.Running) continue;

            for (const player of handle.gameData.livingPlayers) {
                if (player.disconnected) continue;
                if (!filterFn(player)) continue;

                // use slightly shorter join tokens for this...
                // since for the discord bot long URLs make the message run out of characters kinda fast
                const joinToken = crypto.getRandomValues(new Uint8Array(16)).toBase64({
                    alphabet: "base64url",
                    omitPadding: true,
                });
                handle.addSpectateToken(joinToken, {
                    playerId: player.id,
                    specAnon: true,
                    noSpecCooldown: true,
                });

                res.push({
                    joinToken,
                    game: handle,
                });
            }
        }

        return res;
    }
}
