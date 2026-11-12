import type { ObstacleDef } from "@survev/shared/defs/mapObjects/obstacles/obstacleDefs.ts";
import { MapObjectDefs } from "@survev/shared/defs/register.ts";
import { math } from "@survev/shared/utils/math.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";
import type { FxWorld } from "./common.ts";
import { type Look, rgbToHex } from "./look.ts";

// One key light all match: shadows always fall down and to the right; only their length changes.
const SunDir = { x: 0.55, y: 0.83 };

// How tall an obstacle reads visually, from its draw order: trees > bushes > crates/walls.
function casterHeight(def: ObstacleDef) {
    const z = def.img.zIdx ?? 0;
    if (z >= 200) return 2.2;
    if (z >= 50) return 0.8;
    if (z >= 10) return 0.7;
    return 0;
}

export class Shadows {
    container = new PIXI.Container();
    sprites: PIXI.Sprite[] = [];
    blur = new PIXI.BlurFilter(3, 2, 0.5);
    count = 0;

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
        const shadeTint = rgbToHex(look.shade);

        const margin = 200;
        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        let n = 0;
        const next = () => {
            let s = this.sprites[n];
            if (!s) {
                s = new PIXI.Sprite();
                this.sprites.push(s);
                this.container.addChild(s);
            }
            n++;
            s.visible = true;
            s.tint = shadeTint;
            return s;
        };
        const add = (src: PIXI.Sprite, height: number, alpha: number) => {
            if (alpha <= 0.01) return;
            const x = src.position.x;
            const y = src.position.y;
            if (x < -margin || y < -margin || x > sw + margin || y > sh + margin) return;
            const s = next();
            s.texture = src.texture;
            s.anchor.copyFrom(src.anchor);
            s.scale.copyFrom(src.scale);
            s.rotation = src.rotation;
            s.position.set(x + dirX * height, y + dirY * height);
            s.alpha = strength * alpha;
        };

        const obstacles = w.map.m_obstaclePool.m_getPool();
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (!o.active || o.dead || o.layer != 0 || !o.sprite.visible || !o.img) continue;
            const def = MapObjectDefs.typeToDef(o.type, "obstacle");
            const h = casterHeight(def);
            if (h > 0) add(o.sprite, h, o.sprite.alpha);
        }
        const buildings = w.map.m_buildingPool.m_getPool();
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i];
            if (!b.active || b.layer != 0) continue;
            for (const img of b.imgs) {
                if (img.isCeiling && img.sprite.visible) add(img.sprite, 1.6, img.sprite.alpha);
            }
        }
        // Players get a soft blob, the cheapest way to ground a character.
        const players = w.playerBarn.playerPool.m_getPool();
        const prad = camera.m_scaleToScreen(1.25) * 2;
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            if (!p.active || p.m_netData.m_dead || p.layer != 0) continue;
            const sp = camera.m_pointToScreen(p.m_visualPos);
            const s = next();
            s.texture = this.falloff;
            s.anchor.set(0.5, 0.5);
            s.rotation = 0;
            s.width = prad;
            s.height = prad;
            s.position.set(sp.x + dirX * 0.35, sp.y + dirY * 0.35);
            s.alpha = Math.min(1, strength * 1.4);
        }
        for (let i = n; i < this.sprites.length; i++) this.sprites[i].visible = false;
        this.count = n;
    }
}
