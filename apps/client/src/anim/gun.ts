import type { GunDef } from "@survev/shared/defs/gameObjects/gunDefs.ts";
import { beats, kick, type Move, path } from "./move.ts";

/** How far the gun tips over during a reload, radians */
const reloadTilt = -0.55;
/** Body pixels the off hand travels to fetch a mag, back and down toward the hip */
const beltX = -14;
const beltY = 14;
const rackDist = 9;
const cycleDist = 11;

/** The new weapon swings in from the hip with an overshoot, then a settle beat */
export function drawMove(): Move {
    return {
        duration: 0.5,
        tracks: {
            rigRot: path([0, 1.1], [0.05, 1.1], [0.3, 0, "back"]),
            rigX: path([0, -9], [0.05, -9], [0.3, 0, "back"]),
            bodyRot: beats({ at: 0.05, to: 0.1, attack: 0.1, settle: 0.3, attackEase: "out", settleEase: "back" }),
            squash: beats(kick(0.3, 0.05, 0.15)),
        },
    };
}

/**
 * Pump and bolt guns: the off hand slides back and forward once the shot has rung
 * out, on the same delay the client ejects the shell with.
 */
export function cycleMove(def: GunDef): Move | null {
    if (!def.pullDelay || def.caseTiming != "shoot") return null;
    const at = def.pullDelay * 0.45;
    return {
        duration: at + 0.24,
        tracks: {
            handLX: path([0, 0], [at, 0], [at + 0.1, -cycleDist, "out"], [at + 0.14, -cycleDist], [
                at + 0.24,
                0,
                "out",
            ]),
        },
    };
}

/**
 * The server only knows a reload time, so this fills it with fast moves and long
 * holds: the gun tips over, the off hand fetches a mag from the hip, puts it in and
 * racks the gun. Short reloads run the same moves faster.
 */
export function reloadMove(total: number): Move {
    const pace = Math.min(total / 1.5, 1);
    const insertAt = total - 0.62 * pace;
    const rackAt = total - 0.34 * pace;
    return {
        duration: total,
        tracks: {
            gunRot: path([0, 0], [0.13 * pace, reloadTilt, "back"], [total - 0.15 * pace, reloadTilt], [
                total,
                0,
                "back",
            ]),
            handLX: path(
                [0, 0],
                [0.1 * pace, 0],
                [0.26 * pace, beltX, "out"],
                [insertAt, beltX],
                [insertAt + 0.13 * pace, 0, "out"],
                [rackAt, 0],
                [rackAt + 0.06 * pace, -rackDist, "out"],
                [rackAt + 0.11 * pace, 0, "out"],
            ),
            handLY: path([0, 0], [0.1 * pace, 0], [0.26 * pace, beltY, "out"], [insertAt, beltY], [
                insertAt + 0.13 * pace,
                0,
                "out",
            ]),
        },
    };
}
