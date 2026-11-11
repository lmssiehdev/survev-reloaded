import { UnlockDefs } from "@survev/shared/defs/gameObjects/unlockDefs.ts";
import { Constants } from "@survev/shared/net/net.ts";
import { loadoutSchema } from "@survev/shared/types/api.ts";
import { type ProfileResponse, type UsernameResponse } from "@survev/shared/types/user.ts";
import { validateUserName } from "@survev/shared/utils/badWords.ts";
import loadout, { ItemStatus, type Loadout } from "@survev/shared/utils/loadout.ts";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia, type HTTPHeaders, status } from "elysia";
import z from "zod";
import { auth } from "../auth/auth.ts";
import { appendCookies, session } from "../auth/session.ts";
import { db } from "../db/index.ts";
import { itemColumns, items, matchData, users } from "../db/schema.ts";
import { query, respond } from "../lib/errors.ts";
import { macros } from "../lib/macros.ts";
import { PassRoutes } from "../pass/routes.ts";
import { getTimeUntilNextUsernameChange, sanitizeSlug, userRateLimit } from "./users.ts";

export const UserRoutes = new Elysia({ prefix: "/api/user" })
    .use(macros)
    .use(session)
    .use(PassRoutes)
    // fresh: these show and check the user row, which the cookie cache can hold for a minute after a change
    .guard({ rateLimit: userRateLimit, auth: "fresh" })
    .post("/profile", async ({ user, request, set }) => {
        const { loadout, slug, name: username, usernameSet, lastUsernameChangeTime, banned } = user;

        if (banned) {
            const ban = await db.query.bans.findFirst({
                where: { kind: "account", target: user.id, revokedAt: { isNull: true } },
                columns: { reason: true },
            });
            await logout(request, set);

            return {
                banned: true,
                reason: ban?.reason ?? "",
            } satisfies ProfileResponse;
        }

        const timeUntilNextChange = getTimeUntilNextUsernameChange(lastUsernameChangeTime);

        const defaultUnlockItems = UnlockDefs["unlock_default"].unlocks;

        const ownedItems = await query(() =>
            db.query.items.findMany({
                where: { userId: user.id, type: { notIn: defaultUnlockItems } },
                columns: itemColumns,
            })
        );
        if (ownedItems.isErr()) return ownedItems.error;

        return {
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
        } satisfies ProfileResponse;
    })
    .post(
        "/username",
        {
            // an invalid body gets { result: "invalid" }, which the client shows, not the usual error body.
            // (a route error hook can't do it: app.ts's error handler runs first)
            body: z.object({
                username: z.string().trim().min(1).max(Constants.PlayerNameMaxLen),
            }).catch({ username: "" }),
        },
        async ({ user, body: { username } }) => {
            if (!username) {
                return status(400, { result: "invalid" } satisfies UsernameResponse);
            }

            const timeUntilNextChange = getTimeUntilNextUsernameChange(user.lastUsernameChangeTime);

            if (timeUntilNextChange > 0) {
                return { result: "change_time_not_expired" } satisfies UsernameResponse;
            }

            const { validName, originalWasInvalid } = validateUserName(username);

            if (originalWasInvalid) {
                return { result: "invalid" } satisfies UsernameResponse;
            }

            const slug = sanitizeSlug(validName);

            const slugTaken = await db.query.users.findFirst({
                where: { slug, id: { ne: user.id } },
                columns: { id: true },
            });

            if (slugTaken) {
                return { result: "taken" } satisfies UsernameResponse;
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
                ? { result: "success" } satisfies UsernameResponse
                : status(500, { result: "failed" } satisfies UsernameResponse);
        },
    )
    .post(
        "/loadout",
        { body: z.object({ loadout: loadoutSchema }) },
        async ({ user, body: { loadout: userLoadout } }) => {
            const saved = await query(async () => {
                const ownedItems = await db.query.items.findMany({
                    where: { userId: user.id },
                    columns: itemColumns,
                });
                const validatedLoadout = loadout.validateWithAvailableItems(userLoadout, ownedItems);
                await db.update(users).set({ loadout: validatedLoadout }).where(eq(users.id, user.id));
                return { loadout: validatedLoadout };
            });

            return respond(saved);
        },
    )
    .post("/delete", async ({ user, request, set }) => {
        await logout(request, set);

        // sessions, accounts, items and pass data cascade with the user row
        const deleted = await query(() =>
            db.transaction(async (tx) => {
                await tx.delete(users).where(eq(users.id, user.id));
                await tx.update(matchData).set({ userId: null }).where(eq(matchData.userId, user.id));
            })
        );

        if (deleted.isErr()) return deleted.error;
        return {};
    })
    .post(
        "/set_item_status",
        {
            body: z.object({
                status: z.enum(ItemStatus),
                itemTypes: z.array(z.string()).max(50),
            }),
        },
        async ({ user, body: { itemTypes, status } }) => {
            const updated = await query(() =>
                db
                    .update(items)
                    .set({ status })
                    .where(and(eq(items.userId, user.id), inArray(items.type, itemTypes)))
            );

            if (updated.isErr()) return updated.error;
            return {};
        },
    )
    .post("/reset_stats", async ({ user }) => {
        const reset = await query(() =>
            db.update(matchData).set({ userId: null }).where(eq(matchData.userId, user.id))
        );

        if (reset.isErr()) return reset.error;
        return {};
    });

/** ends the current session and clears its cookies */
async function logout(request: Request, set: { headers: HTTPHeaders }) {
    const res = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
    appendCookies(set, res.headers);
}
