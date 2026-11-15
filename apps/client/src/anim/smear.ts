import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";

/** Seconds a sample of the blade stays on screen */
const life = 0.1;
/** Tip speed, world units a second, where the blade starts leaving a smear */
const minSpeed = 9;
/** How far up the blade from the hand the smear starts, 0 hand to 1 tip */
const from = 0.45;

interface Sample {
    base: Vec2;
    tip: Vec2;
    age: number;
}

/** Hand and tip ends of a weapon texture in sprite local space, the tip is the end further from the body */
const endsCache = new WeakMap<PIXI.Texture, { hand: PIXI.Point; tip: PIXI.Point }>();

function bladeEnds(sprite: PIXI.Sprite, body: PIXI.Container) {
    let ends = endsCache.get(sprite.texture);
    if (ends) return ends;
    const bounds = sprite.getLocalBounds();
    const center = sprite.toLocal(body.toGlobal(new PIXI.Point(0, 0)));
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    // The two ends of the sprite's long axis
    const a = bounds.width >= bounds.height ? new PIXI.Point(bounds.x, midY) : new PIXI.Point(midX, bounds.y);
    const b = bounds.width >= bounds.height
        ? new PIXI.Point(bounds.x + bounds.width, midY)
        : new PIXI.Point(midX, bounds.y + bounds.height);
    const dist = (p: PIXI.Point) => Math.hypot(p.x - center.x, p.y - center.y);
    ends = dist(a) > dist(b) ? { tip: a, hand: b } : { tip: b, hand: a };
    endsCache.set(sprite.texture, ends);
    return ends;
}

/**
 * The white smear a fast blade leaves behind: the last tenth of a second of the
 * blade's edge, filled in and thinning toward the tip as it ages. Kept in world
 * space so it stays put while the player moves.
 */
export class BladeSmear {
    graphics = new PIXI.Graphics();
    private history: Sample[] = [];
    /** Last tip position relative to the player, so walking doesn't count as swinging */
    private lastTip: Vec2 | null = null;

    /**
     * Call from render once the player container is placed. `layer` is the container the
     * player is drawn in, its space is the camera's screen space. Only `cutting` adds to the
     * smear, the rest of the swing lets it fade
     */
    update(
        dt: number,
        camera: Camera,
        sprite: PIXI.Sprite | null,
        body: PIXI.Container,
        layer: PIXI.Container,
        playerPos: Vec2,
        cutting: boolean,
    ) {
        for (const sample of this.history) sample.age += dt;
        while (this.history.length && this.history[this.history.length - 1].age > life) this.history.pop();

        if (sprite?.visible && sprite.worldVisible && sprite.texture.valid) {
            const { hand, tip } = bladeEnds(sprite, body);
            const base = new PIXI.Point(hand.x + (tip.x - hand.x) * from, hand.y + (tip.y - hand.y) * from);
            const edge = {
                base: camera.m_screenToPoint(layer.toLocal(base, sprite)),
                tip: camera.m_screenToPoint(layer.toLocal(tip, sprite)),
            };
            const rel = v2.sub(edge.tip, playerPos);
            const speed = this.lastTip && dt > 0 ? v2.length(v2.sub(rel, this.lastTip)) / dt : 0;
            if (cutting && speed > minSpeed) {
                this.history.unshift({ ...edge, age: 0 });
            } else if (dt > 0 && this.history.length && this.history[0].age > 0.03) {
                // The blade stopped, drop the smear rather than bridge to where it rests
                this.history.length = 0;
            }
            if (dt > 0) this.lastTip = rel;
        } else {
            this.history.length = 0;
            this.lastTip = null;
        }

        // Each pair of samples is filled in, the older end thins toward the tip
        const g = this.graphics;
        g.clear();
        for (let i = 0; i + 1 < this.history.length; i++) {
            const a = this.history[i];
            const b = this.history[i + 1];
            const baseA = v2.add(a.tip, v2.mul(v2.sub(a.base, a.tip), 1 - a.age / life));
            const baseB = v2.add(b.tip, v2.mul(v2.sub(b.base, b.tip), 1 - b.age / life));
            const pts = [a.tip, b.tip, baseB, baseA].map((p) => camera.m_pointToScreen(p));
            g.beginFill(0xffffff, 1);
            g.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
            g.endFill();
        }
    }

    clear() {
        this.history.length = 0;
        this.lastTip = null;
        this.graphics.clear();
    }
}
