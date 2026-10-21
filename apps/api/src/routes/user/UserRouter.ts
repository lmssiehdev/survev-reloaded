import { validateUserName } from "@survev/config/utils/badWords.ts";
import { UnlockDefs } from "@survev/shared/defs/gameObjects/unlockDefs.ts";
import { Constants } from "@survev/shared/net/net.ts";
import { loadoutSchema } from "@survev/shared/types/api.ts";
import { type ProfileResponse, type UsernameResponse } from "@survev/shared/types/user.ts";
import loadout, { ItemStatus, type Loadout } from "@survev/shared/utils/loadout.ts";
import { and, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import z from "zod";
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
import { itemColumns, items, matchData, users } from "../../db/schema.ts";
import { errorResponse, query, respond } from "../../errors.ts";
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
        } = user;

        if (banned) {
            const ban = await db.query.bans.findFirst({
                where: { kind: "account", target: user.id, revokedAt: { isNull: true } },
                columns: { reason: true },
            });
            await logout(c);

            return c.json<ProfileResponse>({
                banned: true,
                reason: ban?.reason ?? "",
            });
        }

        const timeUntilNextChange = getTimeUntilNextUsernameChange(lastUsernameChangeTime);

        const defaultUnlockItems = UnlockDefs["unlock_default"].unlocks;

        const ownedItems = await query(() =>
            db.query.items.findMany({
                where: { userId: user.id, type: { notIn: defaultUnlockItems } },
                columns: itemColumns,
            })
        );
        if (ownedItems.isErr()) return errorResponse(c, ownedItems.error);

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
                items: ownedItems.value,
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

            const slugTaken = await db.query.users.findFirst({
                where: { slug, id: { ne: user.id } },
                columns: { id: true },
            });

            if (slugTaken) {
                return c.json<UsernameResponse>({ result: "taken" }, 200);
            }

            const updated = await query(
                () =>
                    db
                        .update(users)
                        .set({
                            username: validName,
                            slug: slug,
                            usernameSet: true,
                            lastUsernameChangeTime: new Date(),
                        })
                        .where(eq(users.id, user.id)),
                "/api/username: Error updating username",
            );

            return updated.isOk()
                ? c.json<UsernameResponse>({ result: "success" }, 200)
                : c.json<UsernameResponse>({ result: "failed" }, 500);
        },
    )
    .post("/loadout", validateParams(z.object({ loadout: loadoutSchema })), async (c) => {
        const user = c.get("user");
        const { loadout: userLoadout } = c.req.valid("json");

        const saved = await query(async () => {
            const ownedItems = await db.query.items.findMany({
                where: { userId: user.id },
                columns: itemColumns,
            });
            const validatedLoadout = loadout.validateWithAvailableItems(userLoadout, ownedItems);
            await db.update(users).set({ loadout: validatedLoadout }).where(eq(users.id, user.id));
            return { loadout: validatedLoadout };
        });

        return respond(c, saved);
    })
    .post("/logout", async (c) => {
        await logout(c);
        return c.json({}, 200);
    })
    .post("/delete", async (c) => {
        const user = c.get("user");

        await logout(c);

        // sessions, accounts, items and pass data cascade with the user row
        const deleted = await query(() =>
            db.transaction(async (tx) => {
                await tx.delete(users).where(eq(users.id, user.id));
                await tx.update(matchData).set({ userId: null }).where(eq(matchData.userId, user.id));
            })
        );

        return respond(c, deleted.map(() => ({})));
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

            const updated = await query(() =>
                db
                    .update(items)
                    .set({ status })
                    .where(and(eq(items.userId, user.id), inArray(items.type, itemTypes)))
            );

            return respond(c, updated.map(() => ({})));
        },
    )
    .post("/reset_stats", async (c) => {
        const user = c.get("user");

        const reset = await query(() =>
            db.update(matchData).set({ userId: null }).where(eq(matchData.userId, user.id))
        );

        return respond(c, reset.map(() => ({})));
    });

export type UserRouterApp = typeof UserRouter;

/** ends the current session and clears its cookies */
async function logout(c: Context) {
    const res = await auth.api.signOut({ headers: c.req.raw.headers, returnHeaders: true });
    for (const cookie of res.headers.getSetCookie()) {
        c.header("set-cookie", cookie, { append: true });
    }
}
