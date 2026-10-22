import { ServerLogger } from "@survev/config/utils/logger.ts";
import {
    type SaveGameBody,
    zSaveGameMatchData,
    zSetClientThemeBody,
    zSetGameModeBody,
    zUpdateRegionBody,
} from "@survev/contracts";
import { QuestDefs } from "@survev/shared/defs/gameObjects/questDefs.ts";
import { type MapDefKey, MapDefs } from "@survev/shared/defs/mapDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import { zGiveItemParams, zRemoveItemParams } from "@survev/shared/types/moderation.ts";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { databaseEnabledMiddleware, privateMiddleware, validateParams } from "../../auth/middleware.ts";
import { MOCK_USER_ID } from "../../auth/mockLogin.ts";
import { banInfo, findIpBan, logPlayerIps } from "../../bans.ts";
import { cache } from "../../cache.ts";
import { db } from "../../db/index.ts";
import { items, matchData, type MatchDataTable, userQuests } from "../../db/schema.ts";
import { Conflict, errorResponse, InvalidParams, query, queryOne, respond } from "../../errors.ts";
import { updateRegion } from "../../regions.ts";
import { settings } from "../../settings.ts";
import { isBehindProxy } from "../../utils/proxyCheck.ts";
import { ModerationRouter } from "./ModerationRouter.ts";
import { incrementPassXp } from "./passXp.ts";

const logger = new ServerLogger("Private");

// @survev/contracts can't depend on the drizzle schema, so check here that the game's
// save_game payload still fits the match_data insert type
type AssertAssignable<T extends U, U> = T;
type _SaveGameMatchDataFitsTable = AssertAssignable<
    SaveGameBody["matchData"],
    (MatchDataTable & { ip: string; findGameIp: string })[]
>;

export const PrivateRouter = new Hono()
    .use(privateMiddleware)
    .route("/moderation", ModerationRouter)
    .post("/update_region", validateParams(zUpdateRegionBody), (c) => {
        const { regionId, data } = c.req.valid("json");

        updateRegion(regionId, data.playerCount);
        return c.json({}, 200);
    })
    .post("/set_game_mode", validateParams(zSetGameModeBody), async (c) => {
        const {
            index,
            map_name: mapName,
            team_mode: teamMode,
            enabled,
        } = c.req.valid("json");

        if (!MapDefs[mapName as MapDefKey]) {
            return errorResponse(c, new InvalidParams({ message: "Invalid map name" }));
        }

        const set = await settings.setMode(index, { mapName: mapName as MapDefKey, teamMode, enabled });
        if (set.isErr()) return errorResponse(c, set.error);

        return c.json(
            { message: `Set mode ${index} to ${JSON.stringify(settings.modes[index])}` },
            200,
        );
    })
    .post("/set_client_theme", validateParams(zSetClientThemeBody), async (c) => {
        const { theme } = c.req.valid("json");

        if (!MapDefs[theme as MapDefKey]) {
            return errorResponse(c, new InvalidParams({ message: "Invalid map name" }));
        }

        const set = await settings.setClientTheme(theme as MapDefKey);
        if (set.isErr()) return errorResponse(c, set.error);

        return c.json({ message: `Set client theme to ${theme}` }, 200);
    })
    .post(
        "/toggle_captcha",
        validateParams(
            z.object({
                enabled: z.boolean(),
            }),
        ),
        async (c) => {
            const { enabled } = c.req.valid("json");

            const set = await settings.setCaptchaEnabled(enabled);
            if (set.isErr()) return errorResponse(c, set.error);

            return c.json({ state: enabled, message: `Captcha ${enabled ? "enabled" : "disabled"}` }, 200);
        },
    )
    .post(
        "/save_game",
        databaseEnabledMiddleware,
        validateParams(z.object({ matchData: zSaveGameMatchData.min(1) })),
        async (c) => {
            const rows = c.req.valid("json").matchData;

            // safe to send again: rows that already exist are skipped, match data and player ips alike
            const saved = await query(() => db.insert(matchData).values(rows).onConflictDoNothing());
            if (saved.isErr()) return respond(c, saved);

            await logPlayerIps(rows);
            await cache.invalidateLeaderboards(rows);
            logger.info(`Saved game data for ${rows[0].gameId}`);
            return c.json({ message: `Saved ${rows.length} rows` }, 200);
        },
    )
    .post(
        "/quest_progress",
        databaseEnabledMiddleware,
        validateParams(
            z.object({
                userId: z.string(),
                progress: z
                    .array(
                        z.object({
                            id: z.string(),
                            delta: z.number().positive(),
                        }),
                    )
                    .refine(
                        (entries) => new Set(entries.map((e) => e.id)).size === entries.length,
                        { message: "duplicate quest ids" },
                    ),
            }),
        ),
        async (c) => {
            const { userId, progress } = c.req.valid("json");

            if (progress.length === 0) {
                return c.json({ success: true }, 200);
            }

            const validEntries = progress
                .map((e) => ({ id: e.id, delta: Math.round(e.delta) }))
                .filter((e) => QuestDefs[e.id] && e.delta > 0);

            if (validEntries.length === 0) {
                return c.json({ success: true }, 200);
            }

            const deltaById = new Map(validEntries.map((e) => [e.id, e.delta]));

            const saved = await query(() =>
                db.transaction(async (tx) => {
                    const quests = await tx.query.userQuests.findMany({
                        where: { userId, questType: { in: validEntries.map((e) => e.id) } },
                    });

                    let xpGain = 0;
                    for (const quest of quests) {
                        const delta = deltaById.get(quest.questType) ?? 0;
                        const def = QuestDefs[quest.questType];
                        if (delta <= 0 || !def) continue;

                        const nextProgress = Math.min(quest.target, quest.progress + delta);
                        const nowComplete = nextProgress >= quest.target;

                        if (!quest.complete && nowComplete) {
                            xpGain += def.xp;
                        }

                        if (nextProgress === quest.progress && quest.complete === nowComplete) {
                            continue;
                        }

                        await tx
                            .update(userQuests)
                            .set({ progress: nextProgress, complete: nowComplete })
                            .where(eq(userQuests.id, quest.id));
                    }

                    if (xpGain > 0) {
                        await incrementPassXp(tx, userId, xpGain);
                    }
                })
            );

            return respond(c, saved.map(() => ({ success: true })));
        },
    )
    .post(
        "/give_item",
        databaseEnabledMiddleware,
        validateParams(zGiveItemParams),
        async (c) => {
            const { item, slug, source } = c.req.valid("json");

            if (!GameObjectDefs.typeToDefSafe(item)) {
                return errorResponse(c, new InvalidParams({ message: "Invalid item type" }));
            }

            return respond(
                c,
                await Result.gen(async function*() {
                    const user = yield* Result.await(queryOne(
                        () =>
                            db.query.users.findFirst({
                                where: { slug },
                                columns: { id: true },
                                with: { items: { where: { type: item }, columns: { type: true } } },
                            }),
                        "User not found",
                    ));
                    if (user.items.length) {
                        return Result.err(new Conflict({ message: "User already has item" }));
                    }

                    yield* Result.await(
                        query(() =>
                            db.insert(items).values({ userId: user.id, type: item, source, timeAcquired: Date.now() })
                        ),
                    );
                    return Result.ok({ message: `Item "${item}" given to ${slug}` });
                }),
            );
        },
    )
    .post(
        "/remove_item",
        databaseEnabledMiddleware,
        validateParams(zRemoveItemParams),
        async (c) => {
            const { item, slug } = c.req.valid("json");

            return respond(
                c,
                await Result.gen(async function*() {
                    const user = yield* Result.await(queryOne(
                        () => db.query.users.findFirst({ where: { slug }, columns: { id: true } }),
                        "User not found",
                    ));
                    yield* Result.await(
                        query(() => db.delete(items).where(and(eq(items.userId, user.id), eq(items.type, item)))),
                    );
                    return Result.ok({ message: `Item "${item}" removed from ${slug}` });
                }),
            );
        },
    )
    .post("/clear_cache", async (c) => {
        const removed = await cache.clearCache();
        return c.json({ message: `Successfully cleared leaderboard cache (${removed} keys)` }, 200);
    })
    .post(
        "/check_ip",
        validateParams(
            z.object({
                ip: z.string(),
            }),
        ),
        async (c) => {
            const { ip } = c.req.valid("json");

            const ban = await findIpBan(ip);
            if (ban) {
                return c.json({ banned: true, banData: banInfo(ban), behindProxy: false });
            }

            const behindProxy = await isBehindProxy(ip, false);
            return c.json({ banned: false, banData: undefined, behindProxy });
        },
    )
    .post(
        "/test/insert_game",
        databaseEnabledMiddleware,
        validateParams(
            z.object({
                kills: z.number().default(1),
            }),
        ),
        async (c) => {
            if (process.env.NODE_ENV === "production") {
                return c.json({}, 403);
            }

            const data = c.req.valid("json");
            const row: MatchDataTable = {
                gameId: crypto.randomUUID(),
                userId: MOCK_USER_ID,
                createdAt: new Date(),
                region: "na",
                mapId: 0,
                mapSeed: 9834567801234,
                username: MOCK_USER_ID,
                playerId: 9834,
                teamMode: TeamMode.Solo,
                teamCount: 4,
                teamTotal: 25,
                teamId: 7,
                timeAlive: 842,
                rank: 3,
                died: true,
                damageDealt: 1247,
                damageTaken: 862,
                killerId: 18765,
                killedIds: [
                    12543,
                    13587,
                    14298,
                    15321,
                    16754,
                ],
                ...data,
            };
            await cache.invalidateLeaderboards([row]);
            await db.insert(matchData).values(row);
            return c.json({ success: true }, 200);
        },
    );

export type PrivateRouteApp = typeof PrivateRouter;
