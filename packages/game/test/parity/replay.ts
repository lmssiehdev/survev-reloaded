// Runs one scenario against one source tree and writes a trace of rolling hashes.
// usage: bun replay.ts <treeRoot> <fork|upstream> <scenario> <out.json>
// prelude must stay the first import: it seeds Math.random and freezes Date.now before any game
// module evaluates.
import { writeFileSync } from "node:fs";
import { Hasher } from "./hash.ts";
import { IGNORED_KEYS } from "./ignored.ts";
import { clock, rng } from "./prelude.ts";
import type { Bot, Scenario, ScenarioCtx } from "./scenario.ts";
import { findScenario } from "./scenarios.ts";
import { type LoadedTree, loadTree, type TreeLayout } from "./trees.ts";

export const CHECKPOINT_EVERY = 50;

export interface Checkpoint {
    tick: number;
    state: string;
    rng: string;
    grid: string;
    canon: string;
    raw: string;
    alive: number;
}

export interface Trace {
    scenario: string;
    layout: TreeLayout;
    bun: string;
    defs: string;
    map: string;
    ticksRun: number;
    checkpoints: Checkpoint[];
    final: Omit<Checkpoint, "tick" | "alive">;
    coverage: Record<string, number>;
    wallMs: number;
    /** timing mode only */
    timing?: Timing;
}

export interface Timing {
    /** ms per tick over the last 90% of ticks */
    steadyUpd: number;
    /** ms per netSync over the last 90% of ticks */
    steadySync: number;
    /** per tick update + netSync, ms */
    p50: number;
    p99: number;
    max: number;
    rssMb: number;
}

/** script rng for bot behaviour, separate from Math.random */
function scriptRng(seed: number) {
    let s = seed | 0;
    return () => {
        s = (s + 0x9e3779b9) | 0;
        let t = Math.imul(s ^ (s >>> 16), 0x21f0aaad);
        t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
        return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    };
}

const MAX_DEPTH = 4;

const keyHashes = new Map<string, number>();
/** a 32 bit hash per key name, so hashing a key costs one u32 instead of its characters */
function keyHash(k: string): number {
    let v = keyHashes.get(k);
    if (v === undefined) {
        const h = new Hasher();
        h.str(k);
        v = h.a;
        keyHashes.set(k, v);
    }
    return v;
}

/**
 * Exact hash of plain gameplay state. Keys are sorted so declaration order doesn't matter,
 * references to other game objects hash as their id, and engine-level objects (barns, grid,
 * map, sockets) are skipped by identity.
 */
class StateHasher {
    skip = new WeakSet<object>();
    /** debug: when set, every hashed leaf is also written here as "path=value" */
    dump?: string[];
    path = "";
    /** sorting keys per object dominated the replay; shapes repeat, so cache them per constructor */
    shapes = new Map<unknown, { raw: string[]; sorted: string[] }[]>();
    constructor(public h: Hasher) {}

    sortedKeys(o: object): string[] {
        const raw = Object.keys(o);
        let list = this.shapes.get(o.constructor);
        if (!list) this.shapes.set(o.constructor, list = []);
        outer: for (const shape of list) {
            if (shape.raw.length !== raw.length) continue;
            for (let i = 0; i < raw.length; i++) if (shape.raw[i] !== raw[i]) continue outer;
            return shape.sorted;
        }
        const sorted = raw.filter((k) => !IGNORED_KEYS.has(k)).sort();
        if (list.length < 16) list.push({ raw, sorted });
        return sorted;
    }

    value(v: unknown, depth: number): void {
        const h = this.h;
        if (this.dump && (v === null || typeof v !== "object" || this.skip.has(v as object))) {
            this.dump.push(`${this.path}=${typeof v === "object" && v !== null ? "<skip>" : String(v)}`);
        }
        switch (typeof v) {
            case "number":
                h.u8(1);
                h.num(v);
                return;
            case "boolean":
                h.u8(v ? 2 : 3);
                return;
            case "string":
                h.u8(4);
                h.str(v);
                return;
            case "undefined":
                h.u8(5);
                return;
            case "function":
            case "symbol":
            case "bigint":
                h.u8(6);
                return;
        }
        if (v === null) return h.u8(7);
        const o = v as any;
        if (this.skip.has(o)) return h.u8(8);
        if (depth > 0 && typeof o.__id === "number" && typeof o.__type === "number") {
            h.u8(9);
            h.u32(o.__id);
            return;
        }
        if (ArrayBuffer.isView(o)) {
            h.u8(10);
            const b = o as unknown as Uint8Array;
            h.u32(b.byteLength);
            if (b.byteLength <= 256) h.bytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
            return;
        }
        if (o instanceof Set || o instanceof Map) {
            // only netcode keeps Sets/Maps of game objects; those are covered by the wire tiers
            h.u8(12);
            h.u32(o.size);
            return;
        }
        if (depth >= MAX_DEPTH) return h.u8(13);
        if (Array.isArray(o)) {
            h.u8(11);
            h.u32(o.length);
            for (let i = 0; i < o.length; i++) this.value(o[i], depth + 1);
            return;
        }
        const keys = this.sortedKeys(o);
        h.u8(14);
        h.u32(keys.length);
        const base = this.path;
        for (const k of keys) {
            h.u32(keyHash(k));
            if (this.dump) this.path = `${base}.${k}`;
            this.value(o[k], depth + 1);
        }
        this.path = base;
    }
}

/** insertion-ordered deep hash for definitions and decoded messages; key order is meaningful there */
function hashOrdered(h: Hasher, v: unknown, seen = new Set<object>()): void {
    if (v === null || typeof v !== "object") {
        if (typeof v === "number") {
            h.u8(1);
            h.num(v);
        } else if (typeof v === "string") {
            h.u8(4);
            h.str(v);
        } else if (typeof v === "boolean") h.u8(v ? 2 : 3);
        else if (typeof v === "function") {
            h.u8(6);
            h.str(String(v));
        } else h.u8(v === null ? 7 : 5);
        return;
    }
    if (seen.has(v)) return h.u8(15);
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
        const b = v as unknown as Uint8Array;
        h.bytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    } else if (Array.isArray(v)) {
        h.u8(11);
        h.u32(v.length);
        for (const x of v) hashOrdered(h, x, seen);
    } else {
        const keys = Object.keys(v);
        h.u8(14);
        h.u32(keys.length);
        for (const k of keys) {
            h.str(k);
            hashOrdered(h, (v as any)[k], seen);
        }
    }
    seen.delete(v);
}

const byId = (a: { __id: number }, b: { __id: number }) => a.__id - b.__id;

export async function replay(root: string, layout: TreeLayout, scenario: Scenario): Promise<Trace> {
    return replayLoaded(await loadTree(root, layout), layout, scenario);
}

/** timing: no hashing or decoding at all, only per tick update / netSync times */
export async function replayLoaded(
    tree: LoadedTree,
    layout: TreeLayout,
    scenario: Scenario,
    { timing = false } = {},
): Promise<Trace> {
    const { net, GameConfig: G } = tree;
    const wall0 = performance.now();

    const defsH = new Hasher();
    hashOrdered(defsH, tree.defs);

    const game = tree.newGame(
        `parity-${scenario.name}`,
        { mapName: scenario.mapName, teamMode: scenario.teamMode },
        !!scenario.fixedSpawn,
    );

    // map generation output: the serialized MapMsg plus every object that exists before anyone joins
    const mapH = new Hasher();
    const mapState = new StateHasher(mapH);
    for (const v of Object.values(game)) if (v && typeof v === "object" && v !== game.gas) mapState.skip.add(v);
    mapState.skip.add(game);
    mapH.bytes(game.map.mapStream.getBuffer());
    for (const o of game.objectRegister.objects) if (o) mapState.value(o, 0);

    // CANONICAL wire: decode what each client receives and sort the three object lists by id
    const msgClasses: Record<number, any> = {
        [net.MsgType.Joined]: net.JoinedMsg,
        [net.MsgType.Map]: net.MapMsg,
        [net.MsgType.Update]: net.UpdateMsg,
        [net.MsgType.Kill]: net.KillMsg,
        [net.MsgType.GameOver]: net.GameOverMsg,
        [net.MsgType.Pickup]: net.PickupMsg,
        [net.MsgType.PlayerStats]: net.PlayerStatsMsg,
        [net.MsgType.RoleAnnouncement]: net.RoleAnnouncementMsg,
        [net.MsgType.AliveCounts]: net.AliveCountsMsg,
        [net.MsgType.Emote]: net.EmoteMsg,
        [net.MsgType.PerkModeRoleSelect]: net.PerkModeRoleSelectMsg,
    };
    const typeCreator = { m_getTypeById: () => 0 };
    const coverage: Record<string, number> = {};
    const count = (label: string, n = 1) => {
        coverage[label] = (coverage[label] ?? 0) + n;
    };

    function canonical(h: Hasher, buf: Uint8Array) {
        const ms = new net.MsgStream(buf.slice().buffer);
        for (;;) {
            const type = ms.deserializeMsgType();
            if (type === net.MsgType.None) break;
            const Cls = msgClasses[type];
            if (!Cls) throw new Error(`parity: no decoder for MsgType ${type}`);
            const msg = new Cls();
            msg.deserialize(ms.getStream(), typeCreator);
            ms.stream.readAlignToNextByte();
            if (type === net.MsgType.Update) {
                for (const list of ["fullObjects", "partObjects"]) {
                    const ids = msg[list].map((o: any) => o.__id);
                    if (new Set(ids).size !== ids.length) throw new Error(`parity: duplicate id in ${list}`);
                    msg[list].sort(byId);
                }
                msg.delObjIds.sort((a: number, b: number) => a - b);
                count("wire.fullObjects", msg.fullObjects.length);
                count("wire.partObjects", msg.partObjects.length);
                count("wire.delObjIds", msg.delObjIds.length);
            }
            h.u32(type);
            hashOrdered(h, msg);
        }
    }

    class Sock extends tree.ClientSocket {
        closedFlag = false;
        raw = new Hasher();
        canon = new Hasher();
        constructor(public index: number) {
            super();
        }
        ip() {
            return `10.0.${this.index >> 8}.${this.index & 255}`;
        }
        closed() {
            return this.closedFlag;
        }
        close() {
            this.closedFlag = true;
        }
        send(b: Uint8Array) {
            if (timing) return;
            this.raw.bytes(b);
            canonical(this.canon, b);
        }
    }

    const mk = (type: number, m: unknown) => {
        const st = new net.MsgStream(new ArrayBuffer(1024));
        st.serializeMsg(type, m);
        return st.getBuffer().slice().buffer;
    };

    const tokens = [];
    for (let i = 0; i < scenario.bots; i++) tokens.push({ joinToken: `t${i}`, userId: null, ip: `10.1.0.${i}` });
    game.addJoinTokens(tokens, true);

    const socks: InstanceType<typeof Sock>[] = [];
    const bots: Bot[] = [];
    for (let i = 0; i < scenario.bots; i++) {
        const j = new net.JoinMsg();
        j.protocol = G.protocolVersion;
        j.joinToken = `t${i}`;
        j.name = `b${i}`;
        const s = new Sock(i);
        socks.push(s);
        game.clientBarn.handleMsg(mk(net.MsgType.Join, j), s);
        const client = game.clientBarn.clients.find((c: any) => c.socket === s);
        bots.push({
            index: i,
            auto: true,
            input: { left: false, right: false, up: false, down: false, shoot: false, aim: 0, inputs: [] },
            get player() {
                return client?.player;
            },
        });
    }

    // every object reachable from game that isn't gameplay state (barns, grid, map, clients...)
    const stateH = new Hasher();
    const state = new StateHasher(stateH);
    for (const v of Object.values(game)) if (v && typeof v === "object" && v !== game.gas) state.skip.add(v);
    state.skip.add(game);
    for (const c of game.clientBarn.clients) state.skip.add(c);
    for (const s of socks) state.skip.add(s);

    // STRICT grid query order: every sim-side query result, in order. intersectAABBSet only feeds
    // client visibility, which the wire tiers cover.
    const gridH = new Hasher();
    const gridProto = Object.getPrototypeOf(game.grid);
    if (!timing) {
        ["intersectCollider", "intersectGameObject", "intersectPos", "intersectLineSegment"].forEach((m, mi) => {
            const f = gridProto[m];
            if (typeof f !== "function") throw new Error(`parity: Grid.${m} missing`);
            gridProto[m] = function(this: unknown, ...a: unknown[]) {
                const r = f.apply(this, a) as { __id: number }[];
                gridH.u8(mi);
                gridH.u32(r.length);
                for (let i = 0; i < r.length; i++) gridH.u32(r[i].__id);
                return r;
            };
        });
    }

    const rngH = new Hasher();
    const sr = scriptRng(scenario.seed ^ 0x5bd1e995);
    const ctx: ScenarioCtx = {
        game,
        GameConfig: G,
        tick: 0,
        bots,
        rand: sr,
        count,
        countCalls(obj, method, label) {
            const f = obj?.[method];
            if (typeof f !== "function") throw new Error(`parity: ${label}: no method ${method}`);
            coverage[label] ??= 0;
            if (timing) return;
            obj[method] = function(this: unknown, ...a: unknown[]) {
                coverage[label]++;
                return f.apply(this, a);
            };
        },
    };
    for (
        const [label, obj, m] of [
            ["bullets", game.bulletBarn, "fireBullet"],
            ["explosions", game.explosionBarn, "addExplosion"],
            ["projectiles", game.projectileBarn, "addProjectile"],
            ["loot", game.lootBarn, "addLoot"],
            ["deadBodies", game.deadBodyBarn, "addDeadBody"],
        ] as const
    ) ctx.countCalls(obj, m, label);
    scenario.setup?.(ctx);

    const IP = G.Input;
    const pool = [
        IP.Interact,
        IP.Interact,
        IP.Interact,
        IP.Reload,
        IP.EquipPrimary,
        IP.EquipSecondary,
        IP.EquipThrowable,
        IP.EquipMelee,
        IP.Cancel,
        IP.UseBandage,
        IP.UseHealthKit,
        IP.UsePainkiller,
        IP.UseSoda,
        IP.SwapWeapSlots,
    ];
    const checkpoints: Checkpoint[] = [];
    const combined = (k: "raw" | "canon") => {
        const h = new Hasher();
        for (const s of socks) h.str(s[k].hex());
        return h.hex();
    };
    const snapshot = () => ({
        state: stateH.hex(),
        rng: rngH.hex(),
        grid: gridH.hex(),
        canon: combined("canon"),
        raw: combined("raw"),
    });

    const hist: number[] = [];
    let updSum = 0;
    let syncSum = 0;
    let syncN = 0;
    let seq = 0;
    let synced = 0;
    let ticksRun = 0;
    const ticks = Number(process.env.PARITY_TICKS ?? scenario.ticks);
    for (let t = 0; t < ticks && !game.stopped; t++) {
        clock.now += 10;
        ctx.tick = t;
        scenario.tick?.(ctx);
        if (t % 3 === 0) {
            for (const b of bots) {
                const s = socks[b.index];
                if (s.closedFlag) continue;
                const k = b.input;
                if (b.auto) {
                    if (sr() < 0.02) {
                        k.left = sr() < 0.4;
                        k.right = !k.left && sr() < 0.6;
                        k.up = sr() < 0.4;
                        k.down = !k.up && sr() < 0.6;
                    }
                    if (sr() < 0.1) k.aim = sr() * Math.PI * 2;
                    if (sr() < 0.03) k.shoot = sr() < 0.5;
                    if (sr() < 0.25) k.inputs.push(pool[Math.floor(sr() * pool.length)]);
                }
                const m = new net.InputMsg();
                m.seq = seq++ & 255;
                m.moveLeft = k.left;
                m.moveRight = k.right;
                m.moveUp = k.up;
                m.moveDown = k.down;
                m.shootHold = k.shoot;
                m.shootStart = k.shoot;
                m.toMouseDir = { x: Math.cos(k.aim), y: Math.sin(k.aim) };
                m.toMouseLen = 20;
                for (const inp of k.inputs) m.addInput(inp);
                k.inputs.length = 0;
                game.clientBarn.handleMsg(mk(net.MsgType.Input, m), s);
            }
        }
        rngH.u32(rng.calls);
        const u0 = performance.now();
        game.update(0.01);
        const u1 = performance.now();
        rngH.u32(rng.calls);
        const want = Math.floor(((t + 1) * 33) / 100);
        let sync = 0;
        if (want > synced) {
            synced = want;
            const s0 = performance.now();
            game.netSync();
            sync = performance.now() - s0;
            rngH.u32(rng.calls);
        }
        ticksRun = t + 1;
        if (timing) {
            if (t >= ticks / 10) {
                hist.push(u1 - u0 + sync);
                updSum += u1 - u0;
                if (sync) {
                    syncSum += sync;
                    syncN++;
                }
            }
            continue;
        }

        // dynamic objects every tick; obstacles (most objects, rarely changing) every checkpoint
        stateH.u32(t);
        const full = t % CHECKPOINT_EVERY === CHECKPOINT_EVERY - 1;
        if (t === Number(process.env.PARITY_DUMP_TICK)) state.dump = [];
        for (const o of game.objectRegister.objects) {
            if (!o) continue;
            state.path = `obj${o.__id}`;
            if (full || o.__type !== 2 /* ObjectType.Obstacle */) state.value(o, 0);
        }
        for (const b of game.bulletBarn.bullets) state.value(b, 0);
        state.value(game.gas, 0);
        stateH.u32(game.playerBarn.livingPlayers.length);
        for (const p of game.playerBarn.livingPlayers) stateH.u32(p.__id);
        if (state.dump) {
            writeFileSync(process.env.PARITY_DUMP_FILE ?? "/dev/stderr", state.dump.join("\n"));
            state.dump = undefined;
        }

        if (t % CHECKPOINT_EVERY === CHECKPOINT_EVERY - 1) {
            checkpoints.push({ tick: t, alive: game.playerBarn.livingPlayers.length, ...snapshot() });
        }
    }
    let timingOut: Timing | undefined;
    if (timing) {
        hist.sort((a, b) => a - b);
        const q = (p: number) => +hist[Math.min(hist.length - 1, Math.floor(hist.length * p))].toFixed(4);
        timingOut = {
            steadyUpd: +(updSum / hist.length).toFixed(4),
            steadySync: +(syncSum / Math.max(syncN, 1)).toFixed(4),
            p50: q(0.5),
            p99: q(0.99),
            max: q(1),
            rssMb: Math.round(process.memoryUsage().rss / 1048576),
        };
    }
    count("ticks", ticksRun);
    count("alive.end", game.playerBarn.livingPlayers.length);
    if (game.over) count("gameOver");

    return {
        scenario: scenario.name,
        layout,
        bun: Bun.version + "+" + Bun.revision.slice(0, 9),
        defs: defsH.hex(),
        map: mapH.hex(),
        ticksRun,
        checkpoints,
        final: snapshot(),
        coverage,
        wallMs: Math.round(performance.now() - wall0),
        timing: timingOut,
    };
}

if (import.meta.main) {
    const [root, layout, name, out] = process.argv.slice(2);
    const scenario = findScenario(name);
    if (Number(process.env.PARITY_SEED) !== scenario.seed) {
        throw new Error(`parity: run with PARITY_SEED=${scenario.seed}, prelude seeds Math.random from it`);
    }
    const trace = await replay(root, layout as TreeLayout, scenario);
    writeFileSync(out, JSON.stringify(trace));
    process.exit(0);
}
