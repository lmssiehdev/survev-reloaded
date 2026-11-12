import { MapObjectDefs } from "@survev/shared/defs/register.ts";
import { math } from "@survev/shared/utils/math.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";
import { type FxWorld, type ObstacleKind, obstacleKind, onScreen, SpritePool } from "./common.ts";
import { type Look, rgbToHex } from "./look.ts";

// One key light all match: shadows always fall down and to the right; only their length changes.
const SunDir = { x: 0.55, y: 0.83 };

// How tall each kind of obstacle reads, which sets how far its shadow reaches.
const CasterHeight: Record<ObstacleKind, number> = { tree: 2.2, bush: 0.8, low: 0.7, flat: 0 };
const RoofHeight = 1.6;
const PlayerHeight = 0.35;

export class Shadows {
    container = new PIXI.Container();
    pool = new SpritePool(this.container, () => new PIXI.Sprite());
    // One blur pass at half resolution: soft enough, and cheap on integrated GPUs.
    blur = new PIXI.BlurFilter(3, 1, 0.5);

    constructor(public falloff: PIXI.Texture) {
        this.container.filters = [this.blur];
    }

    hide() {
        this.container.visible = false;
    }

    /** `overcast` 0..1 softens and shortens them, so a grey day still has contact shadows */
    update(camera: Camera, w: FxWorld, look: Look, overcast: number) {
        this.container.visible = true;
        w.renderer.addPIXIObj(this.container, 0, 9, 0);

        // Shadows stretch as the sun gets low and fade out at night.
        const elev = look.sunElev;
        const strength = 0.6 * math.smoothstep(elev, 0.0, 0.2) * (1 - 0.6 * overcast);
        const len = math.clamp(0.5 / Math.max(elev, 0.15), 0.5, 2.5) * (1 - 0.5 * overcast);
        const z = camera.m_z();
        const dirX = SunDir.x * len * z;
        const dirY = SunDir.y * len * z;
        this.blur.blur = math.clamp(z * (0.12 + 0.25 * overcast), 1, 10);
        const tint = rgbToHex(look.shade);
        const pool = this.pool;
        pool.begin();

        const copy = (src: PIXI.Sprite, height: number) => {
            const { x, y } = src.position;
            if (src.alpha <= 0.01 || !onScreen(camera, x, y, 200)) return;
            const s = pool.next();
            s.texture = src.texture;
            s.anchor.copyFrom(src.anchor);
            s.scale.copyFrom(src.scale);
            s.rotation = src.rotation;
            s.position.set(x + dirX * height, y + dirY * height);
            s.tint = tint;
            s.alpha = strength * src.alpha;
        };

        const obstacles = w.map.m_obstaclePool.m_getPool();
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (!o.active || o.dead || o.layer != 0 || !o.sprite.visible || !o.img) continue;
            const h = CasterHeight[obstacleKind(MapObjectDefs.typeToDef(o.type, "obstacle"))];
            if (h > 0) copy(o.sprite, h);
        }
        const buildings = w.map.m_buildingPool.m_getPool();
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i];
            if (!b.active || b.layer != 0) continue;
            for (const img of b.imgs) {
                if (img.isCeiling && img.sprite.visible) copy(img.sprite, RoofHeight);
            }
        }
        // Players get a soft blob, the cheapest way to ground a character.
        const players = w.playerBarn.playerPool.m_getPool();
        const size = camera.m_scaleToScreen(1.25) * 2;
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            if (!p.active || p.m_netData.m_dead || p.layer != 0) continue;
            const sp = camera.m_pointToScreen(p.m_visualPos);
            const s = pool.next();
            s.texture = this.falloff;
            s.anchor.set(0.5, 0.5);
            s.rotation = 0;
            s.width = size;
            s.height = size;
            s.position.set(sp.x + dirX * PlayerHeight, sp.y + dirY * PlayerHeight);
            s.tint = tint;
            s.alpha = Math.min(1, strength * 1.4);
        }
        pool.end();
    }
}
