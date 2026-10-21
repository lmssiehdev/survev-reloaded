import type { TeamMode } from "@survev/shared/gameConfig.ts";
import { ALL_TEAM_MODES, type MatchHistoryResponse, zMatchHistoryRequest } from "@survev/shared/types/stats.ts";
import { util } from "@survev/shared/utils/util.ts";
import { aliasedTable, and, desc, eq, gt, sum } from "drizzle-orm";
import { Hono } from "hono";
import { databaseEnabledMiddleware, rateLimitMiddleware, validateParams } from "../../auth/middleware.ts";
import { db } from "../../db/index.ts";
import { matchData, users } from "../../db/schema.ts";

export const matchHistoryRouter = new Hono();

const aliased = aliasedTable(matchData, "aliased");

matchHistoryRouter.post(
    "/",
    databaseEnabledMiddleware,
    rateLimitMiddleware(40, 60 * 1000),
    validateParams(zMatchHistoryRequest),
    async (c) => {
        const { slug, offset, teamModeFilter } = c.req.valid("json");

        const result = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true },
        });

        if (result?.id == undefined) {
            return c.json({}, 200);
        }

        const { id: userId } = result;
        const data = await db
            .select({
                guid: matchData.gameId,
                region: matchData.region,
                map_id: matchData.mapId,
                team_mode: matchData.teamMode,
                team_count: matchData.teamCount,
                team_total: matchData.teamTotal,
                end_time: matchData.createdAt,
                time_alive: matchData.timeAlive,
                rank: matchData.rank,
                kills: matchData.kills,
                team_kills: sum(aliased.kills).mapWith(Number),
                damage_dealt: matchData.damageDealt,
                damage_taken: matchData.damageTaken,
                slug: users.slug,
            })
            .from(matchData)
            .groupBy(
                matchData.gameId,
                matchData.region,
                matchData.mapId,
                matchData.teamMode,
                matchData.teamCount,
                matchData.teamTotal,
                matchData.createdAt,
                matchData.timeAlive,
                matchData.rank,
                matchData.kills,
                matchData.damageDealt,
                matchData.damageTaken,
                users.slug,
            )
            .leftJoin(
                aliased,
                and(
                    eq(aliased.gameId, matchData.gameId),
                    eq(aliased.teamId, matchData.teamId),
                ),
            )
            .innerJoin(users, eq(users.id, matchData.userId))
            .where(
                and(
                    eq(users.id, userId),
                    eq(matchData.teamMode, teamModeFilter as TeamMode).if(
                        teamModeFilter != ALL_TEAM_MODES,
                    ),
                    gt(matchData.createdAt, new Date(Date.now() - util.daysToMs(7))),
                ),
            )
            .orderBy(desc(matchData.createdAt))
            .offset(offset)
            .limit(10);

        return c.json<MatchHistoryResponse>(data);
    },
);
