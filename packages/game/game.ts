import type { FindGamePrivateBody, SaveGameBody } from "@survev/contracts";
import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import type { MatchFx } from "@survev/shared/defs/mapFxDefs.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import type { Loadout } from "@survev/shared/utils/loadout.ts";
import { math } from "@survev/shared/utils/math.ts";
import { util } from "@survev/shared/utils/util.ts";
import { ClientBarn } from "./client.ts";
import { GameModeManager } from "./gameModeManager.ts";
import type { GameLogger, GameMode, GameOptions } from "./gameOptions.ts";
import { Grid } from "./grid.ts";
import { GameMap } from "./map.ts";
import { AirdropBarn } from "./objects/airdrop.ts";
import { BulletBarn } from "./objects/bullet.ts";
import { DeadBodyBarn } from "./objects/deadBody.ts";
import { DecalBarn } from "./objects/decal.ts";
import { ExplosionBarn } from "./objects/explosion.ts";
import { type GameObject, ObjectRegister } from "./objects/gameObject.ts";
import { Gas } from "./objects/gas.ts";
import { LootBarn } from "./objects/loot.ts";
import { MapIndicatorBarn } from "./objects/mapIndicator.ts";
import { PlaneBarn } from "./objects/plane.ts";
import { PlayerBarn } from "./objects/player.ts";
import { ProjectileBarn } from "./objects/projectile.ts";
import { SmokeBarn } from "./objects/smoke.ts";
import { Profiler } from "./profiler.ts";
import { flatStats, Throttle, TickStats } from "./tickStats.ts";

export interface JoinTokenData {
    userId: string | null;
    findGameIp: string;
    loadout?: Loadout;
    quests?: string[];
    groupData: {
        autoFill: boolean;
        playerCount: number;
        groupHashToJoin: string;
    };
}

export interface SpectateTokenData {
    playerId: number;
    specAnon: boolean;
    noSpecCooldown: boolean;
}

/** what the game server's process manager knows about a game, sent on every change */
export interface GameData {
    id: string;
    teamMode: TeamMode;
    mapName: MapDefKey;
    canJoin: boolean;
    aliveCount: number;
    startedTime: number;
    stopped: boolean;
    timeRunning: number;

    livingPlayers: Array<{
        id: number;
        userId: string | null;
        name: string;
        disconnected: boolean;
    }>;
}

/** a match stats row per player, the host adds where the game ran */
export type MatchDataRow = Omit<SaveGameBody["matchData"][number], "region">;

export type QuestProgress = Array<{ id: string; delta: number }>;

/**
 * The game's I/O, implemented by whoever hosts it (see GameRunner).
 * This keeps the game free of nodejs imports and network requests,
 * which keeps offline mode and unit tests easy to maintain
 */
export interface GameHooks {
    /** getData() changed: created, a player joined or left, game over, stopped */
    updateData?(game: Game): void;
    /** the game stopped, save its matchData() */
    saveGame?(game: Game): void;
    sendQuestProgress?(userId: string, progress: QuestProgress): void;
}

type JoinToken = {
    type: "join";
    expiresAt: number;
    data: JoinTokenData;
} | {
    type: "spectate";
    expiresAt: number;
    data: SpectateTokenData;
};

export class Game {
    started = false;
    stopped = false;
    over = false;
    winningTeamId = 0;
    startedTime = 0;
    stopTicker = 0;
    timeRunning = 0;
    // used to stop the game if theres no connected players
    noPlayersTicker = 0;

    id: string;
    teamMode: TeamMode;
    mapName: MapDefKey;
    isTeamMode: boolean;
    config: GameMode;
    modeManager: GameModeManager;

    now!: number;
    profiler = new Profiler();

    tickStats = new TickStats();
    netSyncStats = new TickStats();
    /** per-minute windows for process.stats, reset by the reader; the lifetime stats above are for game.end */
    tickWindow = new TickStats();
    netSyncWindow = new TickStats();
    startedAt = Date.now();
    /** this match's time of day and weather, rolled from the map def */
    fx: MatchFx;
    playersPeak = 0;
    playersTotal = 0;
    slowTickCount = 0;
    slowNetSyncCount = 0;
    private slowTickThrottle = new Throttle(10000);
    private slowNetSyncThrottle = new Throttle(10000);

    joinTokens = new Map<string, JoinToken>();

    get aliveCount(): number {
        return this.playerBarn.livingPlayers.length;
    }

    grid: Grid<GameObject>;
    map: GameMap;
    gas: Gas;
    objectRegister: ObjectRegister;

    clientBarn: ClientBarn;
    playerBarn: PlayerBarn;
    lootBarn: LootBarn;
    deadBodyBarn: DeadBodyBarn;
    decalBarn: DecalBarn;
    projectileBarn: ProjectileBarn;
    bulletBarn: BulletBarn;
    smokeBarn: SmokeBarn;
    airdropBarn: AirdropBarn;
    explosionBarn: ExplosionBarn;
    planeBarn: PlaneBarn;
    mapIndicatorBarn: MapIndicatorBarn;

    readonly options: GameOptions;
    readonly hooks: GameHooks;
    logger: GameLogger;

    // for debug
    preventStart = false;
    debugSpeedMulti = 1;

    constructor(id: string, config: GameMode, options: GameOptions, hooks: GameHooks = {}) {
        const start = Date.now();
        this.id = id;
        this.options = options;
        this.hooks = hooks;
        this.logger = options.logger;
        this.logger.debug("game.creating");

        this.config = config;

        this.teamMode = config.teamMode;
        this.mapName = config.mapName;
        this.isTeamMode = this.teamMode !== TeamMode.Solo;

        this.map = new GameMap(this);
        this.grid = new Grid(this.map.width, this.map.height);
        this.objectRegister = new ObjectRegister(this.grid);

        this.clientBarn = new ClientBarn(this);
        this.playerBarn = new PlayerBarn(this);
        this.lootBarn = new LootBarn(this);
        this.deadBodyBarn = new DeadBodyBarn(this);
        this.decalBarn = new DecalBarn(this);
        this.projectileBarn = new ProjectileBarn(this);
        this.bulletBarn = new BulletBarn(this);
        this.smokeBarn = new SmokeBarn(this);
        this.airdropBarn = new AirdropBarn(this);
        this.explosionBarn = new ExplosionBarn(this);
        this.planeBarn = new PlaneBarn(this);
        this.mapIndicatorBarn = new MapIndicatorBarn();

        this.gas = new Gas(this);

        this.modeManager = new GameModeManager(this);

        if (this.map.factionMode) {
            for (let i = 1; i <= this.map.mapDef.gameMode.factions!; i++) {
                this.playerBarn.addTeam(i);
            }
        }

        this.map.init();

        const fxDef = this.map.mapDef.biome.fx;
        this.fx = {
            effects: fxDef.effects,
            hour: fxDef.startHour,
            dayLength: fxDef.dayLength,
            weather: util.weightedRandom(fxDef.weather).name,
        };

        this.logger.debug("game.created", { durationMs: Date.now() - start });

        this.updateData();
    }

    /** the match fx with the clock moved to now, for a client that is joining */
    currentFx(): MatchFx {
        const { dayLength, hour } = this.fx;
        if (dayLength <= 0) return this.fx;
        const elapsed = (Date.now() - this.startedAt) / 1000;
        return { ...this.fx, hour: (hour + (elapsed / dayLength) * 24) % 24 };
    }

    update(dt?: number) {
        if (this.stopped) return;
        this.profiler.flush();

        const now = performance.now();
        if (!this.now) this.now = now;
        dt ??= math.clamp((now - this.now) / 1000, 0.001, 1 / 8);

        this.timeRunning += dt;

        dt *= this.debugSpeedMulti;

        this.now = now;

        if (this.over) {
            this.stopTicker -= dt;
            if (this.stopTicker <= 0) {
                this.stop();
                return;
            }
        }

        if (!this.started && !this.preventStart) {
            this.started = this.modeManager.isGameStarted();
            if (this.started) {
                this.gas.advanceGasStage();
            } else {
                const connected = this.playerBarn.players.reduce((a, b) => {
                    return a + (b.disconnected ? 0 : 1);
                }, 0);
                if (connected === 0) {
                    this.noPlayersTicker += dt;
                } else {
                    this.noPlayersTicker = 0;
                }
                // after 30 seconds of no connected players on a game that didn't start
                // we just force stop the game so it doesn't run forever...
                if (this.noPlayersTicker > 30) {
                    this.over = true;
                    this.stop();
                    return;
                }
            }
        }

        if (this.started) this.startedTime += dt;

        //
        // Update modules
        //
        this.profiler.addSample("gas");
        this.gas.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("players");
        this.playerBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("clients");
        this.clientBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("map");
        this.map.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("loot");
        this.lootBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("bullets");
        this.bulletBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("projectiles");
        this.projectileBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("explosions");
        this.explosionBarn.update();
        this.profiler.endSample();

        this.profiler.addSample("smoke");
        this.smokeBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("airdrops");
        this.airdropBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("deadBodies");
        this.deadBodyBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("decals");
        this.decalBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("planes");
        this.planeBarn.update(dt);
        this.profiler.endSample();

        const tickTime = performance.now() - this.now;

        this.tickStats.add(tickTime);
        this.tickWindow.add(tickTime);
        if (tickTime > (1000 / this.options.gameTps) * 2) {
            this.slowTickCount++;
            const suppressed = this.slowTickThrottle.hit(Date.now());
            if (suppressed !== undefined) {
                this.logger[tickTime > 1000 ? "error" : "warn"]("game.slow_tick", {
                    ms: Math.round(tickTime * 100) / 100,
                    suppressed,
                    profile: this.profiler.getStats(),
                });
            }
        }
    }

    netSync() {
        if (this.stopped) return;

        const start = performance.now();

        // serialize objects and send msgs
        this.objectRegister.serializeObjs();
        this.clientBarn.sendMsgs();

        //
        // reset stuff
        //
        this.clientBarn.flush();
        this.playerBarn.flush();
        this.lootBarn.flush();
        this.planeBarn.flush();
        this.bulletBarn.flush();
        this.objectRegister.flush();
        this.explosionBarn.flush();
        this.gas.flush();
        this.mapIndicatorBarn.flush();

        const syncTime = performance.now() - start;
        this.netSyncStats.add(syncTime);
        this.netSyncWindow.add(syncTime);
        if (syncTime > (1000 / this.options.netSyncTps) * 2) {
            this.slowNetSyncCount++;
            const suppressed = this.slowNetSyncThrottle.hit(Date.now());
            if (suppressed !== undefined) {
                this.logger[syncTime > 1000 ? "error" : "warn"]("game.slow_netsync", {
                    ms: Math.round(syncTime * 100) / 100,
                    suppressed,
                });
            }
        }
    }

    get canJoin(): boolean {
        return (
            this.aliveCount < this.map.mapDef.gameMode.maxPlayers
            && !this.over
            && this.startedTime < 60
        );
    }

    checkGameOver() {
        if (this.over) return;

        const didGameEnd = this.started
            && this.modeManager.aliveCount() < this.options.minPlayers;

        if (didGameEnd) {
            this.over = true;

            // send win emoji after 1 second
            this.playerBarn.sendWinEmoteTicker = 1;
            // stop game after 1.8s
            this.stopTicker = 1.8;

            const mvp = this.modeManager.getFactionMvp();
            this.playerBarn.factionsMvp = mvp;
            mvp?.questManager.trackEvent("be_mvp", { role: mvp.role });

            this.winningTeamId = this.modeManager.getWinningTeamId();
            // forcefully flush progress, because after this point, any unsynced updates are lost
            for (const player of this.playerBarn.players) {
                player.questManager.flushProgress(this.winningTeamId);
            }
            this.updateData();
        }
    }

    addJoinTokens(tokens: FindGamePrivateBody["playerData"], autoFill: boolean) {
        const groupData = {
            playerCount: tokens.length,
            groupHashToJoin: "",
            autoFill,
        };

        for (const token of tokens) {
            this.joinTokens.set(token.joinToken, {
                type: "join",
                expiresAt: Date.now() + 10000,
                data: {
                    userId: token.userId,
                    groupData,
                    findGameIp: token.ip,
                    loadout: token.loadout,
                    quests: token.quests,
                },
            });
        }
    }

    addSpectateToken(token: string, data: SpectateTokenData) {
        this.joinTokens.set(token, {
            type: "spectate",
            expiresAt: Date.now() + 60000,
            data,
        });
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        for (const client of this.clientBarn.clients) {
            client.disconnect();
        }
        this.logger.info("game.end", {
            durationMs: Date.now() - this.startedAt,
            playersPeak: this.playersPeak,
            playersTotal: this.playersTotal,
            ...flatStats("tick", this.tickStats),
            ...flatStats("netSync", this.netSyncStats),
            slowTicks: this.slowTickCount,
            slowNetSyncs: this.slowNetSyncCount,
            reason: this.started && this.over ? "finished" : "stopped",
        });
        this.hooks.saveGame?.(this);
        this.updateData();
    }

    updateData() {
        this.hooks.updateData?.(this);
    }

    getData(): GameData {
        return {
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
        };
    }

    matchData(): MatchDataRow[] {
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

        return players.map(({ player, rank }) => {
            return {
                // *NOTE: userId is optional; we save the game stats for non logged users too
                userId: player.userId,
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
    }

    /**
     * Steps the game X seconds in the future
     * This is done in smaller steps of 0.1 seconds
     * To make sure everything updates properly
     *
     * Used for unit tests, don't call this on actual game code :p
     */
    step(seconds: number) {
        for (let i = 0, steps = seconds * 10; i < steps; i++) {
            this.update(0.1);
        }
    }
}
