import { describe, expect, test } from "bun:test";
import { Throttle, TickStats } from "../tickStats.ts";

describe("TickStats", () => {
    test("summarises 1..100", () => {
        const stats = new TickStats();
        for (let i = 1; i <= 100; i++) stats.add(i);
        const s = stats.summary();
        expect(stats.count).toBe(100);
        expect(s.mean).toBe(50.5);
        expect([50, 51]).toContain(s.p50);
        expect([99, 100]).toContain(s.p99);
        expect(s.max).toBe(100);
    });

    test("ring buffer keeps last capacity samples for percentiles", () => {
        const stats = new TickStats(4);
        for (const n of [1, 2, 3, 4, 100]) stats.add(n);
        const s = stats.summary();
        expect(s.max).toBe(100);
        expect(s.p50).toBeGreaterThanOrEqual(3);
    });

    test("reset clears everything", () => {
        const stats = new TickStats();
        stats.add(5);
        stats.reset();
        expect(stats.count).toBe(0);
        expect(stats.summary()).toEqual({ mean: 0, p50: 0, p99: 0, max: 0 });
    });
});

describe("Throttle", () => {
    test("allows one hit per window and reports suppressed count", () => {
        const t = new Throttle(10000);
        expect(t.hit(0)).toBe(0);
        expect(t.hit(5)).toBeUndefined();
        expect(t.hit(9)).toBeUndefined();
        expect(t.hit(10001)).toBe(2);
    });
});
