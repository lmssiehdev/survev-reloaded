import { meleeReachHit } from "@survev/shared/utils/meleeReach.ts";
import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";
import { bronzeChain, ChainView, Rope } from "./chain.ts";

/*
 * Rope dart: a barbed head on a chain, thrown from the right hand. Ported from the
 * anim lab. The server only knows a melee swing with a long thin reach; everything
 * here is the look of it, run on each client from the swing's own clock:
 *   release  the head leaves the hand, it lands on the def's damage time
 *   yank     the hand pulls, the chain snaps taut and a wave runs down it
 *   rip      the wave arrives, the head tears free and flies home
 *   catch    the head is back at the hand
 * It bites the same player the server's hit picks, or flies to the end of the
 * chain and snaps to a stop there.
 */

/** Seconds into the swing, the body move in melee.ts keys off the same times */
export const ropeDartTimes = {
    release: 0.26,
    yank: 0.55,
    rip: 0.61,
    catch: 0.72,
};

type DartState = "hold" | "throw" | "stuck" | "yank" | "dangle" | "return" | "settle";

/** The player holding the dart */
export interface DartHolder {
    bodyContainer: PIXI.Container;
    handRContainer: PIXI.Container;
    m_visualPos: Vec2;
    m_dir: Vec2;
}

/** Anyone the head can bite */
export interface DartTarget {
    m_visualPos: Vec2;
    m_rad: number;
}

/** The swing playing this frame */
export interface DartSwing {
    /** Seconds since the swing started */
    t: number;
    /** When the server's hit lands */
    hitTime: number;
}

interface RopeDartOpts {
    /** Chain fully paid out, world units, the def's reach */
    maxLength: number;
    /** Chain hanging from the hand at rest */
    idleLength: number;
    /** Head length, ring to tip, world units */
    dartLength: number;
    /** How deep the tip sinks in */
    depth: number;
}

/** Dart art length in its own pixels, ring center to tip */
const DART_ART = 86;

export class RopeDart {
    /** World units, y up, placed on the camera each frame. Goes under the players so a fist closes over the chain */
    under = new PIXI.Container();
    /** Same space, over the players, for the head while it is not buried in someone */
    over = new PIXI.Container();
    /** Chain and a buried head */
    private container = new PIXI.Container();
    /** The head while it is not buried in someone */
    private head = new PIXI.Container();
    private rope: Rope;
    private chain: ChainView;
    private dart: PIXI.Sprite;
    private state: DartState = "hold";
    private opts: RopeDartOpts;

    private holder: DartHolder | null = null;
    private time = 0;
    private stateT = 0;
    private angle = 0;
    private angVel = 0;
    private flight:
        | { from: Vec2; to: Vec2; m0: Vec2; m1: Vec2; dur: number; target: DartTarget | null; dir: Vec2 }
        | null = null;
    private stuck: { target: DartTarget; offset: Vec2 } | null = null;
    private homing: { from: Vec2; dur: number; side: number } | null = null;
    private yankTravel = 0.06;
    private homeDur = 0.1;
    /** Swing time seen last frame, cues fire as the clock passes them. -1 is no swing */
    private lastT = -1;

    constructor(renderer: PIXI.IRenderer, maxLength: number) {
        this.opts = { maxLength, idleLength: 1.5, dartLength: 1.75, depth: 0.45 };
        this.rope = new Rope(v2.create(0, 0), this.opts.idleLength, {
            segment: 0.18,
            iterations: 10,
            drag: 2.2,
            bend: 0.55,
            endInvMass: 0.3,
        });
        this.chain = new ChainView(renderer, bronzeChain);
        this.dart = new PIXI.Sprite(bakeDart(renderer));
        const tex = this.dart.texture;
        // The ring's center is the pivot, the chain hangs from it
        this.dart.anchor.set(DART_PAD_BACK / tex.width, 0.5);
        this.dart.scale.set(this.opts.dartLength / DART_ART);
        this.container.addChild(this.chain.container);
        this.head.addChild(this.dart);
        this.under.addChild(this.container);
        this.over.addChild(this.head);
    }

    /**
     * Once a frame from render, after the holder's container is placed. `dt` is animation
     * time so a hit stop holds the chain too. `swing` is null while no throw is playing
     */
    update(dt: number, camera: Camera, holder: DartHolder, targets: DartTarget[], swing: DartSwing | null) {
        const origin = camera.m_pointToScreen(v2.create(0, 0));
        const z = camera.m_z();
        for (const layer of [this.under, this.over]) {
            layer.visible = true;
            layer.position.set(origin.x, origin.y);
            layer.scale.set(z, z);
        }
        if (this.holder != holder) {
            this.holder = holder;
            this.reset();
        }
        this.step(dt, holder, targets, swing);
    }

    hide() {
        this.under.visible = this.over.visible = false;
        this.reset();
    }

    destroy() {
        this.under.destroy({ children: true });
        this.over.destroy({ children: true });
    }

    /** Back to hanging from the hand, nothing in flight */
    private reset() {
        this.state = "hold";
        this.flight = null;
        this.stuck = null;
        this.homing = null;
        this.lastT = -1;
        // Laid out on the next update, once the hand has been posed
        this.relay = true;
    }
    private relay = true;

    /** Fires the throw's steps as the swing's clock passes them */
    private cues(holder: DartHolder, targets: DartTarget[], swing: DartSwing | null) {
        if (!swing) {
            // Swing cut short, by a weapon switch or a new anim: the head comes home
            if (this.lastT >= 0) this.rip(0.12);
            this.lastT = -1;
            return;
        }
        // A new swing restarts the clock
        if (swing.t < this.lastT) this.lastT = -1;
        const passed = (t: number) => this.lastT < t && swing.t >= t;
        const times = ropeDartTimes;
        if (passed(times.release)) this.release(holder, targets, swing.hitTime - times.release);
        if (passed(times.yank)) this.yank(times.rip - times.yank);
        if (passed(times.rip)) this.rip(times.catch - times.rip);
        this.lastT = swing.t;
    }

    private lay() {
        this.relay = false;
        const { hand, hang } = this.frame();
        this.rope.setLength(this.opts.idleLength);
        this.rope.length = this.opts.idleLength;
        this.rope.attach(null);
        this.rope.lay(hand, hang);
        this.angle = Math.atan2(hang.y, hang.x);
        this.angVel = 0;
    }

    /** Where the hand is and which ways the body faces, world units */
    private frame() {
        const holder = this.holder!;
        const body = holder.bodyContainer;
        const hand = toWorld(this.under, holder.handRContainer);
        const origin = toWorld(this.under, body);
        // The chain and the hanging head never pass through the holder
        this.rope.colliders = [{ center: origin, radius: BODY_CLEARANCE }];
        const fwd = v2.normalizeSafe(v2.sub(toWorld(this.under, body, 16, 0), origin), v2.create(1, 0));
        const right = v2.normalizeSafe(v2.sub(toWorld(this.under, body, 0, 16), origin), v2.create(0, -1));
        // At rest the head hangs ahead and out to the right of the hand
        const hang = v2.normalize(v2.add(v2.mul(fwd, 0.8), v2.mul(right, 0.6)));
        return { hand, fwd, right, hang };
    }

    private get pos() {
        return this.state == "stuck" || this.state == "yank" || this.state == "throw" || this.state == "return"
            ? this.headPos
            : this.rope.end;
    }
    private headPos = v2.create(0, 0);

    private release(holder: DartHolder, targets: DartTarget[], flightTime: number) {
        const { hand, fwd, right } = this.frame();
        const from = this.rope.end;
        const { depth, dartLength, maxLength } = this.opts;
        // The same pick as the server's hit: the first player along the aim
        let target: DartTarget | null = null;
        let best = -Infinity;
        for (const t of targets) {
            const hit = meleeReachHit(holder.m_visualPos, holder.m_dir, maxLength, t.m_visualPos, t.m_rad);
            if (!hit || hit.pen <= best) continue;
            best = hit.pen;
            target = t;
        }
        let to: Vec2;
        let dir: Vec2;
        if (target) {
            dir = v2.normalize(v2.sub(target.m_visualPos, from));
            const tipEnd = v2.add(target.m_visualPos, v2.mul(dir, depth - target.m_rad));
            to = v2.sub(tipEnd, v2.mul(dir, dartLength));
        } else {
            dir = fwd;
            to = v2.add(hand, v2.mul(fwd, maxLength * 0.85));
        }
        // Lands on the server's damage time, whatever the distance
        const dur = Math.max(flightTime, 0.06);
        const speed = v2.length(v2.sub(to, from)) / dur;
        // Leaves the hand swinging across the body, then curves onto the line, so the chain trails in an arc
        const m0 = v2.add(v2.mul(dir, speed * 1.15), v2.mul(right, -speed * 0.45));
        const m1 = v2.mul(dir, speed * 0.75);
        this.flight = { from, to, m0, m1, dur, target, dir };
        this.headPos = v2.copy(from);
        this.setState("throw");
    }

    private yank(travel: number) {
        this.yankTravel = Math.max(travel, 0.02);
        if (this.state == "stuck") {
            this.setState("yank");
            this.rope.setLength(this.rope.span * 0.96, 60);
            this.rope.pluck(0.55, this.yankTravel, 1);
        } else if (this.state == "dangle") {
            this.rope.setLength(this.rope.span * 0.96, 60);
            this.rope.pluck(0.55, this.yankTravel, 1);
        }
    }

    private rip(homeDur: number) {
        if (this.state != "yank" && this.state != "dangle" && this.state != "stuck" && this.state != "throw") return;
        this.homeDur = Math.max(homeDur, 0.04);
        const from = this.pos;
        this.stuck = null;
        this.homing = { from, dur: this.homeDur, side: 1 };
        this.headPos = v2.copy(from);
        this.setState("return");
    }

    private setState(state: DartState) {
        this.state = state;
        this.stateT = 0;
    }

    /** Moves the head and chain along with the swing, call once the holder is posed for the frame */
    private step(dt: number, holder: DartHolder, targets: DartTarget[], swing: DartSwing | null) {
        if (this.relay) this.lay();
        const { hand, fwd, right, hang } = this.frame();
        this.cues(holder, targets, swing);
        this.time += dt;
        this.stateT += dt;
        const rope = this.rope;
        rope.pin(hand);
        let want = this.angle;
        let turn = 140;

        switch (this.state) {
            case "hold":
            case "settle":
            case "dangle": {
                rope.attach(null);
                if (this.state != "dangle") {
                    rope.setLength(this.opts.idleLength, this.state == "settle" ? 7 : 3);
                    // Weight hangs it ahead of the hand, a slow sway keeps it alive
                    const sway = Math.sin(this.time * 1.7) * 7 + Math.sin(this.time * 3.1) * 3;
                    rope.endPull = v2.add(v2.mul(hang, this.state == "settle" ? 55 : 34), v2.mul(right, sway));
                    rope.drag = this.state == "settle" ? 3 + Math.max(1 - this.stateT / 0.4, 0) * 3 : 2.6;
                    if (this.state == "settle" && this.stateT > 0.8) this.state = "hold";
                } else {
                    rope.endPull = v2.create(0, 0);
                    rope.drag = 3;
                }
                rope.step(dt);
                const dir = rope.endDir;
                want = Math.atan2(dir.y, dir.x);
                turn = 260;
                break;
            }
            case "throw": {
                const f = this.flight!;
                const u = Math.min(this.stateT / f.dur, 1);
                const at = hermite(f.from, f.m0, f.to, f.m1, f.dur, u);
                const vel = hermiteVel(f.from, f.m0, f.to, f.m1, f.dur, u);
                // Moves with the target if it was knocked while the head was in the air
                this.headPos = at;
                rope.attach(at);
                // Pays out just ahead of the head, a little slack so it trails in a curve
                const span = v2.length(v2.sub(at, hand));
                rope.setLength(Math.min(Math.max(rope.length, span * 1.06 + 0.15), this.opts.maxLength));
                rope.endPull = v2.create(0, 0);
                rope.drag = 1.2;
                rope.step(dt);
                want = Math.atan2(vel.y, vel.x);
                turn = 4000;
                if (u >= 1) {
                    if (f.target) {
                        this.stuck = { target: f.target, offset: v2.sub(at, f.target.m_visualPos) };
                        this.angle = Math.atan2(f.dir.y, f.dir.x);
                        this.angVel = 0;
                        this.setState("stuck");
                        rope.setLength(rope.span * 1.04, 3);
                    } else {
                        // Nothing to bite: the chain runs out and snaps the head to a stop
                        rope.attach(null);
                        rope.setLength(this.opts.maxLength);
                        rope.setEndVel(v2.mul(vel, 0.9));
                        this.setState("dangle");
                    }
                }
                break;
            }
            case "stuck":
            case "yank": {
                const s = this.stuck!;
                let at = v2.add(s.target.m_visualPos, s.offset);
                if (this.state == "yank") {
                    // Tugs against the barbs, a buzz along the pull
                    const pull = v2.normalizeSafe(v2.sub(hand, at), v2.create(-1, 0));
                    at = v2.add(at, v2.mul(pull, 0.06 + Math.sin(this.stateT * 90) * 0.04));
                }
                this.headPos = at;
                rope.attach(at);
                rope.drag = this.state == "yank" ? 6 : 3.5;
                rope.step(dt);
                want = this.angle;
                break;
            }
            case "return": {
                const h = this.homing!;
                const u = Math.min(this.stateT / h.dur, 1);
                // Pulled ring first: it accelerates all the way in and arrives just outside the fist
                const home = v2.add(hand, v2.add(v2.mul(right, 0.3), v2.mul(fwd, 0.35)));
                const e = Math.pow(u, 1.6);
                const line = v2.sub(home, h.from);
                const side = v2.create(-line.y, line.x);
                const at = v2.add(v2.add(h.from, v2.mul(line, e)), v2.mul(side, Math.sin(u * Math.PI) * 0.05 * h.side));
                const before = this.headPos;
                this.headPos = at;
                rope.attach(at);
                // Reeled in a little slower than the head comes back, slack gathers near the hand
                const span = v2.length(v2.sub(at, hand));
                rope.setLength(Math.max(span + 0.15 + u * 0.9, this.opts.idleLength * 0.6));
                rope.drag = 1.5;
                rope.step(dt);
                const away = v2.sub(at, hand);
                want = Math.atan2(away.y, away.x);
                turn = 900;
                if (u >= 1) {
                    const vel = dt > 0 ? v2.mul(v2.sub(at, before), 1 / dt) : v2.mul(line, 1.6 / h.dur);
                    // The hand closes on the chain: the head keeps some of its speed and whips round the fist
                    rope.attach(null);
                    rope.setEndVel(v2.add(v2.mul(hang, v2.length(vel) * 0.1), v2.mul(vel, 0.04)));
                    rope.setLength(this.opts.idleLength, 5);
                    this.setState("settle");
                }
                break;
            }
        }

        // The head turns like something with weight, quick in flight, swinging when it hangs
        if (dt > 0) {
            const diff = wrap(want - this.angle);
            const damping = 2 * Math.sqrt(turn) * 0.75;
            this.angVel += (diff * turn - this.angVel * damping) * dt;
            this.angle += this.angVel * dt;
            if (turn >= 4000) {
                this.angle = want;
                this.angVel = 0;
            }
        }

        this.draw();
    }

    private draw() {
        const pos = this.pos;
        this.dart.position.set(pos.x, -pos.y);
        this.dart.rotation = -this.angle;
        // Buried in a target the body hides the tip, otherwise the head is always on top
        const buried = this.state == "stuck" || this.state == "yank";
        const layer = buried ? this.container : this.head;
        if (this.dart.parent != layer) layer.addChild(this.dart);
        const points = this.rope.shape();
        // The chain's last link hooks the ring, wherever the head is drawn
        points[points.length - 1] = pos;
        this.chain.draw(points, 0.12, 0.06);
    }
}

/** A point on a display object in the dart's world space, world units with y up */
function toWorld(world: PIXI.Container, obj: PIXI.DisplayObject, x = 0, y = 0): Vec2 {
    const at = world.toLocal(obj.toGlobal(new PIXI.Point(x, y)));
    return v2.create(at.x, -at.y);
}

/** World units from the holder's center the chain stays out of, a body is radius 1 */
const BODY_CLEARANCE = 1.08;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Cubic Hermite from a to b over dur seconds, ma and mb are velocities in units a second */
function hermite(a: Vec2, ma: Vec2, b: Vec2, mb: Vec2, dur: number, u: number): Vec2 {
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return v2.create(
        h00 * a.x + h10 * dur * ma.x + h01 * b.x + h11 * dur * mb.x,
        h00 * a.y + h10 * dur * ma.y + h01 * b.y + h11 * dur * mb.y,
    );
}

function hermiteVel(a: Vec2, ma: Vec2, b: Vec2, mb: Vec2, dur: number, u: number): Vec2 {
    const u2 = u * u;
    const d00 = 6 * u2 - 6 * u;
    const d10 = 3 * u2 - 4 * u + 1;
    const d01 = -6 * u2 + 6 * u;
    const d11 = 3 * u2 - 2 * u;
    return v2.create(
        (d00 * a.x + d01 * b.x) / dur + d10 * ma.x + d11 * mb.x,
        (d00 * a.y + d01 * b.y) / dur + d10 * ma.y + d11 * mb.y,
    );
}

/* -------------------------------------------------------------------------- */

const DART_PAD_BACK = 12;
const BRONZE = 0xb07a3a;
const BRONZE_LIGHT = 0xe8b46a;
const BRONZE_DARK = 0x7a5024;
const STEEL = 0x3a3e45;
const STEEL_LIGHT = 0x6f7884;
const INK = 0x1c1208;

/**
 * The head, drawn pointing along +x with the ring's center at 0,0, in art pixels,
 * scaled so DART_ART pixels is the head length. Baked once at 2x.
 */
function bakeDart(renderer: PIXI.IRenderer) {
    const g = new PIXI.Graphics();
    const line = 3.2;
    // Barbed blade: teeth lean back toward the handle so it holds once it's in
    const top = [44, -4.5, 47, -12.5, 54, -8, 56.5, -13, 63, -7.5, 65.5, -10.5, 71, -5.5, 86, 0];
    const blade: number[] = [...top];
    for (let i = top.length - 4; i >= 0; i -= 2) blade.push(top[i], -top[i + 1]);
    g.lineStyle(line, INK, 1, 0.5).beginFill(STEEL).drawPolygon(blade).endFill();
    // Bevel down the middle catches the light
    g.lineStyle(0).beginFill(STEEL_LIGHT).drawPolygon([47, 0, 62, -2.8, 82, 0, 62, 2.8]).endFill();
    g.lineStyle(0).beginFill(0x9aa4b0).drawPolygon([52, -0.6, 62, -1.6, 76, -0.4]).endFill();

    // Handle: thin shaft flaring into a collar at the blade
    g.lineStyle(line, INK, 1, 0.5).beginFill(BRONZE);
    g.drawPolygon([14, -3.6, 34, -4.4, 39, -7.6, 46, -7.6, 46, 7.6, 39, 7.6, 34, 4.4, 14, 3.6]);
    g.endFill();
    g.lineStyle(0).beginFill(BRONZE_LIGHT).drawPolygon([16, -2.2, 33, -2.8, 33, -1.2, 16, -0.8]).endFill();
    g.lineStyle(0).beginFill(BRONZE_LIGHT).drawRect(39.5, -5.6, 5, 2).endFill();
    // Wrapped grip bands
    g.lineStyle(1.6, BRONZE_DARK, 1);
    for (const x of [20, 24.5, 29]) g.moveTo(x, -3.6).lineTo(x, 3.6);

    // Swivel joint and the ring the chain hangs from
    g.lineStyle(line, INK, 1, 0.5).beginFill(BRONZE).drawRoundedRect(4, -3, 12, 6, 3).endFill();
    g.lineStyle(line, INK, 1, 0.5).beginFill(BRONZE).drawCircle(12.5, 0, 4.4).endFill();
    g.lineStyle(0).beginFill(BRONZE_LIGHT).drawCircle(11.5, -1.4, 1.5).endFill();
    g.lineStyle(line + 4.6, INK, 1, 0.5).drawCircle(0, 0, 5.2);
    g.lineStyle(4.6, BRONZE, 1, 0.5).drawCircle(0, 0, 5.2);
    g.lineStyle(1.4, BRONZE_LIGHT, 1, 0.5).arc(0, 0, 5.2, Math.PI * 1.1, Math.PI * 1.6);

    const region = new PIXI.Rectangle(-DART_PAD_BACK, -18, DART_ART + DART_PAD_BACK + 6, 36);
    const texture = renderer.generateTexture(g, { region, resolution: 2 });
    g.destroy();
    return texture;
}
