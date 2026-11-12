import type { MeleeDef } from "@survev/shared/defs/gameObjects/meleeDefs.ts";
import { math } from "@survev/shared/utils/math.ts";
import { beats, kick, type Move, path } from "./move.ts";

/** For melee weapons whose def doesn't say how heavy they are */
const defaultWeight = 0.5;
/** The heaviest a weapon gets, the sledgehammer */
const maxWeight = 1.8;

export function meleeWeight(def: MeleeDef) {
    return def.anim.weight ?? defaultWeight;
}

/**
 * Body follow through for a melee attack, on top of the hand keyframes in animData:
 * the shoulders wind back, turn into the strike, the body leans in and squashes on it.
 * Peaks on the weapon's first damage time and has settled by its cooldown, so it stays
 * in step with the server. Heavier weapons turn and lean further.
 */
export function meleeAttackMove(def: MeleeDef, mirror: boolean): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    const heft = math.clamp(meleeWeight(def) / maxWeight, 0, 1);
    // Strikes come from the right hand and bring the right shoulder forward, a
    // counterclockwise turn. Mirrored attacks use the left hand.
    const side = mirror ? 1 : -1;
    const turn = (0.14 + 0.3 * heft) * side;
    const squash = 0.05 + 0.05 * heft;
    /** Body pixels, well inside the hitbox */
    const lean = 1.5 + 2.5 * heft;
    const strike = Math.max(hit - 0.035, 0);
    return {
        duration: end,
        tracks: {
            bodyRot: path([0, 0], [hit * 0.5, -turn * 0.4, "out"], [hit, turn, "in"], [end, 0, "inOut"]),
            bodyX: beats(kick(strike, lean, end - hit)),
            squash: beats(kick(strike, squash, end - hit)),
        },
    };
}
