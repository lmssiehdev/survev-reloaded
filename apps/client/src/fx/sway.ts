import type { ObstacleDef } from "@survev/shared/defs/mapObjects/obstacles/obstacleDefs.ts";
import { MapObjectDefs } from "@survev/shared/defs/register.ts";
import { collider } from "@survev/shared/utils/collider.ts";
import type { Camera } from "../camera.ts";
import type { Obstacle } from "../objects/obstacle.ts";
import type { FxWorld } from "./common.ts";

type Foliage = "tree" | "bush" | "none";

function foliageKind(def: ObstacleDef): Foliage {
    const z = def.img.zIdx ?? 0;
    if (z >= 200) return "tree";
    if (z >= 50) return "bush";
    return "none";
}

interface ObstacleState {
    id: number;
    health: number;
    punch: number;
    vel: number;
    brushed: boolean;
}

/** the wind as sway sees it: which way it blows and how hard (0 is calm, ~2 is a storm) */
export interface SwayWind {
    angle: number;
    strength: number;
}

// Wind sway plus a spring "punch" when foliage is hit or walked through.
export class Sway {
    state = new WeakMap<Obstacle, ObstacleState>();

    update(dt: number, time: number, camera: Camera, w: FxWorld, wind: SwayWind | null) {
        const players = w.playerBarn.playerPool.m_getPool();
        const obstacles = w.map.m_obstaclePool.m_getPool();
        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        const windX = Math.cos(wind?.angle ?? 0);
        const windY = Math.sin(wind?.angle ?? 0);
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (!o.active || !o.sprite.visible || !o.img) continue;
            const sp = o.sprite.position;
            if (sp.x < -300 || sp.y < -300 || sp.x > sw + 300 || sp.y > sh + 300) continue;
            const def = MapObjectDefs.typeToDef(o.type, "obstacle");
            const kind = foliageKind(def);

            let st = this.state.get(o);
            if (!st || st.id != o.__id) {
                st = { id: o.__id, health: o.healthT, punch: 0, vel: 0, brushed: false };
                this.state.set(o, st);
            }
            if (o.healthT < st.health - 0.001) st.vel -= 9;
            st.health = o.healthT;

            if (kind == "bush" && !o.dead) {
                const rad = (o.collider.type == collider.Type.Circle ? o.collider.rad : 1.5) + 0.6;
                let brushed = false;
                for (let j = 0; j < players.length; j++) {
                    const p = players[j];
                    if (!p.active || p.layer != o.layer) continue;
                    const dx = p.m_visualPos.x - o.pos.x;
                    const dy = p.m_visualPos.y - o.pos.y;
                    if (dx * dx + dy * dy < rad * rad) {
                        brushed = true;
                        break;
                    }
                }
                if (brushed && !st.brushed) st.vel -= 6;
                if (brushed) st.punch += Math.sin(time * 22) * 0.01;
                st.brushed = brushed;
            }

            // Damped spring back to rest.
            st.vel += (-260 * st.punch - 14 * st.vel) * dt;
            st.punch += st.vel * dt;

            const punch = st.punch;
            let rot = 0.05 * punch;
            let scale = 1 + 0.08 * punch;
            if (kind != "none" && !o.dead) {
                // Rolling gusts: a slow wave across the map scales a faster sway.
                const phase = o.pos.x * 0.11 + o.pos.y * 0.07;
                // Gust bands travel downwind, the same direction as rain, clouds and leaves.
                const along = o.pos.x * windX + o.pos.y * windY;
                const wave = 0.55 + 0.45 * Math.sin(time * 0.35 - along * 0.015);
                const gust = wind ? wave * (0.4 + wind.strength) : wave;
                const amp = kind == "tree" ? 0.03 : 0.02;
                rot += amp * gust * Math.sin(time * 1.1 + phase);
                scale += (kind == "tree" ? 0.012 : 0.025) * gust * Math.sin(time * 1.7 + phase * 1.3);
            }
            o.sprite.rotation += rot;
            o.sprite.scale.x *= scale;
            o.sprite.scale.y *= scale;
        }
    }
}
