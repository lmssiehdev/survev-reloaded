import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";

/*
 * Rope and chain: a position based simulation of a string of points with a pinned
 * start (a hand), an end that is either held by code (a thrown head) or hangs free
 * with its own weight, and a length that reels in and out through the start.
 * Everything is in world units with y up. Reusable for flails, grapples and whips.
 *
 * The sim takes substeps no longer than `substep`, so it behaves the same at any
 * frame rate, does nothing at all while dt is 0 (hit stop) and can't blow up on a
 * long frame. Links only resist being pulled apart, never pushed together, which is
 * what lets slack pile up and coil like a real chain.
 */

export interface RopeOpts {
    /** Rest length of one simulated segment, world units */
    segment?: number;
    /** Constraint passes per substep, more is a stiffer, less stretchy chain */
    iterations?: number;
    /** Longest substep, seconds */
    substep?: number;
    /** Velocity lost per second, the air a chain drags through */
    drag?: number;
    /** 0 lets a link fold flat on the next, 1 keeps every pair of segments straight */
    bend?: number;
    /** Inverse mass of a free end next to a link's 1: smaller is a heavier head */
    endInvMass?: number;
    /** Speed cap for any point, world units a second */
    maxSpeed?: number;
}

interface RopePoint {
    x: number;
    y: number;
    vx: number;
    vy: number;
    px: number;
    py: number;
}

interface Wave {
    age: number;
    /** Seconds for the crest to travel from the start to the end */
    travel: number;
    amp: number;
    side: number;
}

export class Rope {
    readonly segment: number;
    iterations: number;
    substep: number;
    drag: number;
    bend: number;
    endInvMass: number;
    maxSpeed: number;
    /** A constant pull on every free point, world units a second squared. Top down there is no gravity, so this is a style choice */
    gravity = v2.create(0, 0);
    /** Extra pull on the free end only, for a weighted head that hangs one way */
    endPull = v2.create(0, 0);
    /** Circles the free points are kept out of, like the holder's body. Set every frame */
    colliders: Array<{ center: Vec2; radius: number }> = [];

    pts: RopePoint[] = [];
    /** Total rest length, start to end */
    length: number;
    private lengthWant: number;
    private reelRate = Infinity;
    private pinFrom: Vec2;
    private pinTo: Vec2;
    private endFrom: Vec2 | null = null;
    private endTo: Vec2 | null = null;
    private waves: Wave[] = [];

    constructor(start: Vec2, length: number, opts: RopeOpts = {}) {
        this.segment = opts.segment ?? 0.2;
        this.iterations = opts.iterations ?? 8;
        this.substep = opts.substep ?? 1 / 240;
        this.drag = opts.drag ?? 2;
        this.bend = opts.bend ?? 0.5;
        this.endInvMass = opts.endInvMass ?? 0.35;
        this.maxSpeed = opts.maxSpeed ?? 90;
        this.length = this.lengthWant = Math.max(length, 0.01);
        this.pinFrom = v2.copy(start);
        this.pinTo = v2.copy(start);
        this.lay(start, v2.create(1, 0));
    }

    /** Lays the rope out straight from start in a direction, at rest */
    lay(start: Vec2, dir: Vec2) {
        const d = v2.normalizeSafe(dir, v2.create(1, 0));
        const n = Math.max(Math.ceil(this.length / this.segment - 1e-6), 1);
        this.pts = [];
        for (let i = 0; i <= n; i++) {
            // The first segment is the short one, it's the one being fed through the hand
            const s = i == 0 ? 0 : this.length - (n - i) * this.segment;
            this.pts.push({ x: start.x + d.x * s, y: start.y + d.y * s, vx: 0, vy: 0, px: 0, py: 0 });
        }
        this.pinFrom = v2.copy(start);
        this.pinTo = v2.copy(start);
        this.waves = [];
    }

    /** Where the start is held this frame. The sim moves it there smoothly across its substeps */
    pin(at: Vec2) {
        this.pinTo = v2.copy(at);
    }

    /** Holds the end at a point this frame, or lets it hang free with null */
    attach(at: Vec2 | null) {
        if (!at) {
            this.endFrom = this.endTo = null;
            return;
        }
        if (!this.endTo) this.endFrom = v2.copy(this.end);
        this.endTo = v2.copy(at);
    }

    get attached() {
        return this.endTo != null;
    }

    /** Reels toward a length, at a rate in world units a second (Infinity jumps) */
    setLength(length: number, rate = Infinity) {
        this.lengthWant = Math.max(length, 0.01);
        this.reelRate = rate;
    }

    get start(): Vec2 {
        return v2.create(this.pts[0].x, this.pts[0].y);
    }

    get end(): Vec2 {
        const p = this.pts[this.pts.length - 1];
        return v2.create(p.x, p.y);
    }

    get endVel(): Vec2 {
        const p = this.pts[this.pts.length - 1];
        return v2.create(p.vx, p.vy);
    }

    /** Direction the last link points, from the chain into the head */
    get endDir(): Vec2 {
        const a = this.pts[Math.max(this.pts.length - 3, 0)];
        const b = this.pts[this.pts.length - 1];
        return v2.normalizeSafe(v2.create(b.x - a.x, b.y - a.y), v2.create(1, 0));
    }

    /** Straight line distance from start to end */
    get span() {
        return v2.length(v2.sub(this.end, this.start));
    }

    /** Pushes the free end, an instant change of velocity */
    kickEnd(vel: Vec2) {
        const p = this.pts[this.pts.length - 1];
        p.vx += vel.x;
        p.vy += vel.y;
    }

    /** Sets the free end's velocity, for handing a flying head over to the sim */
    setEndVel(vel: Vec2) {
        const p = this.pts[this.pts.length - 1];
        p.vx = vel.x;
        p.vy = vel.y;
    }

    /** Adds velocity to every point, scaled by how far along the rope it is from `from` to `to` (0 start, 1 end) */
    impulse(vel: Vec2, from = 0, to = 1) {
        const n = this.pts.length - 1;
        for (let i = 1; i <= n; i++) {
            const f = i / n;
            if (f < from || f > to) continue;
            const w = to > from ? (f - from) / (to - from) : 1;
            this.pts[i].vx += vel.x * w;
            this.pts[i].vy += vel.y * w;
        }
    }

    /**
     * A crest that runs from the start to the end in `travel` seconds, the look of a
     * jerk travelling down a taut chain. Drawn on top of the sim, so it can't fight it.
     */
    pluck(amp: number, travel: number, side = 1) {
        this.waves.push({ age: 0, travel: Math.max(travel, 0.01), amp, side });
    }

    step(dt: number) {
        if (dt <= 0) return;
        for (const wave of this.waves) wave.age += dt;
        this.waves = this.waves.filter((wave) => wave.age < wave.travel * 1.6);

        const steps = Math.min(Math.ceil(dt / this.substep - 1e-6), 64);
        const h = dt / steps;
        for (let k = 1; k <= steps; k++) {
            const f = k / steps;
            this.reel(h);
            this.sub(
                h,
                v2.lerp(f, this.pinFrom, this.pinTo),
                this.endTo && this.endFrom ? v2.lerp(f, this.endFrom, this.endTo) : null,
            );
        }
        this.pinFrom = v2.copy(this.pinTo);
        if (this.endTo) this.endFrom = v2.copy(this.endTo);
    }

    /** Length moves toward what was asked, links are fed in or out at the start */
    private reel(h: number) {
        const delta = this.lengthWant - this.length;
        const most = this.reelRate * h;
        this.length += Math.abs(delta) <= most ? delta : Math.sign(delta) * most;
        const seg = this.segment;
        for (;;) {
            const n = this.pts.length - 1;
            const first = this.length - (n - 1) * seg;
            if (first > seg * 1.0001) {
                // A new link comes out of the hand, between it and the one already out
                const pin = this.pts[0];
                const next = this.pts[1];
                const dx = pin.x - next.x;
                const dy = pin.y - next.y;
                const d = Math.hypot(dx, dy);
                const s = d > seg ? seg / d : 1;
                this.pts.splice(1, 0, {
                    x: next.x + dx * s,
                    y: next.y + dy * s,
                    vx: (pin.vx + next.vx) * 0.5,
                    vy: (pin.vy + next.vy) * 0.5,
                    px: 0,
                    py: 0,
                });
            } else if (first < seg * 0.0001 && n > 1) {
                // Reeled in: the link next to the hand goes into it
                this.pts.splice(1, 1);
            } else break;
        }
    }

    private restOf(i: number) {
        // Segment i joins point i and i + 1. Segment 0 is the partial one at the hand
        const n = this.pts.length - 1;
        return i == 0 ? Math.max(this.length - (n - 1) * this.segment, 0.001) : this.segment;
    }

    private sub(h: number, pin: Vec2, end: Vec2 | null) {
        const pts = this.pts;
        const last = pts.length - 1;
        const damp = Math.exp(-this.drag * h);
        const p0 = pts[0];
        p0.vx = (pin.x - p0.x) / h;
        p0.vy = (pin.y - p0.y) / h;
        for (let i = 0; i <= last; i++) {
            const p = pts[i];
            p.px = p.x;
            p.py = p.y;
            if (i == 0 || (i == last && end)) continue;
            p.vx = (p.vx + this.gravity.x * h) * damp;
            p.vy = (p.vy + this.gravity.y * h) * damp;
            if (i == last) {
                p.vx += this.endPull.x * h;
                p.vy += this.endPull.y * h;
            }
            p.x += p.vx * h;
            p.y += p.vy * h;
        }
        p0.x = pin.x;
        p0.y = pin.y;
        const tail = pts[last];
        if (end) {
            tail.x = end.x;
            tail.y = end.y;
        }
        const endW = end ? 0 : this.endInvMass;
        const w = (i: number) => (i == 0 ? 0 : i == last ? endW : 1);

        for (let it = 0; it < this.iterations; it++) {
            // Alternating direction spreads corrections evenly instead of piling them on one end
            const forward = it % 2 == 0;
            for (let j = 0; j < last; j++) {
                const i = forward ? j : last - 1 - j;
                const a = pts[i];
                const b = pts[i + 1];
                const wa = w(i);
                const wb = w(i + 1);
                if (wa + wb == 0) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.hypot(dx, dy);
                const rest = this.restOf(i);
                if (d <= rest || d < 1e-9) continue;
                const c = (d - rest) / d / (wa + wb);
                a.x += dx * c * wa;
                a.y += dy * c * wa;
                b.x -= dx * c * wb;
                b.y -= dy * c * wb;
            }
            // Keeps a link from folding flat back on the one before, slack loops instead of zigzags
            if (this.bend > 0) {
                for (let i = 0; i + 2 <= last; i++) {
                    const a = pts[i];
                    const b = pts[i + 2];
                    const wa = w(i);
                    const wb = w(i + 2);
                    if (wa + wb == 0) continue;
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const d = Math.hypot(dx, dy);
                    const min = (this.restOf(i) + this.restOf(i + 1)) * this.bend;
                    if (d >= min || d < 1e-9) continue;
                    const c = ((d - min) / d / (wa + wb)) * 0.5;
                    a.x += dx * c * wa;
                    a.y += dy * c * wa;
                    b.x -= dx * c * wb;
                    b.y -= dy * c * wb;
                }
            }
        }

        // Pushed out to the edge of anything solid, so the chain slides round it instead of through
        for (const { center, radius } of this.colliders) {
            for (let i = 1; i <= last; i++) {
                if (i == last && end) continue;
                const p = pts[i];
                const dx = p.x - center.x;
                const dy = p.y - center.y;
                const d = Math.hypot(dx, dy);
                if (d >= radius) continue;
                const s = d > 1e-6 ? radius / d : 1;
                p.x = center.x + (d > 1e-6 ? dx * s : radius);
                p.y = center.y + (d > 1e-6 ? dy * s : 0);
            }
        }

        const max = this.maxSpeed;
        for (let i = 1; i <= last; i++) {
            const p = pts[i];
            p.vx = (p.x - p.px) / h;
            p.vy = (p.y - p.py) / h;
            const speed = Math.hypot(p.vx, p.vy);
            if (speed > max) {
                p.vx *= max / speed;
                p.vy *= max / speed;
            }
        }
    }

    /** Points to draw, with any travelling waves added on top of the sim */
    shape(): Vec2[] {
        const out = this.pts.map((p) => v2.create(p.x, p.y));
        if (!this.waves.length || out.length < 3) return out;
        const span = v2.sub(out[out.length - 1], out[0]);
        const total = v2.length(span);
        if (total < 0.2) return out;
        const normal = v2.create(-span.y / total, span.x / total);
        const width = Math.min(Math.max(total * 0.35, 0.8), 2.4);
        let s = 0;
        for (let i = 1; i < out.length - 1; i++) {
            s += v2.length(v2.sub(out[i], out[i - 1]));
            const along = Math.min(s / total, 1);
            let off = 0;
            for (const wave of this.waves) {
                const front = (wave.age / wave.travel) * (total + width);
                const x = (front - s) / width;
                if (x < 0 || x > 1) continue;
                const fade = Math.max(1 - wave.age / (wave.travel * 1.6), 0);
                off += Math.sin(x * Math.PI * 2) * wave.amp * wave.side * fade;
            }
            // Ends are held, the crest lifts in the middle
            off *= Math.sin(along * Math.PI) ** 0.6;
            out[i] = v2.add(out[i], v2.mul(normal, off));
        }
        return out;
    }
}

/* -------------------------------------------------------------------------- */

export interface ChainStyle {
    /** Outside length of one link, world units */
    link: number;
    /** Outside width of a face on link */
    width: number;
    /** Distance between link centers along the chain, less than link since they interlock */
    pitch: number;
    /** Thickness of the metal */
    wire: number;
    outline: number;
    metal: number;
    shade: number;
    light: number;
    dark: number;
}

export const bronzeChain: ChainStyle = {
    link: 0.42,
    width: 0.27,
    pitch: 0.29,
    wire: 0.065,
    outline: 0.05,
    metal: 0xb07a3a,
    shade: 0x7a5024,
    light: 0xf0c27a,
    dark: 0x1c1208,
};

const BAKE_PPU = 128;

/**
 * Draws a chain along a polyline as individual oval links, alternating face on and
 * edge on, each turned along the chain. Links are placed at a fixed spacing counted
 * back from the end, so they never stretch, and links appear or vanish at the start
 * (inside the hand) as the chain reels.
 */
export class ChainView {
    container = new PIXI.Container();
    private faces = new PIXI.Container();
    private edges = new PIXI.Container();
    private faceTex: PIXI.Texture;
    private edgeTex: PIXI.Texture;
    private facePool: PIXI.Sprite[] = [];
    private edgePool: PIXI.Sprite[] = [];

    constructor(renderer: PIXI.IRenderer, public style: ChainStyle = bronzeChain) {
        this.container.addChild(this.faces, this.edges);
        const { faceTex, edgeTex } = bakeLinks(renderer, style);
        this.faceTex = faceTex;
        this.edgeTex = edgeTex;
    }

    /**
     * points: world units, y up, from the start to the end.
     * skipStart: chain length hidden at the start (inside the fist).
     * skipEnd: chain length before the end where the first link sits (inside the head's ring).
     */
    draw(points: Vec2[], skipStart = 0, skipEnd = 0) {
        const curve = smooth(points);
        const lengths = [0];
        for (let i = 1; i < curve.length; i++) lengths.push(lengths[i - 1] + v2.length(v2.sub(curve[i], curve[i - 1])));
        const total = lengths[lengths.length - 1];
        const at = (s: number): Vec2 => {
            if (s <= 0) return curve[0];
            if (s >= total) return curve[curve.length - 1];
            let lo = 0;
            let hi = lengths.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (lengths[mid] < s) lo = mid;
                else hi = mid;
            }
            const f = (s - lengths[lo]) / Math.max(lengths[hi] - lengths[lo], 1e-9);
            return v2.lerp(f, curve[lo], curve[hi]);
        };

        const { pitch, link } = this.style;
        let faces = 0;
        let edges = 0;
        for (let k = 0;; k++) {
            const s = total - skipEnd - k * pitch;
            if (s < skipStart) break;
            const a = at(s - link * 0.5);
            const b = at(s + link * 0.5);
            const mid = at(s);
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            const edge = k % 2 == 1;
            const pool = edge ? this.edgePool : this.facePool;
            const index = edge ? edges++ : faces++;
            let sprite = pool[index];
            if (!sprite) {
                sprite = new PIXI.Sprite(edge ? this.edgeTex : this.faceTex);
                sprite.anchor.set(0.5);
                sprite.scale.set(1 / BAKE_PPU);
                (edge ? this.edges : this.faces).addChild(sprite);
                pool.push(sprite);
            }
            sprite.visible = true;
            sprite.position.set(mid.x, -mid.y);
            sprite.rotation = -angle;
        }
        for (let i = faces; i < this.facePool.length; i++) this.facePool[i].visible = false;
        for (let i = edges; i < this.edgePool.length; i++) this.edgePool[i].visible = false;
    }
}

/** Catmull-Rom through the sim points, so a chain of a few dozen points reads as a smooth curve */
function smooth(points: Vec2[], per = 3): Vec2[] {
    if (points.length < 3) return points;
    const out: Vec2[] = [points[0]];
    for (let i = 0; i + 1 < points.length; i++) {
        const p0 = points[Math.max(i - 1, 0)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(i + 2, points.length - 1)];
        for (let k = 1; k <= per; k++) {
            const t = k / per;
            const t2 = t * t;
            const t3 = t2 * t;
            const f = (a: number, b: number, c: number, d: number) =>
                0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push(v2.create(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)));
        }
    }
    return out;
}

function bakeLinks(renderer: PIXI.IRenderer, style: ChainStyle) {
    const u = BAKE_PPU;
    const L = style.link * u;
    const W = style.width * u;
    const wire = style.wire * u;
    const line = style.outline * u;
    const pad = 4;
    const bake = (draw: (g: PIXI.Graphics) => void) => {
        const g = new PIXI.Graphics();
        draw(g);
        const w = L + line * 2 + pad * 2;
        const texture = renderer.generateTexture(g, {
            region: new PIXI.Rectangle(-w / 2, -w / 2, w, w),
            resolution: 1,
        });
        g.destroy();
        return texture;
    };
    // Stadium shaped ring centered on its middle, the long axis along x
    const stadium = (g: PIXI.Graphics, len: number, wid: number) => {
        const r = wid / 2;
        g.drawRoundedRect(-len / 2, -wid / 2, len, wid, r);
    };
    const faceTex = bake((g) => {
        const midL = L - wire - line;
        const midW = W - wire - line;
        g.lineStyle(wire + line * 2, style.dark, 1, 0.5);
        stadium(g, midL, midW);
        g.lineStyle(wire, style.metal, 1, 0.5);
        stadium(g, midL, midW);
        // Highlight along the top of the ring, shade along the bottom
        g.lineStyle(wire * 0.35, style.light, 1, 0.5);
        g.moveTo(-midL / 2 + midW / 2, -midW / 2 + wire * 0.15).lineTo(midL / 2 - midW / 2, -midW / 2 + wire * 0.15);
        g.lineStyle(wire * 0.35, style.shade, 1, 0.5);
        g.moveTo(-midL / 2 + midW / 2, midW / 2 - wire * 0.15).lineTo(midL / 2 - midW / 2, midW / 2 - wire * 0.15);
    });
    const edgeTex = bake((g) => {
        const thick = wire * 1.25;
        g.lineStyle(line, style.dark, 1, 0.5);
        g.beginFill(style.metal);
        stadium(g, L - line, thick + line);
        g.endFill();
        g.lineStyle(wire * 0.3, style.light, 1, 0.5);
        g.moveTo(-L / 2 + thick, -thick * 0.15).lineTo(L / 2 - thick, -thick * 0.15);
    });
    return { faceTex, edgeTex };
}
