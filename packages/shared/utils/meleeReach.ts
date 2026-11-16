import { coldet } from "./coldet.ts";
import { v2, type Vec2 } from "./v2.ts";

/** Slack around a body a thrown head still catches, world units */
const reachSlack = 0.5;

/**
 * Whether a thrown melee head (a def with `attack.reach`) flying along `dir` catches a
 * player. `pen` grows the nearer the player is, so sorting by it picks the first in line
 */
export function meleeReachHit(from: Vec2, dir: Vec2, reach: number, pos: Vec2, rad: number) {
    const hit = coldet.intersectSegmentCircle(from, v2.add(from, v2.mul(dir, reach)), pos, rad + reachSlack);
    if (!hit) return null;
    return { pen: reach - v2.length(v2.sub(hit.point, from)) };
}
