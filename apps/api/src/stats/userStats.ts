import {
    ALL_MAPS,
    type UserStatsRequest,
    type UserStatsResponse,
    zUserStatsRequest,
} from "@survev/shared/types/stats.ts";
import { and, eq, gte, max, type SQL, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.ts";
import { matchData, users } from "../db/schema.ts";
import { query, respond } from "../lib/errors.ts";
import { validateParams } from "../lib/middleware.ts";

export const UserStatsRouter = new Hono();

/*
 * minimum data required for the ui to show the user doesn't exist
 */
const emptyState = {
    slug: "",
    username: "",
    modes: [],
} as Partial<UserStatsResponse> as UserStatsResponse;

UserStatsRouter.post(
    "/",
    validateParams(zUserStatsRequest),
    async (c) => {
        const { interval, mapIdFilter, slug } = c.req.valid("json");

        const data = await query(async () => {
            const user = await db.query.users.findFirst({ where: { slug }, columns: { id: true } });
            return user ? userStatsSqlQuery(user.id, mapIdFilter, interval) : emptyState;
        });

        return respond(c, data);
    },
);

const intervalFilter: Record<string, SQL<unknown>> = {
    daily: gte(matchData.createdAt, sql`NOW() - INTERVAL '1 day'`),
    weekly: gte(matchData.createdAt, sql`NOW() - INTERVAL '7 days'`),
};

async function userStatsSqlQuery(
    userId: string,
    mapIdFilter: string,
    interval: UserStatsRequest["interval"],
): Promise<UserStatsResponse> {
    const withSelect = db.$with("mode_stats").as(
        db
            .select({
                team_mode: matchData.teamMode,
                games: sql`COUNT(*)`.as("games"),
                wins: sql`SUM(CASE WHEN ${matchData.rank} = 1 THEN 1 ELSE 0 END)`.as(
                    "wins",
                ),
                kills: sum(matchData.kills).as("kills"),
                winPct: sql`ROUND(SUM(CASE WHEN ${matchData.rank} = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)`
                    .as(
                        "winpct",
                    ),
                most_kills: max(matchData.kills).as("most_kills"),
                most_damage: max(matchData.damageDealt).as("most_damage"),
                kpg: sql`ROUND(SUM(${matchData.kills}) * 1.0 / COUNT(*), 1)`.as(
                    "kpg",
                ),
                avg_damage: sql`ROUND(AVG(${matchData.damageDealt}))`.as(
                    "avg_damage",
                ),
                avg_time_alive: sql`ROUND(AVG(${matchData.timeAlive}))`.as(
                    "avg_time_alive",
                ),
            })
            .from(matchData)
            .where(
                and(
                    eq(matchData.userId, userId),
                    mapIdFilter !== ALL_MAPS
                        ? eq(matchData.mapId, parseInt(mapIdFilter))
                        : undefined,
                    interval in intervalFilter ? intervalFilter[interval] : undefined,
                ),
            )
            .groupBy(matchData.teamMode),
    );

    const res = await db
        .with(withSelect)
        .select({
            slug: users.slug,
            username: users.username,
            banned: users.banned,
            player_icon: sql`JSON_EXTRACT_PATH(ANY_VALUE(${users.loadout}), 'player_icon')`,
            games: sql`COALESCE(SUM("mode_stats".games), 0)`,
            wins: sql`COALESCE(SUM("mode_stats".wins), 0)`,
            kills: sql`COALESCE(SUM("mode_stats".kills), 0)`,
            kpg: sql`COALESCE(ROUND(SUM("mode_stats".kills) * 1.0 / NULLIF(SUM("mode_stats".games), 0), 1), 0)`,
            modes: sql`
        COALESCE(JSON_AGG(
            CASE WHEN "mode_stats".team_mode IS NOT NULL THEN
                JSON_BUILD_OBJECT(
                    'wins', "mode_stats".wins,
                    'kills', "mode_stats".kills,
                    'teamMode', "mode_stats".team_mode,
                    'avgDamage', "mode_stats".avg_damage,
                    'avgTimeAlive', "mode_stats".avg_time_alive,
                    'mostDamage', "mode_stats".most_damage,
                    'kpg', "mode_stats".kpg,
                    'winPct', "mode_stats".winPct,
                    'mostKills', "mode_stats".most_kills,
                    'games', "mode_stats".games
                )
            END
        ), '[]')`,
        })
        .from(users)
        .leftJoin(withSelect, eq(sql`1`, 1))
        .where(eq(users.id, userId))
        .groupBy(users.slug, users.username, users.banned)
        .limit(1);

    const userStats = res[0] as UserStatsResponse;

    if (!userStats || !userStats.slug) return emptyState;

    const modes = userStats?.modes;
    const formatedData: UserStatsResponse = {
        ...userStats,
        // sql fuckery, it returns [null] where no result
        modes: modes[0] === null ? [] : modes,
    };
    return formatedData;
}
