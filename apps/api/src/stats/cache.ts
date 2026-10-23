import { getLogger } from "@survev/logger/node.ts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import type { LeaderboardRequest, LeaderboardResponse } from "@survev/shared/types/stats.ts";
import { Result } from "better-result";
import { RedisClient } from "bun";
import type { MatchDataTable } from "../db/schema.ts";
import { env } from "../env.ts";

/** every key we own lives under this prefix, so clearing never touches other apps on the same redis */
const PREFIX = "survev:";

export const LEADERBOARD_SIZE = 100;

const SIX_MINUTES = 6 * 60;
const ONE_DAY = 24 * 60 * 60;

/** only these leaderboards hold single-game records that a new match can beat */
const RECORD_TYPES = ["most_kills", "most_damage_dealt"] as const;
const INTERVALS = ["daily", "weekly", "alltime"] as const;

export function leaderboardKey({ teamMode, mapId, type, interval }: LeaderboardRequest) {
    const mapName = GameConfig.MapId[mapId].toLowerCase();
    return `leaderboard:${GameConfig.TeamModeToString[teamMode]}:${mapName}:${type}:${interval}`;
}

export function leaderboardTtl(type: LeaderboardRequest["type"]) {
    return (RECORD_TYPES as readonly string[]).includes(type) ? ONE_DAY : SIX_MINUTES;
}

/**
 * `redis` is undefined when caching is disabled; every function then falls through to the loader.
 * A failing redis is logged and treated as a cache miss, never as a request error.
 */
export function createCache(redis: RedisClient | undefined, logger = getLogger(["api", "cache"])) {
    async function run<T>(op: (redis: RedisClient) => Promise<T>): Promise<T | undefined> {
        if (!redis) return undefined;
        const res = await Result.tryPromise(() => op(redis));
        return res
            .tapError((err) => logger.warning("cache.redis_failed", { err }))
            .unwrapOr(undefined);
    }

    async function cached<T>(
        key: string,
        ttlSeconds: number,
        load: () => Promise<T>,
        shouldCache: (data: T) => boolean = () => true,
    ): Promise<T> {
        const hit = await run((r) => r.get(PREFIX + key));
        const parsed = hit ? Result.try((): unknown => JSON.parse(hit)) : undefined;
        if (parsed?.isOk()) {
            logger.debug("cache.hit", { key });
            return parsed.value as T;
        }
        // a corrupt entry is just a miss; the set below overwrites it

        const data = await load();
        if (shouldCache(data)) {
            await run((r) => r.set(PREFIX + key, JSON.stringify(data), "EX", ttlSeconds));
        }
        return data;
    }

    /** drops cached record leaderboards that a newly saved match could now appear on */
    async function invalidateLeaderboards(matchData: MatchDataTable[]) {
        if (!redis || !matchData.length) return;

        const best = {
            most_kills: Math.max(...matchData.map((p) => p.kills)),
            most_damage_dealt: Math.max(...matchData.map((p) => p.damageDealt)),
        };
        const { teamMode, mapId } = matchData[0];

        for (const type of RECORD_TYPES) {
            for (const interval of INTERVALS) {
                const key = leaderboardKey({ type, teamMode, mapId, interval });
                const raw = await run((r) => r.get(PREFIX + key));
                if (!raw) continue;

                // an unreadable board is treated as stale, never as a save_game failure
                const board = Result.try(() => JSON.parse(raw) as LeaderboardResponse[]).unwrapOr([]);
                const lowest = board.at(-1)?.val ?? 0;
                if (board.length >= LEADERBOARD_SIZE && best[type] < lowest) continue;

                logger.info("cache.invalidate", { key });
                await run((r) => r.del(PREFIX + key));
            }
        }
    }

    /** deletes only our own keys; returns how many were removed */
    async function clearCache() {
        let removed = 0;
        let cursor = "0";
        do {
            const page = await run((r) => r.scan(cursor, "MATCH", `${PREFIX}*`, "COUNT", 500));
            if (!page) break;
            const [next, keys] = page;
            if (keys.length) removed += (await run((r) => r.del(...keys))) ?? 0;
            cursor = next;
        } while (cursor !== "0");
        return removed;
    }

    return { cached, invalidateLeaderboards, clearCache };
}

// defaults to $REDIS_URL / $VALKEY_URL or redis://localhost:6379, connects on the first command
export const cache = createCache(env.REDIS_URL ? new RedisClient(env.REDIS_URL) : undefined);
