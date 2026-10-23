import { type MatchDataResponse, zMatchDataRequest } from "@survev/shared/types/stats.ts";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.ts";
import { matchData, users } from "../db/schema.ts";
import { query, respond } from "../lib/errors.ts";
import { validateParams } from "../lib/middleware.ts";

export const matchDataRouter = new Hono();

matchDataRouter.post(
    "/",
    validateParams(zMatchDataRequest),
    async (c) => {
        const { gameId } = c.req.valid("json");

        const result = await query(() =>
            db
                .select({
                    slug: users.slug,
                    username: matchData.username,
                    player_id: matchData.playerId,
                    team_id: matchData.teamId,
                    time_alive: matchData.timeAlive,
                    rank: matchData.rank,
                    died: matchData.died,
                    kills: matchData.kills,
                    damage_dealt: matchData.damageDealt,
                    damage_taken: matchData.damageTaken,
                    killer_id: matchData.killerId,
                    killed_ids: matchData.killedIds,
                    role: matchData.role,
                })
                .from(matchData)
                .leftJoin(users, eq(users.id, matchData.userId))
                .orderBy(asc(matchData.rank))
                .where(eq(matchData.gameId, gameId))
        );

        return respond<MatchDataResponse>(c, result);
    },
);
