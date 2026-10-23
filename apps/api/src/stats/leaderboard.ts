import { getLogger } from "@survev/logger/node.ts";
import { MapId, TeamMode } from "@survev/shared/gameConfig.ts";
import { type LeaderboardRequest, type LeaderboardResponse, zLeaderboardsRequest } from "@survev/shared/types/stats.ts";
import { and, count, eq, gte, inArray, ne, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.ts";
import { matchData, users } from "../db/schema.ts";
import { query, respond } from "../lib/errors.ts";
import { validateParams } from "../lib/middleware.ts";
import { cache, LEADERBOARD_SIZE, leaderboardKey, leaderboardTtl } from "./cache.ts";

const logger = getLogger(["api", "leaderboard"]);

export const leaderboardRouter = new Hono();

const MinGames = {
    kpg: {
        daily: 15,
        weekly: 50,
        alltime: 100,
    },
} as Record<LeaderboardRequest["type"], Record<LeaderboardRequest["interval"], number>>;

leaderboardRouter.post(
    "/",
    validateParams(zLeaderboardsRequest),
    async (c) => {
        const params = c.req.valid("json");
        const data = await query(() =>
            cache.cached(
                leaderboardKey(params),
                leaderboardTtl(params.type),
                () => queryLeaderboard(params),
                // TODO: decide if we should cache empty results;
                (data) => data.length != 0,
            )
        );

        return respond<LeaderboardResponse[]>(c, data);
    },
);

async function queryLeaderboard(params: LeaderboardRequest) {
    const { type, teamMode, mapId } = params;
    const startTime = performance.now();

    const isFaction = mapId === MapId.Faction || mapId === MapId.FactionPotato;

    const data = type === "most_kills" && teamMode !== TeamMode.Solo && !isFaction
        ? await multiplePlayersQuery(params)
        : await soloLeaderboardQuery(params);
    logQueryPerformance(startTime, params);
    return data;
}

// we don't use the one sent by the client lol.
const MAX_RESULT_COUNT = LEADERBOARD_SIZE;

const typeToQuery: Record<LeaderboardRequest["type"], string> = {
    kills: "SUM(match_data.kills)",
    most_damage_dealt: "MAX(match_data.damage_dealt)",
    kpg: "ROUND(SUM(match_data.kills) * 1.0 / COUNT(*), 1)",
    most_kills: "match_data.kills",
    wins: "COUNT(CASE WHEN match_data.rank = 1 THEN 1 END)",
};

const intervalFilter = {
    daily: gte(matchData.createdAt, sql`NOW() - INTERVAL '1 day'`),
    weekly: gte(matchData.createdAt, sql`NOW() - INTERVAL '7 days'`),
};

async function soloLeaderboardQuery(params: LeaderboardRequest) {
    const { interval, mapId, teamMode, type } = params;
    const minGames = type === "kpg" ? MinGames[type][interval] : 1;

    const usernameQuery = type === "most_kills" ? matchData.username : users.username;

    const result = await db
        .select({
            username: usernameQuery,
            mapId: matchData.mapId,
            region: matchData.region,
            teamMode: matchData.teamMode,
            games: count(sql`DISTINCT(match_data.game_id)`),
            slug: users.slug,
            val: sql.raw(`${typeToQuery[type]} as val`) as SQL<number>,
        })
        .from(matchData)
        .leftJoin(users, eq(users.id, matchData.userId))
        .where(
            and(
                eq(matchData.teamMode, teamMode),
                eq(users.banned, false),
                interval === "alltime" ? undefined : intervalFilter[interval],
                ne(matchData.userId, ""),
                eq(matchData.mapId, mapId),
            ),
        )
        .groupBy(
            matchData.mapId,
            users.slug,
            matchData.region,
            matchData.teamMode,
            usernameQuery,
            sql`${type === "most_kills" ? matchData.kills : ""}`,
            sql`${type === "most_kills" ? matchData.gameId : ""}`,
        )
        .having(gte(count(sql`DISTINCT(match_data.game_id)`), minGames))
        .orderBy(sql`val DESC`)
        .limit(MAX_RESULT_COUNT);

    return result as LeaderboardResponse[];
}

async function multiplePlayersQuery({
    interval,
    mapId,
    teamMode,
}: LeaderboardRequest): Promise<LeaderboardResponse[]> {
    const data = await db
        .select({
            matchedUsers: sql<
                {
                    username: string;
                    userId: string | null;
                }[]
            >`json_agg(
                json_build_object(
                    'username', ${matchData.username},
                    'userId', ${matchData.userId}
                )
            )`,
            region: matchData.region,
            val: sql<number>`SUM(${matchData.kills}) as val`,
        })
        .from(matchData)
        .where(
            and(
                interval === "alltime" ? undefined : intervalFilter[interval],
                eq(matchData.userBanned, false),
                eq(matchData.teamMode, teamMode),
                eq(matchData.mapId, mapId),
            ),
        )
        .groupBy(matchData.gameId, matchData.teamId, matchData.region)
        // make sure at least one member of the duo / squad is logged in
        .having(sql`count(case when user_id!='' then 1 end) >= 1`)
        .orderBy(sql`val DESC`)
        .limit(MAX_RESULT_COUNT);

    // get slugs using userIds
    // @NOTE: previously this was done in SQL using a join
    // but performance degraded significantly with larger table
    // splitting it into two separate queries is much faster

    const userIds: string[] = [];
    for (const row of data) {
        for (const { userId } of row.matchedUsers) {
            if (!userId) continue;
            userIds.push(userId);
        }
    }

    const slugsFromUserIds = await db
        .select({
            slug: users.slug,
            id: users.id,
        })
        .from(users)
        .where(and(inArray(users.id, userIds), eq(users.banned, false)));

    const slugMap = Object.fromEntries(
        slugsFromUserIds.map(({ id, slug }) => [id, slug]),
    );

    return data.map((row) => {
        const usernames = [];
        const slugs = [];
        for (const { userId, username } of row.matchedUsers) {
            usernames.push(username);
            slugs.push(userId ? slugMap[userId] || null : null);
        }

        return {
            region: row.region,
            slugs,
            usernames,
            val: row.val,
        };
    }) satisfies LeaderboardResponse[];
}

function logQueryPerformance(startTime: number, params: LeaderboardRequest) {
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    logger[executionTime > 1000 ? "warning" : "debug"]("leaderboard.query", {
        durationMs: Math.round(executionTime),
        key: leaderboardKey(params),
    });
}
