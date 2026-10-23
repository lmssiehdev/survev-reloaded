export interface TickSummary {
    mean: number;
    p50: number;
    p99: number;
    max: number;
}

/**
 * Fixed-size ring buffer of timings. `add` does no allocation so it is safe on the game loop hot path.
 * mean and max cover every sample since the last reset, percentiles cover the last `capacity` samples.
 */
export class TickStats {
    private readonly buf: Float64Array;
    private head = 0;
    private sum = 0;
    private maxMs = 0;
    count = 0;

    constructor(readonly capacity = 2048) {
        this.buf = new Float64Array(capacity);
    }

    add(ms: number): void {
        this.buf[this.head] = ms;
        this.head = (this.head + 1) % this.capacity;
        this.count++;
        this.sum += ms;
        if (ms > this.maxMs) this.maxMs = ms;
    }

    /** sorts a copy, only call occasionally (game end, once a minute) */
    summary(): TickSummary {
        if (this.count === 0) return { mean: 0, p50: 0, p99: 0, max: 0 };
        const n = Math.min(this.count, this.capacity);
        const sorted = this.buf.slice(0, n).sort();
        const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
        return { mean: this.sum / this.count, p50: at(0.5), p99: at(0.99), max: this.maxMs };
    }

    reset(): void {
        this.head = 0;
        this.count = 0;
        this.sum = 0;
        this.maxMs = 0;
    }
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
