import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { math } from "@survev/shared/utils/math.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";
import { additiveSprite, type FxWorld, onScreen, SpritePool, WarmLight } from "./common.ts";
import { type Look, rgbToHex } from "./look.ts";

interface Flash {
    pos: Vec2;
    color: number;
    rad: number;
    intensity: number;
    age: number;
    life: number;
}

// Lightmap: drawn at quarter resolution, then multiplied over the world.
const LightScale = 0.25;

export class Lights {
    rt: PIXI.RenderTexture | null = null;
    scene = new PIXI.Container();
    ambient = new PIXI.Sprite(PIXI.Texture.WHITE);
    lights: SpritePool;
    overlay = new PIXI.Sprite();
    // Additive glow for flashes, so they pop in daylight too.
    glow = new PIXI.Container();
    glows: SpritePool;

    flashes: Flash[] = [];
    seenBullets = new WeakSet<Vec2>();
    seenExplosions = new WeakSet<Vec2>();

    constructor(falloff: PIXI.Texture) {
        this.scene.addChild(this.ambient);
        this.lights = new SpritePool(this.scene, additiveSprite(falloff));
        this.glows = new SpritePool(this.glow, additiveSprite(falloff));
        this.overlay.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    }

    hide() {
        this.overlay.visible = false;
        this.glow.visible = false;
    }

    // Muzzle flashes and explosions, read off the existing barns without hooks.
    collectFlashes(dt: number, w: FxWorld, onExplosion: (pos: Vec2, rad: number) => void) {
        const layer = w.renderer.layer;
        const bullets = w.bulletBarn.bullets;
        for (let i = 0; i < bullets.length; i++) {
            const b = bullets[i];
            if (!b.alive || this.seenBullets.has(b.startPos)) continue;
            this.seenBullets.add(b.startPos);
            if (b.layer != layer && !(b.layer & 2)) continue;
            this.flashes.push({
                pos: b.startPos,
                color: WarmLight,
                rad: b.suppressed ? 3 : 6,
                intensity: b.suppressed ? 0.5 : 1,
                age: 0,
                life: 0.08,
            });
        }
        const explosions = w.explosionBarn.explosions;
        for (let i = 0; i < explosions.length; i++) {
            const e = explosions[i];
            if (!e.active || this.seenExplosions.has(e.pos)) continue;
            this.seenExplosions.add(e.pos);
            const def = GameObjectDefs.typeToDef(e.type, "explosion");
            if (def.damage <= 0) continue;
            this.flashes.push({
                pos: e.pos,
                color: 0xffa24a,
                rad: def.rad.max * 2.2,
                intensity: 1.4,
                age: 0,
                life: 0.7,
            });
            onExplosion(e.pos, def.rad.max);
        }
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const f = this.flashes[i];
            f.age += dt;
            if (f.age > f.life) this.flashes.splice(i, 1);
        }
    }

    update(pixi: PIXI.IRenderer, camera: Camera, w: FxWorld, look: Look) {
        this.glow.visible = true;
        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        const k = LightScale;
        const rw = Math.max(1, Math.ceil(sw * k));
        const rh = Math.max(1, Math.ceil(sh * k));
        if (!this.rt || this.rt.width != rw || this.rt.height != rh) {
            this.rt?.destroy(true);
            this.rt = PIXI.RenderTexture.create({ width: rw, height: rh });
            this.overlay.texture = this.rt;
        }
        const amb = look.ambient;
        const dark = 1 - (amb[0] + amb[1] + amb[2]) / 3 > 0.01;

        this.lights.begin();
        this.glows.begin();
        const addLight = (pos: Vec2, rad: number, color: number, alpha: number) => {
            const sp = camera.m_pointToScreen(pos);
            const r = camera.m_scaleToScreen(rad);
            if (!onScreen(camera, sp.x, sp.y, r)) return;
            const s = this.lights.next();
            s.position.set(sp.x * k, sp.y * k);
            s.width = s.height = r * 2 * k;
            s.tint = color;
            s.alpha = alpha;
        };
        const addGlow = (pos: Vec2, rad: number, color: number, alpha: number) => {
            const sp = camera.m_pointToScreen(pos);
            const s = this.glows.next();
            s.position.set(sp.x, sp.y);
            s.width = s.height = camera.m_scaleToScreen(rad) * 2;
            s.tint = color;
            s.alpha = alpha;
        };

        if (dark) {
            // Lanterns follow the clock, not the clouds, so a grey afternoon doesn't get spotlights.
            const lantern = math.smoothstep(look.night, 0.2, 0.8);
            const players = w.playerBarn.playerPool.m_getPool();
            for (let i = 0; i < players.length; i++) {
                const p = players[i];
                if (!p.active || p.m_netData.m_dead) continue;
                const local = p.__id == w.activeId;
                // Readability first: whatever the mood, a player keeps most of their own colour.
                addLight(p.m_visualPos, 2.4, 0xffffff, 0.65);
                // Everyone carries a lantern; yours reaches further so the screen stays playable.
                if (lantern > 0.01) addLight(p.m_visualPos, local ? 12 : 6, WarmLight, (local ? 0.7 : 0.55) * lantern);
            }
            const bullets = w.bulletBarn.bullets;
            for (let i = 0; i < bullets.length; i++) {
                const b = bullets[i];
                if (!b.alive) continue;
                addLight(b.pos, 4, b.bulletTrail.tint as number, 0.7);
            }
        }
        for (const f of this.flashes) {
            const t = 1 - f.age / f.life;
            const fade = t * t;
            if (dark) addLight(f.pos, f.rad * 1.8, f.color, Math.min(1, f.intensity * fade));
            addGlow(f.pos, f.rad * 0.6, f.color, 0.35 * f.intensity * fade);
        }
        this.lights.end();
        this.glows.end();

        this.overlay.visible = dark;
        if (dark) {
            this.ambient.tint = rgbToHex(amb);
            this.ambient.width = rw;
            this.ambient.height = rh;
            pixi.render(this.scene, { renderTexture: this.rt, clear: true });
            this.overlay.width = sw;
            this.overlay.height = sh;
        }
    }

    free() {
        this.rt?.destroy(true);
        this.rt = null;
    }
}
