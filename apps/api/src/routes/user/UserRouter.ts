import { validateUserName } from "@survev/config/utils/badWords.ts";
import { UnlockDefs } from "@survev/shared/defs/gameObjects/unlockDefs.ts";
import { Constants } from "@survev/shared/net/net.ts";
import { loadoutSchema } from "@survev/shared/types/api.ts";
import { type ProfileResponse, type UsernameResponse } from "@survev/shared/types/user.ts";
import loadout, { ItemStatus, type Loadout } from "@survev/shared/utils/loadout.ts";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import z from "zod";
import { server } from "../../apiServer.ts";
import { auth } from "../../auth/auth.ts";
import {
    databaseEnabledMiddleware,
    rateLimitMiddleware,
    requireAuth,
    sessionMiddleware,
    validateParams,
} from "../../auth/middleware.ts";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getTimeUntilNextUsernameChange, sanitizeSlug } from "../../auth/users.ts";
import { db } from "../../db/index.ts";
import { itemsTable, matchDataTable, usersTable } from "../../db/schema.ts";
import { PassRouter } from "./PassRouter.ts";

export const UserRouter = new Hono<AuthEnv>()
    .use(databaseEnabledMiddleware)
    .use(rateLimitMiddleware(40, 60 * 1000))
    .use(sessionMiddleware)
    .use(requireAuth)
    .route("/", PassRouter)
    .post("/profile", async (c) => {
        const user = c.get("user");

        const {
            loadout,
            slug,
            name: username,
            usernameSet,
            lastUsernameChangeTime,
            banned,
            banReason,
        } = user;

        if (banned) {
            await logout(c);

            return c.json<ProfileResponse>({
                banned: true,
                reason: banReason,
            });
        }

        const timeUntilNextChange = getTimeUntilNextUsernameChange(lastUsernameChangeTime);

        const defaultUnlockItems = UnlockDefs["unlock_default"].unlocks;

        const items = await db
            .select({
                type: itemsTable.type,
                timeAcquired: itemsTable.timeAcquired,
                source: itemsTable.source,
                status: itemsTable.status,
            })
            .from(itemsTable)
            .where(
                and(
                    eq(itemsTable.userId, user.id),
                    notInArray(itemsTable.type, defaultUnlockItems),
                ),
            );

        return c.json<ProfileResponse>(
            {
                success: true,
                profile: {
                    slug,
                    // every account is created through a login provider
                    linked: true,
                    username,
                    usernameSet,
                    usernameChangeTime: timeUntilNextChange,
                },
                loadout: loadout as Loadout,
                items: items,
            },
            200,
        );
    })
    .post(
        "/username",
        validateParams(
            z.object({
                username: z.string().trim().min(1).max(Constants.PlayerNameMaxLen),
            }),
            { result: "invalid" } satisfies UsernameResponse,
        ),
        async (c) => {
            const user = c.get("user");
            const { username } = c.req.valid("json");
            const timeUntilNextChange = getTimeUntilNextUsernameChange(
                user.lastUsernameChangeTime,
            );

            if (timeUntilNextChange > 0) {
                return c.json<UsernameResponse>({ result: "change_time_not_expired" }, 200);
            }

            const { validName, originalWasInvalid } = validateUserName(username);

            if (originalWasInvalid) {
                return c.json<UsernameResponse>({ result: "invalid" }, 200);
            }

            const slug = sanitizeSlug(validName);

            const slugTaken = await db.query.usersTable.findFirst({
                where: and(eq(usersTable.slug, slug), ne(usersTable.id, user.id)),
                columns: {
                    id: true,
                },
            });

            if (slugTaken) {
                return c.json<UsernameResponse>({ result: "taken" }, 200);
            }

            try {
                await db
                    .update(usersTable)
                    .set({
                        username: validName,
                        slug: slug,
                        usernameSet: true,
                        lastUsernameChangeTime: new Date(),
                    })
                    .where(eq(usersTable.id, user.id));
            } catch (err) {
                server.logger.error("/api/username: Error updating username", err);
                return c.json<UsernameResponse>({ result: "failed" }, 500);
            }

            return c.json<UsernameResponse>({ result: "success" }, 200);
        },
    )
    .post("/loadout", validateParams(z.object({ loadout: loadoutSchema })), async (c) => {
        const user = c.get("user");
        const { loadout: userLoadout } = c.req.valid("json");

        const items = await db
            .select({
                type: itemsTable.type,
                timeAcquired: itemsTable.timeAcquired,
                source: itemsTable.source,
                status: itemsTable.status,
            })
            .from(itemsTable)
            .where(eq(itemsTable.userId, user.id));

        const validatedLoadout = loadout.validateWithAvailableItems(userLoadout, items);

        await db
            .update(usersTable)
            .set({ loadout: validatedLoadout })
            .where(eq(usersTable.id, user.id));

        return c.json(
            {
                loadout: validatedLoadout,
            },
            200,
        );
    })
    .post("/logout", async (c) => {
        await logout(c);
        return c.json({}, 200);
    })
    .post("/delete", async (c) => {
        const user = c.get("user");

        await logout(c);

        // sessions, accounts, items and pass data cascade with the user row
        await db.transaction(async (tx) => {
            await tx.delete(usersTable).where(eq(usersTable.id, user.id));
            await tx
                .update(matchDataTable)
                .set({ userId: null })
                .where(eq(matchDataTable.userId, user.id));
        });

        return c.json({}, 200);
    })
    .post(
        "/set_item_status",
        validateParams(z.object({
            status: z.enum(ItemStatus),
            itemTypes: z.array(z.string()).max(50),
        })),
        async (c) => {
            const user = c.get("user");
            const { itemTypes, status } = c.req.valid("json");

            await db
                .update(itemsTable)
                .set({
                    status: status,
                })
                .where(and(eq(itemsTable.userId, user.id), inArray(itemsTable.type, itemTypes)));

            return c.json({}, 200);
        },
    )
    .post("/reset_stats", async (c) => {
        const user = c.get("user");

        await db
            .update(matchDataTable)
            .set({ userId: null })
            .where(eq(matchDataTable.userId, user.id));

        return c.json({}, 200);
    });

export type UserRouterApp = typeof UserRouter;

/** ends the current session and clears its cookies */
async function logout(c: Context) {
    const res = await auth.api.signOut({ headers: c.req.raw.headers, returnHeaders: true });
    for (const cookie of res.headers.getSetCookie()) {
        c.header("set-cookie", cookie, { append: true });
    }
}
