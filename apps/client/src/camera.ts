import { math } from "@survev/shared/utils/math.ts";
import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import { Spring } from "./anim/spring.ts";

/** Trauma lost a second */
const traumaDecay = 2.6;
/** World units of shake at full trauma */
const maxTraumaShake = 1.1;

export default class Camera {
    m_pos = v2.create(0, 0);
    m_ppu = 16;
    m_zoom = 1.5;
    m_targetZoom = 1.5;
    m_screenWidth = 1;
    m_screenHeight = 1;
    m_shakeEnabled = true;
    m_shakeInt = 0;
    m_kickX = new Spring(150, 16);
    m_kickY = new Spring(150, 16);
    m_trauma = 0;
    m_feelTime = 0;

    m_interpEnabled = true;
    m_localRotationEnabled = false;
    m_interpInterval = 0;

    m_z() {
        return this.m_ppu * this.m_zoom;
    }

    m_pointToScreen(point: Vec2) {
        return {
            x: this.m_screenWidth * 0.5 + (point.x - this.m_pos.x) * this.m_z(),
            y: this.m_screenHeight * 0.5 - (point.y - this.m_pos.y) * this.m_z(),
        };
    }

    m_screenToPoint(screen: Vec2) {
        return {
            x: this.m_pos.x + (screen.x - this.m_screenWidth * 0.5) / this.m_z(),
            y: this.m_pos.y + (this.m_screenHeight * 0.5 - screen.y) / this.m_z(),
        };
    }

    m_pixels(p: number) {
        return p * this.m_zoom;
    }

    m_scaleToScreen(s: number) {
        return s * this.m_z();
    }

    m_setShakeEnabled(en: boolean) {
        this.m_shakeEnabled = en;
    }

    m_setInterpEnabled(en: boolean) {
        this.m_interpEnabled = en;
    }

    m_setRotationEnabled(en: boolean) {
        this.m_localRotationEnabled = en;
    }

    m_addShake(pos: Vec2, intensity: number) {
        const dist = v2.length(v2.sub(this.m_pos, pos));
        const newInt = math.delerp(dist, 40, 10) * intensity;
        this.m_shakeInt = Math.max(this.m_shakeInt, newInt);
    }

    /** Directional shove, world units, springs back on its own */
    m_addKick(dir: Vec2, amount: number) {
        this.m_kickX.shove(dir.x * amount);
        this.m_kickY.shove(dir.y * amount);
    }

    /** Shake grows with trauma squared, so small shots stay readable and only big events move the view */
    m_addTrauma(amount: number) {
        this.m_trauma = Math.min(this.m_trauma + amount, 1);
    }

    m_applyShake(dt: number) {
        this.m_kickX.update(dt);
        this.m_kickY.update(dt);
        this.m_trauma = Math.max(this.m_trauma - traumaDecay * dt, 0);
        this.m_feelTime += dt;
        if (this.m_shakeEnabled) {
            this.m_pos = v2.add(this.m_pos, v2.randomUnit(this.m_shakeInt));
            // Sums of fast sines read like noise and need no allocation
            const t = this.m_feelTime;
            const shake = this.m_trauma * this.m_trauma * maxTraumaShake;
            this.m_pos.x += this.m_kickX.pos + shake * Math.sin(t * 61) * Math.cos(t * 37);
            this.m_pos.y += this.m_kickY.pos + shake * Math.sin(t * 53 + 1.7) * Math.cos(t * 41);
        }
        this.m_shakeInt = 0;
    }
}
export { Camera };
