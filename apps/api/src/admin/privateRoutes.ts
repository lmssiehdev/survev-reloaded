import { zSetClientThemeBody, zSetGameModeBody } from "@survev/contracts";
import { type MapDefKey, MapDefs } from "@survev/shared/defs/mapDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import { zGiveItemParams, zRemoveItemParams } from "@survev/shared/types/moderation.ts";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { MOCK_USER_ID } from "../auth/mockLogin.ts";
import { db } from "../db/index.ts";
import { items, matchData, type MatchDataTable } from "../db/schema.ts";
import { Conflict, errorResponse, InvalidParams, query, queryOne, respond } from "../lib/errors.ts";
import { databaseEnabledMiddleware, validateParams } from "../lib/middleware.ts";
import { cache } from "../stats/cache.ts";
import { settings } from "./settings.ts";

/** /private routes the discord bot and admins call */
export const AdminPrivateRouter = new Hono()
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
