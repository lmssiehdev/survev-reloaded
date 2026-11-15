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
function swingMove(def: MeleeDef, mirror: boolean): Move {
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

/**
 * A spear thrust: the body coils back and stretches, then drives in behind the point
 * and squashes on the hit. Barely any turn, the power goes straight down the aim.
 */
function thrustMove(def: MeleeDef): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    const coil = hit * 0.45;
    return {
        duration: end,
        tracks: {
            bodyX: path([0, 0], [coil, -2.5, "out"], [hit, 6, "in"], [hit + 0.06, 6], [end, 0, "inOut"]),
            bodyRot: path([0, 0], [coil, 0.08, "out"], [hit, -0.06, "in"], [end, 0, "inOut"]),
            squash: beats(
                { at: 0, to: -0.06, attack: coil, settle: hit - coil, attackEase: "out", settleEase: "in" },
                kick(hit - 0.035, 0.1, end - hit),
            ),
        },
    };
}

/**
 * Katana draw cut: the blade coils back over the shoulder, the body snaps through the
 * cut on the hit and the blade is twirled once and resheathed while it recovers.
 */
function katanaMove(def: MeleeDef): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    const coil = hit * 0.6;
    return {
        duration: end,
        tracks: {
            gunRot: path([0, 0], [hit, 0], [end, -Math.PI * 2, "inOut"]),
            bodyRot: path([0, 0], [coil, 0.3, "out"], [hit, -0.35, "in"], [end, 0, "inOut"]),
            bodyX: beats({
                at: hit - 0.03,
                to: 5,
                attack: 0.04,
                settle: end - hit,
                attackEase: "snap",
                settleEase: "inOut",
            }),
            squash: beats(
                { at: 0, to: -0.06, attack: coil, settle: hit - coil, attackEase: "out", settleEase: "in" },
                kick(hit - 0.03, 0.14, end - hit),
            ),
        },
    };
}

/** Overhead chop: a long wind up, a slam that sticks in for a beat, then pulled free */
function chopMove(def: MeleeDef): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    const raise = hit * 0.6;
    const stuck = hit + (end - hit) * 0.35;
    return {
        duration: end,
        tracks: {
            rigX: path([0, 0], [raise, -6, "out"], [hit, 8, "in"], [stuck, 8], [end, 0, "inOut"]),
            bodyX: path([0, 0], [raise, -2, "out"], [hit, 4.5, "in"], [stuck, 4.5], [end, 0, "inOut"]),
            bodyRot: path([0, 0], [raise, 0.3, "out"], [hit, -0.2, "in"], [stuck, -0.2], [end, 0, "inOut"]),
            squash: path([0, 0], [raise, -0.1, "out"], [hit, 0.2, "in"], [stuck, 0.06, "out"], [end, 0, "inOut"]),
        },
    };
}

/**
 * Sledgehammer slam: a long heave up and back, then the whole body drops onto the
 * hit and squashes hard. No spin: a fast body turn makes the weapon drag pull the
 * head off the second hand.
 */
function slamMove(def: MeleeDef): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    const raise = hit * 0.7;
    const settle = hit + (end - hit) * 0.3;
    return {
        duration: end,
        tracks: {
            rigX: path([0, 0], [raise, -5, "out"], [hit, 7, "in"], [settle, 7], [end, 0, "inOut"]),
            bodyX: path([0, 0], [raise, -2.5, "out"], [hit, 5, "in"], [settle, 5], [end, 0, "inOut"]),
            bodyRot: path([0, 0], [raise, 0.18, "out"], [hit, -0.08, "in"], [end, 0, "inOut"]),
            squash: path([0, 0], [raise, -0.14, "out"], [hit, 0.26, "in"], [settle, 0.08, "out"], [end, 0, "inOut"]),
        },
    };
}

/** Pan bonk: a cartoon wind up, a flat whack that squashes hard and wobbles back */
function bonkMove(def: MeleeDef): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    const raise = hit * 0.7;
    return {
        duration: end,
        tracks: {
            gunRot: path([0, 0], [raise, 0.5, "out"], [hit, -0.1, "in"], [end, 0, "inOut"]),
            bodyRot: path([0, 0], [raise, 0.35, "out"], [hit, -0.08, "in"], [end, 0, "inOut"]),
            bodyX: path([0, 0], [raise, -2, "out"], [hit, 3.5, "in"], [end, 0, "inOut"]),
            squash: path([0, 0], [raise, -0.12, "out"], [hit, 0.22, "in"], [hit + (end - hit) * 0.4, -0.05, "out"], [
                end,
                0,
                "inOut",
            ]),
        },
    };
}

/** Knife stab: a small coil, then the body lunges in behind the point */
function stabMove(def: MeleeDef): Move {
    const hit = def.attack.damageTimes[0];
    const end = def.attack.cooldownTime;
    return {
        duration: end,
        tracks: {
            bodyX: beats(kick(hit - 0.03, 5, end - hit)),
            bodyRot: beats(kick(hit - 0.03, -0.15, end - hit)),
            squash: beats(
                { at: 0, to: -0.06, attack: hit * 0.6, settle: hit * 0.4, attackEase: "out", settleEase: "in" },
                kick(hit - 0.03, 0.16, end - hit),
            ),
        },
    };
}

/** Karambit: the slash, then the knife spins once on its finger ring */
function twirlMove(def: MeleeDef, mirror: boolean): Move {
    const swing = swingMove(def, mirror);
    const hit = def.attack.damageTimes[0];
    const turn = Math.PI * 2 * (mirror ? -1 : 1);
    return {
        ...swing,
        tracks: { ...swing.tracks, gunRot: path([0, 0], [hit, 0], [def.attack.cooldownTime, turn, "inOut"]) },
    };
}

/** Attack anims with a body of their own, by the animData name the def picks; the rest swing */
const attackMoves: Partial<Record<string, (def: MeleeDef, mirror: boolean) => Move>> = {
    tridentThrust: thrustMove,
    katanaSwing: katanaMove,
    axeSwing: chopMove,
    hammerSwing: slamMove,
    pan: bonkMove,
    thrust: stabMove,
    stab: stabMove,
    slash: twirlMove,
};

/** The body move for the attack anim playAnim picked */
export function meleeAttackMove(def: MeleeDef, attackAnim: string, mirror: boolean): Move {
    return attackMoves[attackAnim]?.(def, mirror) ?? swingMove(def, mirror);
}
