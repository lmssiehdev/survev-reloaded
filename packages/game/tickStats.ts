export interface TickSummary {
    mean: number;
    p50: number;
    p99: number;
    max: number;
}

const BUCKET_MS = 0.01;
const BUCKETS = 5000; // 0 to 50 ms

/**
 * Fixed histogram of timings: 0.01 ms buckets from 0 to 50 ms plus one overflow bucket.
 * `add` is O(1) and allocation-free so it is safe on the game loop hot path.
 * count, mean and max are exact; percentiles are bucket upper edges and cover every sample since reset.
 * A percentile landing in the overflow bucket reports max.
 */
export class TickStats {
    private readonly buckets = new Uint32Array(BUCKETS + 1);
    private n = 0;
    private sum = 0;
    private maxMs = 0;

    get count(): number {
        return this.n;
    }

    add(ms: number): void {
        const i = Math.floor(ms / BUCKET_MS);
        this.buckets[i >= 0 && i < BUCKETS ? i : i < 0 ? 0 : BUCKETS]++;
        this.n++;
        this.sum += ms;
        if (ms > this.maxMs) this.maxMs = ms;
    }

    private percentile(q: number): number {
        const rank = Math.ceil(q * this.n);
        let seen = 0;
        for (let i = 0; i < BUCKETS; i++) {
            seen += this.buckets[i];
            if (seen >= rank) return Math.round((i + 1) * BUCKET_MS * 100) / 100;
        }
        return this.maxMs;
    }

    summary(): TickSummary {
        if (this.n === 0) return { mean: 0, p50: 0, p99: 0, max: 0 };
        return {
            mean: this.sum / this.n,
            p50: Math.min(this.percentile(0.5), this.maxMs),
            p99: Math.min(this.percentile(0.99), this.maxMs),
            max: this.maxMs,
        };
    }

    reset(): void {
        this.buckets.fill(0);
        this.n = 0;
        this.sum = 0;
        this.maxMs = 0;
    }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** flat log fields (2 decimals) for a stats window: tickCount, tickMeanMs, tickP50Ms, tickP99Ms, tickMaxMs */
export function flatStats(prefix: "tick" | "netSync", s: TickStats) {
    const t = s.summary();
    return {
        [`${prefix}Count`]: s.count,
        [`${prefix}MeanMs`]: r2(t.mean),
        [`${prefix}P50Ms`]: r2(t.p50),
        [`${prefix}P99Ms`]: r2(t.p99),
        [`${prefix}MaxMs`]: r2(t.max),
    } as Record<`${typeof prefix}${"Count" | "MeanMs" | "P50Ms" | "P99Ms" | "MaxMs"}`, number>;
}

/** allows one hit per window; allowed hits return how many were suppressed since the previous allowed one */
export class Throttle {
    private last = -Infinity;
    private suppressed = 0;

    constructor(private readonly windowMs: number) {}

    hit(now: number): number | undefined {
        if (now - this.last < this.windowMs) {
            this.suppressed++;
            return undefined;
        }
        const suppressed = this.suppressed;
        this.suppressed = 0;
        this.last = now;
        return suppressed;
    }
}
