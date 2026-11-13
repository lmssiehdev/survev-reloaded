import type { Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";
import type { AudioManager } from "../audioManager.ts";
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
