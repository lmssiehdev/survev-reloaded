import { MapId, TeamMode } from "@survev/shared/gameConfig.ts";
import type { LeaderboardRequest } from "@survev/shared/types/stats.ts";
import { RedisClient } from "bun";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCache, LEADERBOARD_SIZE, leaderboardKey } from "../src/cache.ts";
import type { MatchDataTable } from "../src/db/schema.ts";

const silentLogger = { debug() {}, info() {}, warn() {} } as any;

const params: LeaderboardRequest = {
    type: "most_kills",
    teamMode: TeamMode.Solo,
    mapId: MapId.Main,
    interval: "daily",
};

function board(vals: number[]) {
    return vals.map((val) => ({ val, region: "na" }));
}

function match(kills: number) {
    return [{ kills, damageDealt: 0, teamMode: TeamMode.Solo, mapId: MapId.Main }] as MatchDataTable[];
}

describe("cache without redis", () => {
    const cache = createCache(undefined, silentLogger);

    test("always calls the loader", async () => {
        const load = mock(async () => [1]);
        expect(await cache.cached("k", 60, load)).toEqual([1]);
        expect(await cache.cached("k", 60, load)).toEqual([1]);
        expect(load).toHaveBeenCalledTimes(2);
    });

    test("invalidate and clear are no-ops", async () => {
        await cache.invalidateLeaderboards(match(5));
        expect(await cache.clearCache()).toBe(0);
    });
});

describe("cache with a dead redis", () => {
    const redis = new RedisClient("redis://127.0.0.1:1", { autoReconnect: false, connectionTimeout: 200 });
    const cache = createCache(redis, silentLogger);

    test("falls back to the loader instead of throwing", async () => {
        expect(await cache.cached("k", 60, async () => "db")).toBe("db");
    });
});

// needs a throwaway redis, e.g. `docker run --rm -p 6390:6379 redis:7` and TEST_REDIS_URL=redis://127.0.0.1:6390
describe.skipIf(!process.env.TEST_REDIS_URL)("cache with redis", () => {
    const redis = new RedisClient(process.env.TEST_REDIS_URL);
    const cache = createCache(redis, silentLogger);
    const key = leaderboardKey(params);

    beforeEach(async () => {
        await cache.clearCache();
    });

    afterAll(() => redis.close());

    test("second call is served from redis", async () => {
        const load = mock(async () => board([3, 2, 1]));
        await cache.cached(key, 60, load);
        expect(await cache.cached(key, 60, load)).toEqual(board([3, 2, 1]));
        expect(load).toHaveBeenCalledTimes(1);
        expect(await redis.ttl(`survev:${key}`)).toBeGreaterThan(0);
    });

    test("shouldCache false skips the write", async () => {
        await cache.cached(key, 60, async () => [], (d) => d.length != 0);
        expect(await redis.get(`survev:${key}`)).toBeNull();
    });

    test("full board survives a match below its lowest score", async () => {
        const full = board(Array.from({ length: LEADERBOARD_SIZE }, (_, i) => 100 - i));
        await cache.cached(key, 60, async () => full);
        await cache.invalidateLeaderboards(match(0));
        expect(await redis.get(`survev:${key}`)).not.toBeNull();
    });

    test("full board is dropped when a match ties or beats its lowest score", async () => {
        const full = board(Array.from({ length: LEADERBOARD_SIZE }, (_, i) => 100 - i));
        await cache.cached(key, 60, async () => full);
        await cache.invalidateLeaderboards(match(1));
        expect(await redis.get(`survev:${key}`)).toBeNull();
    });

    test("board with free slots is dropped by any match", async () => {
        await cache.cached(key, 60, async () => board([50, 40]));
        await cache.invalidateLeaderboards(match(0));
        expect(await redis.get(`survev:${key}`)).toBeNull();
    });

    test("clearCache leaves keys outside the prefix alone", async () => {
        await redis.set("other-app:key", "keep");
        await cache.cached(key, 60, async () => board([1]));
        expect(await cache.clearCache()).toBe(1);
        expect(await redis.get("other-app:key")).toBe("keep");
        await redis.del("other-app:key");
    });
});
