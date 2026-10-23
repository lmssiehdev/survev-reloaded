import type { FindGamePrivateBody } from "@survev/contracts";
import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import type { Loadout } from "@survev/shared/utils/loadout.ts";
import { math } from "@survev/shared/utils/math.ts";
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
import { Throttle, TickStats } from "./tickStats.ts";

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
    logger: GameLogger;

    // for debug
    preventStart = false;
    debugSpeedMulti = 1;

    constructor(id: string, config: GameMode, options: GameOptions) {
        const start = Date.now();
        this.id = id;
        this.options = options;
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

        this.logger.debug("game.created", { durationMs: Date.now() - start });

        this.updateData();
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

        const didGameEnd = this.started && this.modeManager.aliveCount() <= 1;

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
            tick: this.tickStats.summary(),
            netSync: this.netSyncStats.summary(),
            slowTicks: this.slowTickCount,
            slowNetSyncs: this.slowNetSyncCount,
            reason: this.started && this.over ? "finished" : "stopped",
        });
        this._saveGameToDatabase();
        this.updateData();
    }

    // implementation of those is on gameProcess.ts
    // this keeps the base Game class free of nodejs imports and the ability to make network requests
    // to make offline mode and unit tests easier to maintain

    updateData() {}
    protected _saveGameToDatabase() {}
    sendQuestProgress(_userId: string, _progress: Array<{ id: string; delta: number }>) {}

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
