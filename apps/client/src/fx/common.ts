import type { ObstacleDef } from "@survev/shared/defs/mapObjects/obstacles/obstacleDefs.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";
import type { AudioManager } from "../audioManager.ts";
import type { Camera } from "../camera.ts";
import type { Map } from "../map.ts";
import type { BulletBarn } from "../objects/bullet.ts";
import type { ExplosionBarn } from "../objects/explosion.ts";
import type { PlayerBarn } from "../objects/player.ts";
import type { Renderer } from "../renderer.ts";

/** the parts of the game the effects read each frame */
export interface FxWorld {
    map: Map;
    renderer: Renderer;
    playerBarn: PlayerBarn;
    bulletBarn: BulletBarn;
    explosionBarn: ExplosionBarn;
    activeId: number;
    audio: AudioManager;
    activePos: Vec2;
    activeLayer: number;
}

// Two temperatures: cool ambient from the look, and this one warm colour for every practical
// light (lanterns, muzzle flashes). Explosions run a little hotter.
export const WarmLight = 0xffd9a8;

// Soft round falloff, used for lights, glows and player shadows. Procedural, no art.
export function createFalloffTexture() {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (let i = 0; i <= 8; i++) {
        const r = i / 8;
        const a = (1 - r * r) ** 2;
        grad.addColorStop(r, `rgba(255,255,255,${a.toFixed(3)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return PIXI.Texture.from(canvas);
}

/** sprites reused frame to frame: call `begin`, take one with `next` per thing drawn, then `end` */
export class SpritePool {
    sprites: PIXI.Sprite[] = [];
    count = 0;

    constructor(public parent: PIXI.Container, public create: () => PIXI.Sprite) {}

    begin() {
        this.count = 0;
    }

    next() {
        let s = this.sprites[this.count];
        if (!s) {
            s = this.create();
            this.sprites.push(s);
            this.parent.addChild(s);
        }
        this.count++;
        s.visible = true;
        return s;
    }

    /** hides whatever wasn't used this frame */
    end() {
        for (let i = this.count; i < this.sprites.length; i++) this.sprites[i].visible = false;
    }
}

/** an additive soft light, drawn with the falloff texture */
export const additiveSprite = (falloff: PIXI.Texture) => () => {
    const s = new PIXI.Sprite(falloff);
    s.anchor.set(0.5, 0.5);
    s.blendMode = PIXI.BLEND_MODES.ADD;
    return s;
};

export function onScreen(camera: Camera, x: number, y: number, margin: number) {
    return x >= -margin && y >= -margin && x <= camera.m_screenWidth + margin && y <= camera.m_screenHeight + margin;
}

export type ObstacleKind = "tree" | "bush" | "low" | "flat";

// What an obstacle is, read from its draw order: trees over bushes over crates and walls.
export function obstacleKind(def: ObstacleDef): ObstacleKind {
    const z = def.img.zIdx ?? 0;
    if (z >= 200) return "tree";
    if (z >= 50) return "bush";
    if (z >= 10) return "low";
    return "flat";
}
