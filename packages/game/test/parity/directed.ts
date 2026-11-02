import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { collider } from "@survev/shared/utils/collider.ts";
import { math } from "@survev/shared/utils/math.ts";
import type { Bot, Scenario, ScenarioCtx } from "./scenario.ts";

// Scripts drive bots through inputs. Direct state writes are limited to setup-style calls that
// exist with the same meaning in the fork and upstream: teleporting (pos + grid.updateObject),
// weaponManager.setWeapon, invManager.set, armor fields, health top-ups, and the gas ticker.
// The shared/ imports here are only read by the scripts; defs are hashed equal on both trees.

const OBSTACLE = 2;
const STRUCTURE = 7;

interface V {
    x: number;
    y: number;
}

const v = (x: number, y: number): V => ({ x, y });
const add = (a: V, b: V, s = 1): V => v(a.x + b.x * s, a.y + b.y * s);
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (a: V, b: V) => Math.atan2(b.y - a.y, b.x - a.x);

function defType(type: string | undefined): string {
    return (type && (GameObjectDefs.typeToDefSafe(type) as any)?.type) || "none";
}

/** runs hook before obj[method]; never changes arguments or result */
function before(obj: any, method: string, hook: (self: any, ...a: any[]) => void) {
    const f = obj[method];
    if (typeof f !== "function") throw new Error(`parity: no method ${method}`);
    obj[method] = function(this: unknown, ...a: unknown[]) {
        hook(this, ...a);
        return f.apply(this, a);
    };
}

/** coverage hooks shared by every directed scenario */
function instrument(ctx: ScenarioCtx) {
    const { game, GameConfig: G } = ctx;
    const player = ctx.bots[0].player;
    const obstacle = game.objectRegister.objects.find((o: any) => o?.__type === OBSTACLE);
    for (const b of ctx.bots) b.auto = false;
    before(Object.getPrototypeOf(player), "damage", (self, params) => {
        if (self.dead) return;
        if (self.downed) ctx.count("dmg.downed");
        if (params.damageType === G.DamageType.Gas) return ctx.count("dmg.gas");
        if (params.damageType === G.DamageType.Bleeding) return ctx.count("dmg.bleed");
        if (params.isExplosion) return ctx.count("dmg.explosion");
        ctx.count(`dmg.${defType(params.gameSourceType)}`);
    });
    before(Object.getPrototypeOf(player), "kill", (self, params) => {
        if (self.dead) return;
        ctx.count("kill");
        if (params.damageType === G.DamageType.Gas) ctx.count("kill.gas");
    });
    before(Object.getPrototypeOf(player), "down", () => ctx.count("down"));
    before(Object.getPrototypeOf(player), "pickupLoot", () => ctx.count("pickup"));
    before(Object.getPrototypeOf(player.weaponManager), "meleeDamage", () => ctx.count("melee.swing"));
    if (obstacle) {
        before(Object.getPrototypeOf(obstacle), "damage", (self, params) => {
            if (self.dead) return;
            ctx.count(params.isExplosion ? "obs.dmg.explosion" : `obs.dmg.${defType(params.gameSourceType)}`);
        });
        before(Object.getPrototypeOf(obstacle), "kill", (self) => {
            if (!self.dead) ctx.count("obs.destroyed");
        });
    }
    before(Object.getPrototypeOf(game.gas), "advanceGasStage", () => ctx.count("gas.stage"));
    before(game.projectileBarn, "addProjectile", (_self, _playerId, type) => ctx.count(`proj.${type}`));
    before(game.smokeBarn, "addEmitter", () => ctx.count("smoke"));
    if (player.group) {
        before(Object.getPrototypeOf(player.group), "killAllDowned", () => ctx.count("teamWipe"));
    }
}

/** per-tick state transitions the hooks can't see: revives and layer changes */
function track(ctx: ScenarioCtx, prev: { downed: boolean[]; layer: number[] }) {
    for (const b of ctx.bots) {
        const p = b.player;
        if (prev.downed[b.index] && !p.downed && !p.dead) ctx.count("revived");
        if (prev.layer[b.index] !== undefined && prev.layer[b.index] !== p.layer) ctx.count("layer.change");
        if (!p.dead && p.layer === 1) ctx.count("layer.under");
        prev.downed[b.index] = p.downed;
        prev.layer[b.index] = p.layer;
    }
}

function teleport(ctx: ScenarioCtx, p: any, pos: V, layer = 0) {
    // v2.set semantics: collider.pos aliases pos
    p.pos.x = pos.x;
    p.pos.y = pos.y;
    p.layer = layer;
    ctx.game.map.clampToMapBounds(p.pos, p.rad);
    ctx.game.grid.updateObject(p);
    p.setDirty();
}

function stop(b: Bot) {
    Object.assign(b.input, { left: false, right: false, up: false, down: false });
}

/** 8-way movement toward a direction */
function steer(b: Bot, dx: number, dy: number) {
    const len = Math.hypot(dx, dy);
    if (len < 0.25) return stop(b);
    const t = len * 0.38;
    const k = b.input;
    k.right = dx > t;
    k.left = dx < -t;
    k.up = dy > t;
    k.down = dy < -t;
}

const steerTo = (b: Bot, to: V) => steer(b, to.x - b.player.pos.x, to.y - b.player.pos.y);

function aimAt(ctx: ScenarioCtx, b: Bot, to: V, jitter = 0) {
    b.input.aim = angleTo(b.player.pos, to) + (ctx.rand() - 0.5) * 2 * jitter;
}

const AMMO = ["9mm", "762mm", "556mm", "12gauge", "50AE", "308sub", "45acp"];

function giveGun(ctx: ScenarioCtx, p: any, slot: number, type: string) {
    const def = GameObjectDefs.typeToDef(type, "gun") as any;
    p.weaponManager.setWeapon(slot, type, def.maxClip);
    p.invManager.set(def.ammo, 300);
}

function refillAmmo(p: any) {
    for (const a of AMMO) if (p.invManager.get(a) < 60) p.invManager.set(a, 300);
}

function armor(p: any, level: number) {
    if (level <= 0) return;
    p.helmet = `helmet0${level}`;
    p.chest = `chest0${level}`;
    p.backpack = `backpack0${level}`;
    p.setDirty();
}

/** a little loot for victims to drop */
function pockets(p: any) {
    p.invManager.set("bandage", 5);
    p.invManager.set("soda", 2);
    p.invManager.set("9mm", 60);
}

function heal(p: any, below: number) {
    if (!p.dead && !p.downed && p.health < below) p.health = 100;
}

function onWater(map: any, pos: V): boolean {
    for (const r of map.terrain.rivers) if (math.pointInsidePolygon(pos, r.waterPoly)) return true;
    return !math.pointInsidePolygon(pos, map.terrain.shore);
}

function obstacles(ctx: ScenarioCtx, pred: (o: any) => boolean): any[] {
    return ctx.game.objectRegister.objects.filter((o: any) => o && o.__type === OBSTACLE && !o.dead && pred(o));
}

/** least obstructed dry spot out of a few samples */
function openSpot(ctx: ScenarioCtx, solid: any[], clear: number): V {
    const map = ctx.game.map;
    let best = v(map.width / 2, map.height / 2);
    let bestN = Infinity;
    for (let i = 0; i < 60 && bestN > 0; i++) {
        const p = v(map.width * (0.2 + ctx.rand() * 0.6), map.height * (0.2 + ctx.rand() * 0.6));
        if (onWater(map, p)) continue;
        let n = 0;
        for (const o of solid) if (dist(o.pos, p) < clear) n++;
        if (n < bestN) {
            bestN = n;
            best = p;
        }
    }
    return best;
}

/**
 * test_normal is bare grass; give it a house, a container, a shack, rows of crates and barrels,
 * and tree/stone pairs close enough to touch both. Kept clear of the band |y - center| < 20 where
 * the scripted fights happen. genBuilding/genObstacle are the map generator's own calls in both trees.
 */
function furnish(ctx: ScenarioCtx): V {
    const map = ctx.game.map;
    const c = v(map.width / 2, map.height / 2);
    map.genBuilding("house_red_01", add(c, v(-38, 42)), 0, 0);
    map.genBuilding("container_01", add(c, v(36, 40)), 0, 1);
    map.genBuilding("shack_01", add(c, v(38, -44)), 0, 0);
    for (let x = -42; x <= 12; x += 9) {
        map.genObstacle("tree_01", add(c, v(x, -32)), 0, 0, 1);
        map.genObstacle("stone_01", add(c, v(x + 3.6, -33)), 0, 0, 1);
    }
    for (let x = -30; x <= 30; x += 5.4) map.genObstacle("crate_01", add(c, v(x, -25)), 0, 0, 1);
    for (let x = -30; x <= 30; x += 7) map.genObstacle("barrel_01", add(c, v(x, 30)), 0, 0, 1);
    return c;
}

function nearest<T extends { pos: V }>(list: T[], pos: V, ok: (x: T) => boolean = () => true): T | undefined {
    let best: T | undefined;
    let bestD = Infinity;
    for (const x of list) {
        const d = dist(x.pos, pos);
        if (d < bestD && ok(x)) {
            bestD = d;
            best = x;
        }
    }
    return best;
}

/** walk onto the nearest loot within range and press Interact; false when there is none */
function seekLoot(ctx: ScenarioCtx, b: Bot, range = 40): boolean {
    const p = b.player;
    const loot = nearest(
        ctx.game.lootBarn.loots as any[],
        p.pos,
        (l) => !l.destroyed && (l.layer & 1) === (p.layer & 1) && dist(l.pos, p.pos) < range,
    );
    if (!loot) return false;
    b.input.shoot = false;
    steerTo(b, loot.pos);
    aimAt(ctx, b, loot.pos);
    if (dist(loot.pos, p.pos) < p.rad + 1.5) b.input.inputs.push(ctx.GameConfig.Input.Interact);
    return true;
}

/** fight the opponent, keeping roughly `range` away and strafing */
function duel(ctx: ScenarioCtx, b: Bot, foe: any, range: number, jitter: number) {
    const p = b.player;
    aimAt(ctx, b, foe.pos, jitter);
    b.input.shoot = true;
    const d = dist(p.pos, foe.pos);
    const a = angleTo(p.pos, foe.pos);
    const side = Math.floor((ctx.tick + b.index * 37) / 120) % 2 ? 1 : -1;
    const radial = d > range + 2 ? 1 : d < range - 2 ? -1 : 0;
    steer(b, Math.cos(a) * radial - Math.sin(a) * side * 0.8, Math.sin(a) * radial + Math.cos(a) * side * 0.8);
}

/**
 * Last phase for scenarios whose target isn't combat: pairs teleport to open ground, the even bot
 * shotguns the odd one (low health, full pockets) and then picks up what it dropped.
 */
function finale(start: number) {
    let spots: V[] = [];
    return {
        setup(ctx: ScenarioCtx) {
            const solid = obstacles(ctx, (o) => o.collidable);
            const base = openSpot(ctx, solid, 30);
            spots = ctx.bots.map((_, i) => add(base, v(((i >> 1) % 4) * 10 - 15, Math.floor(i / 8) * 10 - 5)));
        },
        tick(ctx: ScenarioCtx): boolean {
            if (ctx.tick < start) return false;
            const { bots, GameConfig: G } = ctx;
            if (ctx.tick === start) {
                for (const b of bots) {
                    const p = b.player;
                    if (p.dead) continue;
                    stop(b);
                    b.input.shoot = false;
                    teleport(ctx, p, b.index & 1 ? add(spots[b.index], v(3.5, 0)) : spots[b.index]);
                    if (b.index & 1) {
                        pockets(p);
                        armor(p, 1);
                        p.health = 30;
                    } else {
                        giveGun(ctx, p, G.WeaponSlot.Primary, "m870");
                        b.input.inputs.push(G.Input.EquipPrimary);
                    }
                }
                return true;
            }
            if (ctx.tick % 3) return true;
            for (const b of bots) {
                const p = b.player;
                if (p.dead) continue;
                if (b.index & 1) {
                    stop(b);
                    continue;
                }
                const foe = bots[b.index + 1]?.player;
                if (foe && !foe.dead && ctx.tick < start + 300) {
                    aimAt(ctx, b, foe.pos);
                    b.input.shoot = true;
                    steerTo(b, add(foe.pos, v(-3, 0)));
                } else if (!seekLoot(ctx, b)) {
                    b.input.shoot = false;
                    stop(b);
                }
            }
            return true;
        },
    };
}

function tracker() {
    return { downed: [] as boolean[], layer: [] as number[] };
}

// ---------------------------------------------------------------------------------------------
// 1. movement and collision against obstacles

function collideObstacles(): Scenario {
    const end = finale(1900);
    const prev = tracker();
    let near: any[][] = [];
    let cats: any[][] = [];
    let target: (V | undefined)[] = [];
    let solid: any[] = [];
    return {
        name: "dir-collide",
        mapName: "test_normal",
        teamMode: 1,
        bots: 16,
        ticks: 2400,
        seed: 101,
        fixedSpawn: true,
        expect: ["contact.1", "contact.2+", "contact.wall", "contact.tree", "contact.crate", "kill", "loot", "pickup"],
        setup(ctx) {
            furnish(ctx);
            instrument(ctx);
            end.setup(ctx);
            solid = obstacles(ctx, (o) => o.collidable);
            const walls = solid.filter((o) => o.isWall);
            // spots where two solid obstacles are close enough for a player to touch both
            const pairs: V[] = [];
            for (let i = 0; i < 400 && pairs.length < 60; i++) {
                const a = solid[Math.floor(ctx.rand() * solid.length)];
                const b = nearest(solid, a.pos, (o) => o !== a && !o.isWall && !a.isWall);
                if (b && dist(a.pos, b.pos) < 5) pairs.push(v((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2));
            }
            cats = [
                walls,
                solid.filter((o) => o.isTree),
                solid.filter((o) => o.type.startsWith("crate")),
                solid.filter((o) => o.type.startsWith("stone")),
                solid.filter((o) => o.type.startsWith("barrel")),
                pairs.map((pos) => ({ pos })),
                walls,
                pairs.map((pos) => ({ pos })),
            ];
            near = ctx.bots.map(() => []);
            target = ctx.bots.map(() => undefined);
        },
        tick(ctx) {
            track(ctx, prev);
            for (const b of ctx.bots) {
                const p = b.player;
                if (p.dead) continue;
                let n = 0;
                for (const o of near[b.index]) {
                    if (o.dead || !o.collidable || (o.layer & 1) !== (p.layer & 1)) continue;
                    if (!collider.intersectCircle(o.collider, p.pos, p.rad + 0.02)) continue;
                    n++;
                    ctx.count(
                        o.isWall
                            ? "contact.wall"
                            : o.isTree
                            ? "contact.tree"
                            : o.type.startsWith("crate")
                            ? "contact.crate"
                            : "contact.other",
                    );
                }
                if (n === 1) ctx.count("contact.1");
                if (n >= 2) ctx.count("contact.2+");
            }
            if (end.tick(ctx)) return;
            const t = ctx.tick;
            for (const b of ctx.bots) {
                const p = b.player;
                const phase = (t + b.index * 23) % 600;
                if (phase === 0 || !target[b.index]) {
                    const list = cats[b.index % cats.length];
                    const o = list[Math.floor(ctx.rand() * list.length)];
                    const a = ctx.rand() * Math.PI * 2;
                    target[b.index] = v(o.pos.x, o.pos.y);
                    teleport(ctx, p, add(o.pos, v(Math.cos(a), Math.sin(a)), 4 + ctx.rand() * 2), o.layer ?? 0);
                    near[b.index] = solid.filter((s) => dist(s.pos, o.pos) < 14);
                }
                if (t % 3) continue;
                const to = target[b.index]!;
                const a = angleTo(p.pos, to);
                const toward = v(Math.cos(a), Math.sin(a));
                const perp = v(-toward.y, toward.x);
                aimAt(ctx, b, to, 0.3);
                if (phase < 150 || phase >= 450) steer(b, toward.x, toward.y);
                else if (phase < 300) steer(b, toward.x * 0.5 + perp.x, toward.y * 0.5 + perp.y);
                else steer(b, toward.x * 0.5 - perp.x, toward.y * 0.5 - perp.y);
            }
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 2. bullets: gun duels at several ranges plus shooting obstacles

const GUN_PAIRS: [string, string, number, number][] = [
    // a, b, range, armor level
    ["m870", "spas12", 10, 2],
    ["mp5", "ak47", 12, 1],
    ["m249", "vector", 20, 2],
    ["mk12", "deagle", 30, 1],
    ["m9", "mac10", 9, 3],
    ["m1014", "famas", 16, 0],
    ["saiga", "ump9", 8, 1],
    ["scar", "m4a1", 24, 3],
];

function bulletDuels(): Scenario {
    const prev = tracker();
    const STOP_HEALING = 2800;
    let foes: any[] = [];
    let targets: (any | undefined)[] = [];
    let destructible: any[] = [];
    return {
        name: "dir-bullets",
        mapName: "test_normal",
        teamMode: 1,
        bots: 20,
        ticks: 3500,
        seed: 102,
        fixedSpawn: true,
        expect: ["bullets", "dmg.gun", "obs.dmg.gun", "obs.destroyed", "kill", "loot", "pickup"],
        setup(ctx) {
            const arena = furnish(ctx);
            instrument(ctx);
            const G = ctx.GameConfig;
            foes = ctx.bots.map(() => undefined);
            GUN_PAIRS.forEach(([ga, gb, range, lvl], k) => {
                const a = ctx.bots[2 * k];
                const b = ctx.bots[2 * k + 1];
                const y = k * 4.5 - 16;
                teleport(ctx, a.player, add(arena, v(-range / 2, y)));
                teleport(ctx, b.player, add(arena, v(range / 2, y)));
                giveGun(ctx, a.player, G.WeaponSlot.Primary, ga);
                giveGun(ctx, b.player, G.WeaponSlot.Primary, gb);
                armor(a.player, lvl);
                armor(b.player, (lvl + 1) % 4);
                foes[a.index] = b.player;
                foes[b.index] = a.player;
            });
            // the rest shoot obstacles near the arena from several ranges
            destructible = obstacles(ctx, (o) => o.destructible && o.collidable && dist(o.pos, arena) < 90);
            targets = ctx.bots.map(() => undefined);
            for (let i = 16; i < 20; i++) {
                const p = ctx.bots[i].player;
                giveGun(ctx, p, G.WeaponSlot.Primary, i & 1 ? "m870" : "ak47");
                const o = destructible[Math.floor(ctx.rand() * destructible.length)];
                targets[i] = o;
                const a = ctx.rand() * Math.PI * 2;
                teleport(ctx, p, add(o.pos, v(Math.cos(a), Math.sin(a)), [4, 10, 18, 25][i - 16]));
            }
            for (const b of ctx.bots) b.input.inputs.push(G.Input.EquipPrimary);
        },
        tick(ctx) {
            track(ctx, prev);
            const t = ctx.tick;
            for (const b of ctx.bots) {
                refillAmmo(b.player);
                // top up before a single tick can kill, so duels keep going until STOP_HEALING
                if (t < STOP_HEALING) heal(b.player, 90);
            }
            if (t % 3) return;
            for (const b of ctx.bots) {
                const p = b.player;
                if (p.dead) continue;
                if (b.index < 16) {
                    // a duelist whose foe died early takes on the nearest other duelist
                    if (foes[b.index].dead && t < STOP_HEALING) {
                        foes[b.index] = nearest(
                            ctx.bots.slice(0, 16).map((x) => x.player),
                            p.pos,
                            (x) => x !== p && !x.dead,
                        ) ?? foes[b.index];
                    }
                    const foe = foes[b.index];
                    if (!foe.dead) duel(ctx, b, foe, GUN_PAIRS[b.index >> 1][2], 0.05);
                    else if (!seekLoot(ctx, b)) stop(b);
                    continue;
                }
                let o = targets[b.index];
                if (!o || o.dead) {
                    o = targets[b.index] = nearest(destructible, p.pos, (x) => !x.dead);
                }
                if (!o) {
                    b.input.shoot = false;
                    stop(b);
                    continue;
                }
                aimAt(ctx, b, o.pos, 0.05);
                b.input.shoot = true;
                if (dist(o.pos, p.pos) > 30) steerTo(b, o.pos);
                else stop(b);
            }
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 3. melee: adjacent pairs with different weapons, and bots chopping obstacles

const MELEE_PAIRS: [string, string][] = [
    ["fists", "knuckles"],
    ["karambit", "bayonet"],
    ["pan", "machete"],
    ["katana", "hook"],
    ["woodaxe", "fireaxe"],
    ["naginata", "spade"],
];

function meleeBrawl(): Scenario {
    const prev = tracker();
    const STOP_HEALING = 1900;
    let foes: any[] = [];
    let targets: (any | undefined)[] = [];
    let destructible: any[] = [];
    return {
        name: "dir-melee",
        mapName: "test_normal",
        teamMode: 1,
        bots: 16,
        ticks: 2500,
        seed: 103,
        fixedSpawn: true,
        expect: ["melee.swing", "dmg.melee", "obs.dmg.melee", "obs.destroyed", "kill", "loot", "pickup"],
        setup(ctx) {
            const arena = furnish(ctx);
            instrument(ctx);
            const G = ctx.GameConfig;
            foes = ctx.bots.map(() => undefined);
            MELEE_PAIRS.forEach(([ma, mb], k) => {
                const a = ctx.bots[2 * k];
                const b = ctx.bots[2 * k + 1];
                const at = add(arena, v((k % 3) * 9 - 9, Math.floor(k / 3) * 9 - 4));
                teleport(ctx, a.player, add(at, v(-1, 0)));
                teleport(ctx, b.player, add(at, v(1, 0)));
                a.player.weaponManager.setWeapon(G.WeaponSlot.Melee, ma, 0);
                b.player.weaponManager.setWeapon(G.WeaponSlot.Melee, mb, 0);
                armor(a.player, k % 3);
                pockets(b.player);
                foes[a.index] = b.player;
                foes[b.index] = a.player;
            });
            destructible = obstacles(
                ctx,
                (o) => o.destructible && o.collidable && !o.isWall && dist(o.pos, arena) < 120,
            );
            targets = ctx.bots.map(() => undefined);
            for (let i = 12; i < 16; i++) {
                const p = ctx.bots[i].player;
                p.weaponManager.setWeapon(
                    G.WeaponSlot.Melee,
                    ["fireaxe", "fists", "machete", "stonehammer"][i - 12],
                    0,
                );
                const o = destructible[Math.floor(ctx.rand() * destructible.length)];
                targets[i] = o;
                teleport(ctx, p, add(o.pos, v(3, 0)));
            }
            for (const b of ctx.bots) b.input.inputs.push(G.Input.EquipMelee);
        },
        tick(ctx) {
            track(ctx, prev);
            const t = ctx.tick;
            if (t < STOP_HEALING) { for (const b of ctx.bots) heal(b.player, 30); }
            if (t % 3) return;
            for (const b of ctx.bots) {
                const p = b.player;
                if (p.dead) continue;
                if (b.index < 12) {
                    const foe = foes[b.index];
                    if (foe.dead) {
                        if (!seekLoot(ctx, b)) stop(b);
                        continue;
                    }
                    aimAt(ctx, b, foe.pos, 0.15);
                    b.input.shoot = true;
                    const d = dist(p.pos, foe.pos);
                    const a = angleTo(p.pos, foe.pos);
                    // close in, then circle a little so the swings come from varied angles
                    if (d > 2.2) steer(b, Math.cos(a), Math.sin(a));
                    else if ((t + b.index * 50) % 400 < 100) steer(b, -Math.sin(a), Math.cos(a));
                    else stop(b);
                    continue;
                }
                let o = targets[b.index];
                if (!o || o.dead) o = targets[b.index] = nearest(destructible, p.pos, (x) => !x.dead);
                if (!o) {
                    if (!seekLoot(ctx, b)) stop(b);
                    continue;
                }
                aimAt(ctx, b, o.pos);
                b.input.shoot = true;
                steerTo(b, o.pos);
            }
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 4. throwables: frag, mirv, smoke at targets, cooking in hand, bounces off obstacles

function throwables(): Scenario {
    const prev = tracker();
    const STOP_HEALING = 2400;
    // index -> [throwable, cook ticks]
    const kit: Record<number, [string, number]> = {
        4: ["frag", 40],
        5: ["frag", 90],
        6: ["frag", 200],
        7: ["mirv", 40],
        8: ["smoke", 20],
        9: ["frag", 460], // held past the fuse
        10: ["frag", 30],
        11: ["frag", 30],
        12: ["mirv", 30],
        13: ["frag", 30],
        14: ["frag", 60],
        15: ["frag", 60],
    };
    let aims: V[] = [];
    return {
        name: "dir-throwables",
        mapName: "test_normal",
        teamMode: 1,
        bots: 16,
        ticks: 3000,
        seed: 104,
        fixedSpawn: true,
        expect: [
            "proj.frag",
            "proj.mirv",
            "proj.mirv_mini",
            "proj.smoke",
            "smoke",
            "explosions",
            "dmg.explosion",
            "obs.dmg.explosion",
            "obs.dmg.throwable",
            "kill",
            "loot",
            "pickup",
        ],
        setup(ctx) {
            const arena = furnish(ctx);
            instrument(ctx);
            const G = ctx.GameConfig;
            const solid = obstacles(ctx, (o) => o.collidable);
            aims = ctx.bots.map(() => arena);
            // targets stand still near the middle
            for (let i = 0; i < 4; i++) {
                const p = ctx.bots[i].player;
                teleport(ctx, p, add(arena, v(i & 1 ? 6 : -6, i & 2 ? 6 : -6)));
                armor(p, i);
                pockets(p);
            }
            // throwers ring the targets at 14..22 units
            for (let i = 4; i < 10; i++) {
                const a = (i / 6) * Math.PI * 2;
                const target = ctx.bots[i % 4].player.pos;
                teleport(ctx, ctx.bots[i].player, add(target, v(Math.cos(a), Math.sin(a)), 14 + (i % 3) * 4));
                aims[i] = v(target.x, target.y);
            }
            // bouncers stand 5 units off solid obstacles and throw into them; the last two lob at crates
            const walls = solid.filter((o) => o.isWall || o.type.startsWith("stone") || o.isTree);
            const crates = obstacles(
                ctx,
                (o) => o.destructible && (o.type.startsWith("crate") || o.type.startsWith("barrel")),
            );
            for (let i = 10; i < 16; i++) {
                const list = i < 14 ? walls : crates;
                const o = nearest(list, add(arena, v((i - 12) * 40, 30)))!;
                const a = ctx.rand() * Math.PI * 2;
                teleport(ctx, ctx.bots[i].player, add(o.pos, v(Math.cos(a), Math.sin(a)), i < 14 ? 5 : 12));
                aims[i] = v(o.pos.x, o.pos.y);
            }
            for (let i = 4; i < 16; i++) {
                const p = ctx.bots[i].player;
                p.invManager.set(kit[i][0], 6);
                pockets(p);
                ctx.bots[i].input.inputs.push(G.Input.EquipThrowable);
            }
        },
        tick(ctx) {
            track(ctx, prev);
            const t = ctx.tick;
            for (const b of ctx.bots) {
                if (t < STOP_HEALING) heal(b.player, 40);
                const k = kit[b.index];
                if (k && b.player.invManager.get(k[0]) < 3) b.player.invManager.set(k[0], 6);
            }
            if (t % 3) return;
            const G = ctx.GameConfig;
            for (const b of ctx.bots) {
                const p = b.player;
                if (p.dead) continue;
                const k = kit[b.index];
                if (!k || t >= STOP_HEALING + 200) {
                    // targets dodge a bit; after the fight everyone collects loot
                    b.input.shoot = false;
                    if (t < STOP_HEALING + 200 || !seekLoot(ctx, b)) {
                        if ((t + b.index * 40) % 300 < 60) steer(b, Math.cos(b.index), Math.sin(b.index));
                        else stop(b);
                    }
                    continue;
                }
                if (p.curWeapIdx !== G.WeaponSlot.Throwable && t % 60 === 0) {
                    b.input.inputs.push(G.Input.EquipThrowable);
                }
                const period = Math.max(150, k[1] + 60);
                const phase = (t + b.index * 11) % period;
                b.input.shoot = phase < k[1];
                aimAt(ctx, b, aims[b.index], 0.2);
                stop(b);
            }
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 5. gas: stages advance 13x faster once the match starts (~tick 1100); runners chase the safe zone, stayers die outside it

function gasClosing(): Scenario {
    const prev = tracker();
    return {
        name: "dir-gas",
        mapName: "test_normal",
        teamMode: 1,
        bots: 16,
        ticks: 4000,
        seed: 105,
        fixedSpawn: true,
        expect: ["gas.stage", "dmg.gas", "kill.gas", "loot", "pickup"],
        setup(ctx) {
            instrument(ctx);
            const map = ctx.game.map;
            const c = v(map.width / 2, map.height / 2);
            for (const b of ctx.bots) {
                const runner = b.index < 8;
                const a = (b.index / 16) * Math.PI * 2 + ctx.rand() * 0.3;
                const r = runner ? 60 + ctx.rand() * 120 : 270 + ctx.rand() * 60;
                teleport(ctx, b.player, add(c, v(Math.cos(a), Math.sin(a)), r));
                pockets(b.player);
                if (!runner) {
                    b.player.health = 5 + ctx.rand() * 20;
                    armor(b.player, b.index % 4);
                }
            }
        },
        tick(ctx) {
            track(ctx, prev);
            const gas = ctx.game.gas;
            // _gasTicker is the stage timer in both trees; advancing it runs the stages 13x as fast
            if (gas.mode !== 0) gas._gasTicker += 0.12;
            for (const b of ctx.bots) if (!b.player.dead && gas.isInGas(b.player.pos)) ctx.count("inGas.ticks");
            if (ctx.tick % 3) return;
            for (const b of ctx.bots) {
                const p = b.player;
                if (p.dead) continue;
                if (b.index >= 8) {
                    // stayers mostly stand; a few drift toward the zone too late
                    if (b.index >= 13 && (ctx.tick + b.index * 30) % 500 < 100) {
                        steer(b, gas.posNew.x - p.pos.x, gas.posNew.y - p.pos.y);
                    } else stop(b);
                    continue;
                }
                // two runners go scavenging once the stayers are dying
                if (b.index >= 6 && ctx.tick > 2400 && seekLoot(ctx, b, 120)) continue;
                const d = dist(p.pos, gas.posNew);
                if (d > gas.radNew * 0.5) steerTo(b, gas.posNew);
                else if (ctx.rand() < 0.1) steer(b, ctx.rand() - 0.5, ctx.rand() - 0.5);
            }
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 6. squads: two 4v4 fights with ceasefires for revives, ending in team wipes

const SQUAD_GUNS = ["ak47", "mp5", "m870", "deagle"];

function squadFight(): Scenario {
    const prev = tracker();
    let groups: any[][] = [];
    let foesOf: any[][] = [];
    // ceasefire windows give downed players time to be revived
    const firing = (t: number) => t < 450 || (t >= 1350 && t < 1700) || t >= 2600;
    return {
        name: "dir-squad",
        mapName: "test_normal",
        teamMode: 4,
        bots: 16,
        ticks: 3600,
        seed: 106,
        fixedSpawn: true,
        expect: ["down", "revived", "dmg.downed", "teamWipe", "kill", "dmg.gun", "loot", "pickup"],
        setup(ctx) {
            const c = furnish(ctx);
            instrument(ctx);
            const G = ctx.GameConfig;
            const byGroup = new Map<number, any[]>();
            for (const b of ctx.bots) {
                const id = b.player.groupId;
                if (!byGroup.has(id)) byGroup.set(id, []);
                byGroup.get(id)!.push(b);
            }
            groups = [...byGroup.values()];
            if (groups.length !== 4 || groups.some((g) => g.length !== 4)) {
                throw new Error(`parity: dir-squad wants 4 groups of 4, got ${groups.map((g) => g.length)}`);
            }
            const a1 = add(c, v(0, -10));
            const a2 = add(c, v(0, 10));
            foesOf = ctx.bots.map(() => []);
            groups.forEach((g, gi) => {
                const arena = gi < 2 ? a1 : a2;
                const side = gi & 1 ? 1 : -1;
                const enemies = groups[gi ^ 1].map((b: Bot) => b.player);
                g.forEach((b: Bot, mi: number) => {
                    teleport(ctx, b.player, add(arena, v(side * 11, mi * 4 - 6)));
                    giveGun(ctx, b.player, G.WeaponSlot.Primary, SQUAD_GUNS[mi]);
                    armor(b.player, mi % 2);
                    pockets(b.player);
                    b.input.inputs.push(G.Input.EquipPrimary);
                    foesOf[b.index] = enemies;
                });
            });
        },
        tick(ctx) {
            track(ctx, prev);
            const t = ctx.tick;
            for (const b of ctx.bots) refillAmmo(b.player);
            if (t % 3) return;
            const G = ctx.GameConfig;
            for (const g of groups) {
                const mates = g.map((b: Bot) => b.player);
                const downed = mates.filter((p: any) => p.downed && !p.dead);
                for (const b of g as Bot[]) {
                    const p = b.player;
                    if (p.dead) continue;
                    if (p.downed) {
                        b.input.shoot = false;
                        const helper = nearest(mates, p.pos, (m: any) => m !== p && !m.dead && !m.downed);
                        if (helper && dist(helper.pos, p.pos) > 2) steerTo(b, helper.pos);
                        else stop(b);
                        continue;
                    }
                    // the closest healthy teammate revives each downed player, outside firing windows
                    const patient = downed.find((d: any) =>
                        nearest(mates, d.pos, (m: any) => !m.dead && !m.downed) === p
                    );
                    if (patient && !firing(t)) {
                        b.input.shoot = false;
                        const d = dist(patient.pos, p.pos);
                        if (d > 2) steerTo(b, patient.pos);
                        else {
                            stop(b);
                            if (!p.isReviving() && !patient.isBeingRevived()) b.input.inputs.push(G.Input.Interact);
                        }
                        continue;
                    }
                    const foes = foesOf[b.index].filter((f: any) => !f.dead);
                    // early on finish nobody off; at the end take whoever is closest
                    const foe = nearest(foes, p.pos, (f: any) => t >= 2600 || !f.downed) ?? nearest(foes, p.pos);
                    if (!foe) {
                        if (!seekLoot(ctx, b, 60)) stop(b);
                        continue;
                    }
                    if (!firing(t)) {
                        b.input.shoot = false;
                        aimAt(ctx, b, foe.pos);
                        stop(b);
                        continue;
                    }
                    duel(ctx, b, foe, 18, 0.08);
                }
            }
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 7. water and layers: river and ocean swimming, bunker stairs, bridges

function waterLayers(): Scenario {
    const end = finale(1900);
    const prev = tracker();
    let paths: [V, V][] = [];
    return {
        name: "dir-water",
        mapName: "main",
        teamMode: 1,
        bots: 12,
        ticks: 2400,
        seed: 107,
        fixedSpawn: true,
        expect: ["water", "layer.change", "layer.under", "kill", "loot", "pickup"],
        setup(ctx) {
            instrument(ctx);
            end.setup(ctx);
            const map = ctx.game.map;
            const isOnWater = map.isOnWater;
            map.isOnWater = function(this: unknown, ...a: unknown[]) {
                const r = isOnWater.apply(this, a);
                if (r) ctx.count("water");
                return r;
            };
            const rivers = map.terrain.rivers;
            const structs = ctx.game.objectRegister.objects.filter((o: any) => o?.__type === STRUCTURE);
            const bunkers = structs.filter((s: any) => s.type.startsWith("bunker") && s.stairs.length);
            const bridges = structs.filter((s: any) => s.type.includes("bridge") && s.stairs.length);
            if (!rivers.length || !bunkers.length || !bridges.length) {
                throw new Error(
                    `parity: dir-water map lacks rivers/bunkers/bridges (${rivers.length}/${bunkers.length}/${bridges.length})`,
                );
            }
            paths = [];
            // a path: start, end
            for (let i = 0; i < 4; i++) {
                const r = rivers[i % rivers.length];
                const s = 0.25 + 0.15 * i;
                const c = r.spline.getPos(s);
                const n = r.spline.getNormal(s);
                const w = r.waterWidth + 6;
                paths.push([add(c, n, w), add(c, n, -w)]);
            }
            for (let i = 0; i < 2; i++) {
                const shore = map.terrain.shore;
                const sp = shore[Math.floor((i + 0.3) * shore.length / 2)];
                const out = v(sp.x - map.width / 2, sp.y - map.height / 2);
                const l = Math.hypot(out.x, out.y);
                paths.push([add(sp, out, -8 / l), add(sp, out, 25 / l)]);
            }
            for (let i = 0; i < 3; i++) {
                const st = bunkers[i % bunkers.length].stairs[0];
                const c = v(
                    (st.collision.min.x + st.collision.max.x) / 2,
                    (st.collision.min.y + st.collision.max.y) / 2,
                );
                paths.push([add(c, st.downDir, -8), add(c, st.downDir, 14)]);
            }
            for (let i = 0; i < 3; i++) {
                const br = bridges[i % bridges.length];
                const dir = br.stairs[0].downDir;
                paths.push([add(br.pos, dir, -26), add(br.pos, dir, 26)]);
            }
            for (const b of ctx.bots) {
                teleport(ctx, b.player, paths[b.index][0]);
                giveGun(ctx, b.player, ctx.GameConfig.WeaponSlot.Primary, "m9");
                b.input.inputs.push(ctx.GameConfig.Input.EquipPrimary);
            }
        },
        tick(ctx) {
            track(ctx, prev);
            if (end.tick(ctx)) return;
            if (ctx.tick % 3) return;
            for (const b of ctx.bots) {
                const p = b.player;
                const [from, to] = paths[b.index];
                // there and back, 450 ticks each way, shooting along the way now and then
                const goal = Math.floor((ctx.tick + b.index * 17) / 450) % 2 ? from : to;
                steerTo(b, goal);
                aimAt(ctx, b, goal, 0.4);
                b.input.shoot = (ctx.tick + b.index * 7) % 90 < 10;
                if (dist(p.pos, goal) < 1) stop(b);
            }
        },
    };
}

/** Scripted scenarios aimed at one subsystem each. */
export const directedScenarios: Scenario[] = [
    collideObstacles(),
    bulletDuels(),
    meleeBrawl(),
    throwables(),
    gasClosing(),
    squadFight(),
    waterLayers(),
];

// Visibility bookkeeping stress: ids reused right away, clients that skip syncs while they have no
// player, and a client watching a destroyed (later unregistered) player.
function idReuse(base: Scenario, keep: number): Scenario {
    return {
        ...base,
        name: `${base.name}-idreuse`,
        expect: [...(base.expect ?? []), "stale.sync", "id.reused", "removed.yes", "dead.active"],
        setup(ctx) {
            base.setup?.(ctx);
            const game = ctx.game;
            const reg = game.objectRegister;
            let fresh = reg.idNext;
            reg.idNext = 65535;
            for (const k of Object.keys(reg.freeLists).filter((t) => t === "9" || t === "7")) {
                reg.freeLists[k].length = Math.min(reg.freeLists[k].length, keep);
            }
            for (let t = 1; t < 16; t++) {
                if (reg.freeLists[t]) continue;
                reg.freeLists[t] = [];
                for (let i = 0; i < 1000; i++) reg.freeLists[t].push(fresh++);
            }
            const seen = new Set<number>();
            const origRegister = reg.register.bind(reg);
            reg.register = (obj: any) => {
                origRegister(obj);
                if (seen.has(obj.__id)) ctx.count("id.reused");
                seen.add(obj.__id);
            };
            const orig = game.netSync.bind(game);
            let removed: any;
            game.netSync = () => {
                // a few clients go without a player for a while, so their visibility goes stale
                const hidden: any[] = [];
                if (ctx.tick > 30 && !removed) {
                    const c = game.clientBarn.clients[13];
                    removed = c.player;
                    c.socket.close();
                    game.clientBarn.handleSocketClose(c.socket);
                    ctx.count("removed." + (removed.destroyed ? "yes" : "no"));
                }
                // client 12 watches the removed (destroyed, later unregistered) player for a while
                if (removed && ctx.tick < 600) {
                    const c = game.clientBarn.clients[12];
                    hidden.push([c, c.player, c.spectating]);
                    c.player = undefined;
                    c._spectating = removed;
                    if (removed.__id === 0) ctx.count("dead.active");
                    if (ctx.tick % 50 === 0) removed.setDirty();
                }
                const phase = ctx.tick % 400;
                if (phase >= 100 && phase < 250) {
                    for (const idx of [4, 5, 11]) {
                        const c = game.clientBarn.clients[idx];
                        if (!c) continue;
                        hidden.push([c, c.player, c.spectating]);
                        c.player = undefined;
                        c._spectating = undefined;
                        ctx.count("stale.sync");
                    }
                }
                orig();
                for (const [c, p, s] of hidden) {
                    c.player = p;
                    c._spectating = s;
                }
            };
        },
    };
}
directedScenarios.push(idReuse(throwables(), 100), idReuse(bulletDuels(), 60), idReuse(squadFight(), 100));
