import { Config } from "@survev/config/serverConfig.ts";
import { validateUserName } from "@survev/config/utils/badWords.ts";
import type { ModRouterSpectateGameRes, SaveGameBody, SpectateGamePrivateRes } from "@survev/contracts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import {
    zBanAccountParams,
    zBanIpParams,
    zFindDiscordUserSlugParams,
    zGetPlayerIpParams,
    zGiveXpParams,
    zLogoutFromGameParams,
    zResetPassParams,
    zResetStatsParams,
    zSetAccountNameParams,
    zSetMatchDataNameParams,
    zSpectateGameParams,
    zUnbanAccountParams,
    zUnbanIpParams,
} from "@survev/shared/types/moderation.ts";
import { util } from "@survev/shared/utils/util.ts";
import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { createHash } from "node:crypto";
import { z } from "zod";
import { server } from "../../apiServer.ts";
import { databaseEnabledMiddleware, validateParams } from "../../auth/middleware.ts";
import { sanitizeSlug } from "../../auth/users.ts";
import { db, rowCount } from "../../db/index.ts";
import { bannedIps, ipLogs, items, matchData, userPasses, users } from "../../db/schema.ts";
import { incrementPassXp } from "./passXp.ts";

export const ModerationRouter = new Hono()
    .use(databaseEnabledMiddleware)
    .post("/ban_account", validateParams(zBanAccountParams), async (c) => {
        const {
            slug,
            ban_reason: banReason,
            executor_id,
            ban_associated_ips,
            ip_ban_duration,
            ip_ban_permanent,
        } = c.req.valid("json");

        const user = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true, banned: true },
            with: {
                ipLogs: ban_associated_ips && { columns: { encodedIp: true, findGameEncodedIp: true } },
            },
        });

        if (!user) {
            return c.json({ message: "No user found with that slug." }, 200);
        }

        if (user.banned) {
            return c.json({ message: "User is already banned." }, 200);
        }

        await banAccount(user.id, banReason, executor_id);

        if (ban_associated_ips) {
            const ips = user.ipLogs ?? [];

            const expiresIn = new Date(Date.now() + util.daysToMs(ip_ban_duration));

            const bans = [
                ...new Set(
                    ips.map((data) => [data.encodedIp, data.findGameEncodedIp]).flat(),
                ),
            ].map((encodedIp) => {
                return {
                    expiresIn: expiresIn,
                    encodedIp,
                    permanent: ip_ban_permanent,
                    reason: banReason,
                    bannedBy: executor_id,
                };
            });

            if (bans.length) {
                await db
                    .insert(bannedIps)
                    .values(bans)
                    .onConflictDoUpdate({
                        target: bannedIps.encodedIp,
                        set: {
                            expiresIn: expiresIn,
                            reason: banReason,
                            permanent: ip_ban_permanent,
                            bannedBy: executor_id,
                        },
                    });
            }

            for (const ban of bans) {
                server.teamMenu.disconnectPlayers(ban.encodedIp);
            }
        }

        return c.json(
            {
                message: `Banned ${slug} account and all associated IPs for ${ip_ban_duration} days.`,
            },
            200,
        );
    })
    .post("/unban_account", validateParams(zUnbanAccountParams), async (c) => {
        const { slug } = c.req.valid("json");

        const user = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true, banned: true },
        });

        if (!user) {
            return c.json({ message: "No user found with that slug." }, 404);
        }

        if (!user.banned) {
            return c.json({ message: "User is not banned." }, 400);
        }

        await db
            .update(users)
            .set({
                banned: false,
                banReason: "",
                bannedBy: "",
            })
            .where(eq(users.id, user.id));

        await db
            .update(matchData)
            .set({ userBanned: false })
            .where(eq(matchData.userId, user.id));

        return c.json({ message: "User has been unbanned." }, 200);
    })
    .post("/ban_ip", validateParams(zBanIpParams), async (c) => {
        const {
            ips,
            is_encoded,
            permanent,
            ban_associated_account,
            ip_ban_duration,
            ban_reason,
            executor_id,
        } = c.req.valid("json");

        const expiresIn = new Date(Date.now() + util.daysToMs(ip_ban_duration));
        const encodedIps = is_encoded ? ips : ips.map(hashIp);
        const values = encodedIps.map((encodedIp) => ({
            encodedIp,
            expiresIn,
            permanent,
            reason: ban_reason,
            bannedBy: executor_id,
        }));

        await db
            .insert(bannedIps)
            .values(values)
            .onConflictDoUpdate({
                target: bannedIps.encodedIp,
                set: {
                    expiresIn: expiresIn,
                    reason: ban_reason,
                    permanent: permanent,
                },
            });

        if (ban_associated_account) {
            const user = await db.query.ipLogs.findFirst({
                where: { encodedIp: { in: encodedIps }, userId: { ne: "" } },
                columns: { userId: true },
            });
            if (user?.userId) {
                await banAccount(user.userId, ban_reason, executor_id);
            }
        }

        for (const encodedIp of encodedIps) {
            server.teamMenu.disconnectPlayers(encodedIp);
        }

        const baseMessage = permanent
            ? "permanently banned"
            : `banned for ${ip_ban_duration} days`;

        if (encodedIps.length === 1) {
            return c.json(
                { message: `IP ${encodedIps[0]} has been ${baseMessage}.` },
                200,
            );
        }

        return c.json(
            { message: `IPs: [${encodedIps.join(", ")}] ${baseMessage}.` },
            200,
        );
    })
    .post("/unban_ip", validateParams(zUnbanIpParams), async (c) => {
        const { ip, is_encoded } = c.req.valid("json");
        const encodedIp = is_encoded ? ip : hashIp(ip);
        await db
            .delete(bannedIps)
            .where(eq(bannedIps.encodedIp, encodedIp));
        return c.json({ message: `IP ${encodedIp} has been unbanned.` }, 200);
    })
    .post("/get_player_ip", validateParams(zGetPlayerIpParams), async (c) => {
        const { name, use_account_slug, game_id } = c.req.valid("json");

        const logs = await db.query.ipLogs.findMany({
            where: {
                ...(use_account_slug ? { user: { slug: name } } : { username: name }),
                ...(game_id && { gameId: game_id }),
            },
            with: {
                user: {
                    columns: { slug: true },
                    with: { accounts: { where: { providerId: "discord" }, columns: { accountId: true } } },
                },
            },
            orderBy: { createdAt: "desc" },
            limit: 10,
        });

        if (logs.length === 0) {
            return c.json(
                {
                    message: `No IP found for ${name}. Make sure the name matches the one in game.`,
                },
                200,
            );
        }

        return c.json(
            logs.map((log) => {
                const discordId = log.user?.accounts[0]?.accountId ?? null;
                return {
                    slug: log.user?.slug ?? null,
                    authId: discordId,
                    linkedDiscord: !!discordId,
                    ip: log.encodedIp,
                    findGameIp: log.findGameEncodedIp,
                    username: log.username,
                    region: log.region,
                    teamMode: GameConfig.TeamModeToString[log.teamMode],
                    createdAt: log.createdAt,
                    mapId: GameConfig.MapId[log.mapId],
                };
            }),
            200,
        );
    })
    .post("/clear_all_bans", async (c) => {
        await db.delete(bannedIps);
        return c.json({ message: `All bans have been cleared.` }, 200);
    })
    .post(
        // useful for purging bad names from leaderboards
        "/set_match_data_name",
        validateParams(zSetMatchDataNameParams),
        async (c) => {
            const { current_name, new_name } = c.req.valid("json");

            const res = await db
                .update(matchData)
                .set({
                    username: new_name,
                })
                .where(eq(matchData.username, current_name));

            return c.json({ message: `Updated ${rowCount(res)} rows` }, 200);
        },
    )
    .post("/set_account_name", validateParams(zSetAccountNameParams), async (c) => {
        const { new_name, current_slug } = c.req.valid("json");

        const sanitized = validateUserName(new_name);

        if (sanitized.originalWasInvalid) {
            return c.json({ message: "Invalid new username" }, 200);
        }

        const newSlug = sanitizeSlug(sanitized.validName);

        const res = await db
            .update(users)
            .set({
                username: sanitized.validName,
                slug: newSlug,
            })
            .where(eq(users.slug, current_slug));

        if (rowCount(res)) {
            return c.json(
                { message: `updated ${current_slug}'s name to ${sanitized.validName}` },
                200,
            );
        }

        return c.json({ message: `User not found` }, 400);
    })
    .post(
        "/delete_game",
        validateParams(
            z.object({
                gameId: z.string(),
            }),
        ),
        async (c) => {
            const { gameId } = c.req.valid("json");

            const res = await db
                .delete(matchData)
                .where(eq(matchData.gameId, gameId));

            return c.json({ message: `Deleted ${rowCount(res)} rows` }, 200);
        },
    )
    .post(
        "find_discord_user_slug",
        validateParams(zFindDiscordUserSlugParams),
        async (c) => {
            const { discord_user } = c.req.valid("json");

            const account = await db.query.accounts.findFirst({
                where: { providerId: "discord", accountId: discord_user },
                with: { user: { columns: { slug: true } } },
            });
            const user = account?.user;

            if (!user?.slug) {
                return c.json(
                    {
                        message: `User not found`,
                    },
                    200,
                );
            }

            return c.json({ message: `slug: ${user.slug}` }, 200);
        },
    )
    .post("reset_pass", validateParams(zResetPassParams), async (c) => {
        const { slug, pass } = c.req.valid("json");

        const user = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true },
        });

        if (!user) {
            return c.json({ message: "No user found with that slug." }, 404);
        }

        // default to the active pass
        const actualPass = pass || Config.passType;

        await db.transaction(async (t) => {
            await t
                .delete(userPasses)
                .where(
                    and(
                        eq(userPasses.userId, user.id),
                        eq(userPasses.passType, actualPass),
                    ),
                );

            // also remove the pass items from their account
            await t
                .delete(items)
                .where(
                    and(
                        eq(items.userId, user.id),
                        eq(items.source, actualPass),
                    ),
                );
        });

        return c.json({ message: `Successfully reset pass for ${slug}` }, 200);
    })
    .post("give_xp", validateParams(zGiveXpParams), async (c) => {
        const { slug, xp } = c.req.valid("json");

        const user = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true },
        });

        if (!user) {
            return c.json({ message: "No user found with that slug." }, 404);
        }

        await db.transaction(async (tx) => {
            await incrementPassXp(tx, user.id, xp);
        });

        return c.json({ message: `Successfully gave ${xp} xp to ${slug}` }, 200);
    })
    .post("logout_from_game", validateParams(zLogoutFromGameParams), async (c) => {
        const { slug, game_id } = c.req.valid("json");

        const user = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true },
        });

        if (!user) {
            return c.json({ message: "No user found with that slug." }, 404);
        }

        const result = await db
            .update(matchData)
            .set({ userId: null })
            .where(
                and(
                    eq(matchData.userId, user.id),
                    eq(matchData.gameId, game_id),
                ),
            );

        if (!rowCount(result)) {
            return c.json(
                { message: `User ${slug} was not found on game ${game_id}` },
                404,
            );
        }

        return c.json(
            {
                message: `Successfully logged out ${slug} from game ${game_id}.`,
            },
            200,
        );
    })
    .post("reset_stats", validateParams(zResetStatsParams), async (c) => {
        const { slug } = c.req.valid("json");

        const user = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true },
        });

        if (!user) {
            return c.json({ message: "No user found with that slug." }, 404);
        }

        const result = await db
            .update(matchData)
            .set({ userId: null })
            .where(eq(matchData.userId, user.id));

        return c.json(
            {
                message: `Successfully reset stats for ${slug} (${rowCount(result)} games affected).`,
            },
            200,
        );
    })
    .post("spectate_player", validateParams(zSpectateGameParams), async (c) => {
        const { filter } = c.req.valid("json");

        if (filter.type === "user_id") {
            // convert the slug to user id
            const user = await db.query.users.findFirst({
                where: { slug: filter.value },
                columns: { id: true },
            });
            if (!user) {
                return c.json({
                    message: "No user found with that slug.",
                });
            }
            filter.value = user.id;
        }

        return streamText(c, async (stream) => {
            const promises: Promise<unknown>[] = [];

            const count = Object.keys(server.regions).length;
            let requestsDone = 0;
            for (const regionId in server.regions) {
                const region = server.regions[regionId];

                const promise = region.fetch<SpectateGamePrivateRes>("api/spectate_game", {
                    filter: filter,
                });
                promises.push(promise);

                promise.then((res) => {
                    requestsDone++;

                    stream.writeln(JSON.stringify(
                        {
                            region: regionId,
                            done: requestsDone === count,
                            ...(res || { players: [] }),
                        } satisfies ModRouterSpectateGameRes,
                    ));
                }).catch((err) => {
                    console.error(err);
                });
            }

            await Promise.all(promises);
            stream.close();
        });
    });

async function banAccount(userId: string, banReason: string, executorId: string) {
    await db
        .update(users)
        .set({
            banned: true,
            banReason,
            bannedBy: executorId,
        })
        .where(eq(users.id, userId));

    // NOTE: some lb queries join with the userTable so we do
    // this so it's easier to filter them
    await db
        .update(matchData)
        .set({ userBanned: true })
        .where(eq(matchData.userId, userId));
}

export async function cleanupOldLogs() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - util.daysToMs(30));
        await db.delete(ipLogs).where(lt(ipLogs.createdAt, thirtyDaysAgo));
    } catch (err) {
        server.logger.error("Failed to cleanup old logs", err);
    }
}

export async function isBanned(ip: string, isEncoded = false) {
    if (!Config.database.enabled) return undefined;
    try {
        const encodedIp = isEncoded ? ip : hashIp(ip);
        const banned = await db.query.bannedIps.findFirst({
            where: { encodedIp },
            columns: {
                permanent: true,
                expiresIn: true,
                reason: true,
            },
        });
        if (banned) {
            const { expiresIn, permanent, reason } = banned;
            if (permanent || expiresIn.getTime() > Date.now()) {
                server.logger.info(`${encodedIp} is banned.`);
                return {
                    permanent,
                    expiresIn,
                    reason,
                };
            }
            // unban the ip
            await db
                .delete(bannedIps)
                .where(eq(bannedIps.encodedIp, encodedIp));
            return undefined;
        }
        return undefined;
    } catch (err) {
        server.logger.error("Failed to check if IP is banned", err);
        return undefined;
    }
}

export async function logPlayerIPs(data: SaveGameBody["matchData"]) {
    try {
        const logsData = data.map((player) => ({
            ...player,
            encodedIp: hashIp(player.ip),
            findGameEncodedIp: hashIp(player.findGameIp),
        }));
        await db.insert(ipLogs).values(logsData);
    } catch (err) {
        server.logger.error("Failed to log player ip", err);
    }
}

const salt = Config.secrets.SURVEV_IP_SECRET;
export function hashIp(ip: string) {
    return createHash("sha256")
        .update(salt + ip)
        .digest("hex");
}
