import { TeamMode } from "@survev/shared/gameConfig.ts";
import { math } from "@survev/shared/utils/math.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";
import { expect, test } from "bun:test";
import { PolygonBands } from "../polygonBands.ts";
import { createGame } from "./gameTestHelpers.ts";

/** every vertex, edge midpoints and points just around them, plus a dense grid over the bounds */
function probes(poly: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        for (const d of [0, 1e-9, -1e-9, 0.01, -0.01]) {
            out.push({ x: a.x + d, y: a.y }, { x: a.x, y: a.y + d });
            out.push({ x: (a.x + b.x) / 2 + d, y: (a.y + b.y) / 2 });
        }
        minX = Math.min(minX, a.x);
        minY = Math.min(minY, a.y);
        maxX = Math.max(maxX, a.x);
        maxY = Math.max(maxY, a.y);
    }
    for (let x = minX - 5; x <= maxX + 5; x += 1.37) {
        for (let y = minY - 5; y <= maxY + 5; y += 0.73) out.push({ x, y });
    }
    out.push({ x: 0, y: Number.NaN }, { x: 0, y: Infinity }, { x: 0, y: -Infinity });
    return out;
}

for (const mapName of ["main", "desert", "faction"] as const) {
    test(`PolygonBands matches pointInsidePolygon on ${mapName} shore and river water`, () => {
        const map = createGame(TeamMode.Solo, mapName).map;
        const polys = [map.terrain.shore, ...map.terrain.rivers.map((r) => r.waterPoly)];
        let checked = 0;
        for (const poly of polys) {
            const bands = new PolygonBands(poly);
            for (const p of probes(poly)) {
                const want = math.pointInsidePolygon(p, poly);
                if (bands.contains(p.x, p.y) !== want) {
                    throw new Error(`mismatch at ${p.x}, ${p.y}: expected ${want}`);
                }
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(100_000);
    }, 60_000);
}
