import { TeamMode } from "@survev/shared/gameConfig.ts";
import { ItemStatus, type Loadout, loadout } from "@survev/shared/utils/loadout.ts";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** dates are stored as unix milliseconds */
function timestamp(name: string) {
    return integer(name, { mode: "timestamp_ms" });
}

/** the current time in unix milliseconds, as a column default */
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

//
// AUTH (shape owned by better-auth, see auth/auth.ts)
//
export const users = sqliteTable("users", {
    id: text("id").notNull().primaryKey(),
    // better-auth core fields
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    userCreated: timestamp("user_created").notNull().default(now),
    updatedAt: timestamp("updated_at").notNull().default(now).$onUpdate(() => new Date()),
    // game fields
    slug: text("slug").notNull().unique(),
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    username: text("username").notNull().default(""),
    usernameSet: integer("username_set", { mode: "boolean" }).notNull().default(false),
    lastUsernameChangeTime: timestamp("last_username_change_time"),
    loadout: text("loadout", { mode: "json" })
        .notNull()
        .default(loadout.validate({} as Loadout))
        .$type<Loadout>(),
});

export const sessions = sqliteTable(
    "session",
    {
        id: text("id").primaryKey(),
        token: text("token").notNull().unique(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
        expiresAt: timestamp("expires_at").notNull(),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        createdAt: timestamp("created_at").notNull().default(now),
        updatedAt: timestamp("updated_at").notNull().default(now).$onUpdate(() => new Date()),
    },
    (table) => [index("session_user_id_idx").on(table.userId), index("session_expires_at_idx").on(table.expiresAt)],
);

/** one row per linked login provider (discord / google) */
export const accounts = sqliteTable(
    "account",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id").notNull(),
        providerId: text("provider_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),
        accessTokenExpiresAt: timestamp("access_token_expires_at"),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at").notNull().default(now),
        updatedAt: timestamp("updated_at").notNull().default(now).$onUpdate(() => new Date()),
    },
    (table) => [
        uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
        index("account_user_id_idx").on(table.userId),
    ],
);

export const verifications = sqliteTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().default(now),
    updatedAt: timestamp("updated_at").notNull().default(now).$onUpdate(() => new Date()),
});

export type UsersTableInsert = typeof users.$inferInsert;
export type UsersTableSelect = typeof users.$inferSelect;

export const items = sqliteTable(
    "items",
    {
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: text("type").notNull(),
        timeAcquired: integer("time_acquired").notNull(),
        source: text("source").notNull().default("unlock_new_account"),
        status: integer("status").notNull().default(ItemStatus.New),
    },
    (table) => [uniqueIndex("uq_items_user_type").on(table.userId, table.type)],
);
/** the item fields the client gets */
export const itemColumns = { type: true, timeAcquired: true, source: true, status: true } as const;

export const userPasses = sqliteTable(
    "user_pass",
    {
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        passType: text("pass_type").notNull().default("pass_survivr1"),
        totalXp: integer("total_xp").notNull().default(0),
        unlocks: text("unlocks", { mode: "json" }).notNull().default({}).$type<Record<string, boolean>>(),
        newItems: integer("new_items", { mode: "boolean" }).notNull().default(false),
        createdAt: timestamp("created_at").notNull().default(now),
        updatedAt: timestamp("updated_at").notNull().default(now).$onUpdate(() => new Date()),
    },
    (table) => [uniqueIndex("user_pass_user_type").on(table.userId, table.passType)],
);

export type UserPassTableSelect = typeof userPasses.$inferSelect;

export const userQuests = sqliteTable(
    "user_quest",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        idx: integer("idx").notNull(),
        questType: text("quest_type").notNull(),
        progress: integer("progress").notNull().default(0),
        target: integer("target").notNull(),
        complete: integer("complete", { mode: "boolean" }).notNull().default(false),
        rerolled: integer("rerolled", { mode: "boolean" }).notNull().default(false),
        timeAcquired: integer("time_acquired").notNull(),
        nextRefreshAt: integer("next_refresh_at").notNull(),
    },
    (table) => [uniqueIndex("user_quest_user_idx").on(table.userId, table.idx)],
);

export type UserQuestTableSelect = typeof userQuests.$inferSelect;

export const matchData = sqliteTable(
    "match_data",
    {
        userId: text("user_id").default(""),
        userBanned: integer("user_banned", { mode: "boolean" }).default(false),
        createdAt: timestamp("created_at").notNull().default(now),
        region: text("region").notNull(),
        mapId: integer("map_id").notNull(),
        gameId: text("game_id").notNull(),
        mapSeed: integer("map_seed").notNull(),
        username: text("username").notNull(),
        playerId: integer("player_id").notNull(),
        teamMode: integer("team_mode").$type<TeamMode>().notNull(),
        teamCount: integer("team_count").notNull(),
        teamTotal: integer("team_total").notNull(),
        teamId: integer("team_id").notNull(),
        timeAlive: integer("time_alive").notNull(),
        rank: integer("rank").notNull(),
        died: integer("died", { mode: "boolean" }).notNull(),
        kills: integer("kills").notNull(),
        teamKills: integer("team_kills").notNull().default(0),
        damageDealt: integer("damage_dealt").notNull(),
        damageTaken: integer("damage_taken").notNull(),
        killerId: integer("killer_id").notNull(),
        killedIds: text("killed_ids", { mode: "json" }).$type<number[]>().notNull(),
        role: text("role").notNull().default(""),
    },
    (table) => [
        index("idx_match_data_user_stats").on(
            table.userId,
            table.teamMode,
            table.rank,
            table.kills,
            table.damageDealt,
            table.timeAlive,
        ),
        index("idx_game_id").on(table.gameId),
        index("idx_user_id").on(table.userId),
        index("idx_match_data_team_query").on(
            table.teamMode,
            table.mapId,
            table.createdAt,
            table.gameId,
            table.teamId,
            table.region,
            table.kills,
        ),
        primaryKey({ columns: [table.gameId, table.playerId] }),
    ],
);

export type MatchDataTable = typeof matchData.$inferInsert;

//
// MODERATION
//

/**
 * the IPs a player used in a saved game, same key as their match_data row.
 * self-contained (no FK, own username / user id): moderation evidence survives
 * delete_game, renames and stat resets. raw IPs are kept, mods only ever see the hashes
 */
export const playerIps = sqliteTable(
    "player_ips",
    {
        gameId: text("game_id").notNull(),
        playerId: integer("player_id").notNull(),
        createdAt: timestamp("created_at").notNull().default(now),
        userId: text("user_id"),
        username: text("username").notNull(),
        region: text("region").notNull(),
        mapId: integer("map_id").notNull(),
        teamMode: integer("team_mode").$type<TeamMode>().notNull(),
        ip: text("ip").notNull(),
        ipHash: text("ip_hash").notNull(),
        // also store the IP that was used in api/find_game...
        // since one could exploit that to never get banned
        // by requesting it with a different IP than the in-game one
        findGameIp: text("find_game_ip").notNull(),
        findGameIpHash: text("find_game_ip_hash").notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.gameId, table.playerId] }),
        index("player_ips_username_idx").on(table.username, table.createdAt),
        index("player_ips_user_id_idx").on(table.userId),
        index("player_ips_ip_hash_idx").on(table.ipHash),
        index("player_ips_find_game_ip_hash_idx").on(table.findGameIpHash),
        index("player_ips_created_at_idx").on(table.createdAt),
    ],
);

/**
 * every ban ever placed. a ban is active while it's not revoked and not expired,
 * at most one unrevoked ban per target. users.banned mirrors the active account ban
 * (read on every request through the session)
 */
export const bans = sqliteTable(
    "bans",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        kind: text("kind", { enum: ["ip", "account"] }).notNull(),
        /** ip: the ip hash, account: the user id */
        target: text("target").notNull(),
        reason: text("reason").notNull(),
        bannedBy: text("banned_by").notNull(),
        createdAt: timestamp("created_at").notNull().default(now),
        /** null: permanent */
        expiresAt: timestamp("expires_at"),
        revokedAt: timestamp("revoked_at"),
        revokedBy: text("revoked_by"),
    },
    (table) => [
        uniqueIndex("bans_unrevoked_target_idx")
            .on(table.kind, table.target)
            .where(sql`${table.revokedAt} is null`),
    ],
);

export type Ban = typeof bans.$inferSelect;

//
// SETTINGS
//

/** what admins changed at runtime through /private; overrides the config file defaults (see settings.ts) */
export const serverSettings = sqliteTable("server_settings", {
    key: text("key").primaryKey(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: timestamp("updated_at").notNull().default(now).$onUpdate(() => new Date()),
});
