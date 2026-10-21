import type { TeamMode } from "@survev/shared/gameConfig.ts";
import { ALL_TEAM_MODES, type MatchHistoryResponse, zMatchHistoryRequest } from "@survev/shared/types/stats.ts";
import { util } from "@survev/shared/utils/util.ts";
import { Hono } from "hono";
import { validateParams } from "../../auth/middleware.ts";
import { db } from "../../db/index.ts";
import { query, respond } from "../../errors.ts";

export const matchHistoryRouter = new Hono();

matchHistoryRouter.post(
    "/",
    validateParams(zMatchHistoryRequest),
    async (c) => {
        const { slug, offset, teamModeFilter } = c.req.valid("json");

        const user = await query(() =>
            db.query.users.findFirst({
                where: { slug },
                columns: {},
                with: {
                    matches: {
                        where: {
                            createdAt: { gt: new Date(Date.now() - util.daysToMs(7)) },
                            ...(teamModeFilter != ALL_TEAM_MODES && { teamMode: teamModeFilter as TeamMode }),
                        },
                        orderBy: { createdAt: "desc" },
                        offset,
                        limit: 10,
                    },
                },
            })
        );

        // unknown slug: {}
        const data = user.map((user) =>
            user?.matches.map((m) => ({
                guid: m.gameId,
                region: m.region,
                map_id: m.mapId,
                team_mode: m.teamMode,
                team_count: m.teamCount,
                team_total: m.teamTotal,
                end_time: m.createdAt,
                time_alive: m.timeAlive,
                rank: m.rank,
                kills: m.kills,
                team_kills: m.teamKills,
                damage_dealt: m.damageDealt,
                damage_taken: m.damageTaken,
            })) ?? {}
        );

        return respond<MatchHistoryResponse | Record<string, never>>(c, data);
    },
);
