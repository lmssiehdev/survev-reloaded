import { math } from "@survev/shared/utils/math.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";

const BAND_SIZE = 8;

/**
 * math.pointInsidePolygon for a polygon that is tested many times (shore, river water).
 *
 * The ray-casting test only flips on edges with min(yi, yj) <= y < max(yi, yj), so the edges are
 * bucketed into horizontal bands and a query only walks the band its y falls in. Each edge is
 * evaluated with exactly the same expression as pointInsidePolygon, and the result is a parity, so
 * skipping edges that can't flip gives the identical answer. Edges are padded one band on each side
 * so rounding in the band lookup can never drop one.
 */
export class PolygonBands {
    private readonly minY: number;
    private readonly bandCount: number;
    /** edges of band b are edges[start[b] * 4 .. start[b + 1] * 4) as xi, yi, xj, yj */
    private readonly start: Int32Array;
    private readonly edges: Float64Array;

    constructor(readonly poly: Vec2[]) {
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of poly) {
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        this.minY = poly.length ? minY : 0;
        this.bandCount = poly.length ? Math.floor((maxY - minY) / BAND_SIZE) + 1 : 0;

        const bandsOf = (i: number, j: number) => {
            const lo = Math.min(poly[i].y, poly[j].y);
            const hi = Math.max(poly[i].y, poly[j].y);
            return [
                Math.max(Math.floor((lo - this.minY) / BAND_SIZE) - 1, 0),
                Math.min(Math.floor((hi - this.minY) / BAND_SIZE) + 1, this.bandCount - 1),
            ];
        };

        const counts = new Int32Array(this.bandCount + 1);
        const count = poly.length;
        for (let i = 0, j = count - 1; i < count; j = i++) {
            const [b0, b1] = bandsOf(i, j);
            for (let b = b0; b <= b1; b++) counts[b + 1]++;
        }
        for (let b = 0; b < this.bandCount; b++) counts[b + 1] += counts[b];
        this.start = counts;

        this.edges = new Float64Array(counts[this.bandCount] * 4);
        const fill = counts.slice(0, this.bandCount);
        for (let i = 0, j = count - 1; i < count; j = i++) {
            const [b0, b1] = bandsOf(i, j);
            for (let b = b0; b <= b1; b++) {
                const o = fill[b]++ * 4;
                this.edges[o] = poly[i].x;
                this.edges[o + 1] = poly[i].y;
                this.edges[o + 2] = poly[j].x;
                this.edges[o + 3] = poly[j].y;
            }
        }
    }

    contains(x: number, y: number): boolean {
        const band = Math.floor((y - this.minY) / BAND_SIZE);
        // outside every edge's y span (or NaN): no edge can flip, same as the full test
        if (!(band >= 0 && band < this.bandCount)) {
            return math.pointInsidePolygon({ x, y }, this.poly);
        }

        const edges = this.edges;
        let inside = false;
        for (let o = this.start[band] * 4, end = this.start[band + 1] * 4; o < end; o += 4) {
            const xi = edges[o];
            const yi = edges[o + 1];
            const xj = edges[o + 2];
            const yj = edges[o + 3];

            const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (intersect) {
                inside = !inside;
            }
        }
        return inside;
    }
}
