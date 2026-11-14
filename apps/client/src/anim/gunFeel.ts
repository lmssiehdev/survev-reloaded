import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { math } from "@survev/shared/utils/math.ts";

/** How one shot of a gun feels, derived from its stats so every gun gets one without per gun work */
export interface GunFeel {
    /** 0-1, how big a single shot is */
    power: number;
    /** Multiplier over the gun's own hand recoil */
    handKick: number;
    /** World units the body is shoved back */
    bodyKick: number;
    /** Radians the body turns up, real aim is unchanged */
    climb: number;
    /** How fast the body recovers, heavy guns settle slower */
    stiffness: number;
    /** Radians the gun snaps up around the grip */
    gunSnap: number;
    /** How fast the gun comes back down, heavy guns are slower */
    gunSettle: number;
    /** World units the camera is shoved */
    cameraKick: number;
    /** Camera trauma, 0-1 */
    shake: number;
}

const cache = new Map<string, GunFeel>();

export function gunFeel(type: string): GunFeel {
    const cached = cache.get(type);
    if (cached) return cached;

    const def = GameObjectDefs.typeToDef(type, "gun");
    const bullet = GameObjectDefs.typeToDefSafe(def.bulletType);
    const damage = bullet?.type == "bullet" ? bullet.damage : 20;
    // Square root so a 100 damage sniper isn't 10 times bigger than an smg
    const power = math.clamp(Math.sqrt((damage * def.bulletCount) / 110), 0, 1);

    const feel: GunFeel = {
        power,
        handKick: math.lerp(power, 1.15, 2),
        bodyKick: math.lerp(power, 0.06, 0.5),
        climb: math.lerp(power, 0.015, 0.11),
        stiffness: math.lerp(power, 260, 90),
        gunSnap: math.lerp(power, 0.02, 0.5),
        gunSettle: math.lerp(power, 26, 9),
        cameraKick: math.lerp(power, 0.12, 1.15),
        shake: math.lerp(power, 0.03, 0.42),
    };
    cache.set(type, feel);
    return feel;
}
