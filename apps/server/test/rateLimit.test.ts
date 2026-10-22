import { sharedEnv } from "@survev/config/env.ts";
import { HTTPRateLimit, WebSocketRateLimit } from "@survev/config/utils/rateLimit.ts";
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";

const enabled = sharedEnv.RATE_LIMITS;
beforeAll(() => {
    sharedEnv.RATE_LIMITS = true;
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterAll(() => {
    sharedEnv.RATE_LIMITS = enabled;
    setSystemTime();
});

const advance = (ms: number) => setSystemTime(new Date(Date.now() + ms));

describe("HTTPRateLimit", () => {
    test("allows `limit` hits per window, then resets", () => {
        const limit = new HTTPRateLimit(2, 1000);
        expect([limit.isRateLimited("a"), limit.isRateLimited("a"), limit.isRateLimited("a")])
            .toEqual([false, false, true]);
        expect(limit.isRateLimited("b")).toBe(false);
        advance(1000);
        expect(limit.isRateLimited("a")).toBe(false);
    });
});

describe("WebSocketRateLimit", () => {
    test("message limit per socket window", () => {
        const limit = new WebSocketRateLimit(2, 1000, 5);
        const socket = {};
        expect([limit.isRateLimited(socket), limit.isRateLimited(socket), limit.isRateLimited(socket)])
            .toEqual([false, false, true]);
        advance(1000);
        expect(limit.isRateLimited(socket)).toBe(false);
    });

    test("connection count follows connects and disconnects, never resets while open", () => {
        const limit = new WebSocketRateLimit(50, 1000, 2);
        limit.ipConnected("ip");
        limit.ipConnected("ip");
        expect(limit.isIpRateLimited("ip")).toBe(true);
        // used to be wiped every hour, letting a third connection in
        advance(60 * 60 * 1000);
        expect(limit.isIpRateLimited("ip")).toBe(true);
        limit.ipDisconnected("ip");
        expect(limit.isIpRateLimited("ip")).toBe(false);
        limit.ipDisconnected("ip");
        limit.ipDisconnected("ip");
        limit.ipConnected("ip");
        limit.ipConnected("ip");
        // extra disconnects can't push the count below zero
        expect(limit.isIpRateLimited("ip")).toBe(true);
    });
});
