import { describe, expect, test } from "bun:test";
import { Throttle, TickStats } from "../tickStats.ts";

describe("TickStats", () => {
    test("percentiles are bucket upper edges", () => {
        const stats = new TickStats();
        // mid-bucket values 1.005 .. 9.995, one per 0.01 ms bucket
        for (let i = 100; i < 1000; i++) stats.add((i + 0.5) / 100);
        const s = stats.summary();
        expect(stats.count).toBe(900);
        expect(s.p50).toBe(5.5);
        expect(s.p99).toBe(9.91);
        expect(s.max).toBe(9.995);
        expect(s.mean).toBeCloseTo(5.5, 6);
    });

    test("values above 50 ms report max for p99", () => {
        const stats = new TickStats();
        for (let i = 0; i < 98; i++) stats.add(1.005);
        stats.add(80);
        stats.add(120);
        const s = stats.summary();
        expect(s.p50).toBe(1.01);
        expect(s.p99).toBe(120);
        expect(s.max).toBe(120);
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
