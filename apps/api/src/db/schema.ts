import { TeamMode } from "@survev/shared/gameConfig.ts";
import { ItemStatus, type Loadout, loadout } from "@survev/shared/utils/loadout.ts";
import {
    bigint,
    boolean,
    index,
    integer,
    json,
    pgTable,
    primaryKey,
    serial,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

//
// AUTH (shape owned by better-auth, see auth/auth.ts)
//
export const users = pgTable("users", {
    id: text("id").notNull().primaryKey(),
    // better-auth core fields
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    userCreated: timestamp("user_created", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    // game fields
    slug: text("slug").notNull().unique(),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason").notNull().default(""),
    bannedBy: text("banned_by").notNull().default(""),
    username: text("username").notNull().default(""),
    usernameSet: boolean("username_set").notNull().default(false),
    lastUsernameChangeTime: timestamp("last_username_change_time"),
    loadout: json("loadout")
        .notNull()
        .default(loadout.validate({} as Loadout))
        .$type<Loadout>(),
});

export const sessions = pgTable(
    "session",
    {
        id: text("id").primaryKey(),
        token: text("token").notNull().unique(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    },
    (table) => [index("session_user_id_idx").on(table.userId), index("session_expires_at_idx").on(table.expiresAt)],
);

/** one row per linked login provider (discord / google) */
export const accounts = pgTable(
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
        accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    },
    (table) => [
        uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
        index("account_user_id_idx").on(table.userId),
    ],
);

export const verifications = pgTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UsersTableInsert = typeof users.$inferInsert;
export type UsersTableSelect = typeof users.$inferSelect;

export const items = pgTable(
    "items",
    {
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: text("type").notNull(),
        timeAcquired: bigint("time_acquired", { mode: "number" }).notNull(),
        source: text("source").notNull().default("unlock_new_account"),
        status: integer("status").notNull().default(ItemStatus.New),
    },
    (table) => [uniqueIndex("uq_items_user_type").on(table.userId, table.type)],
);
/** the item fields the client gets */
export const itemColumns = { type: true, timeAcquired: true, source: true, status: true } as const;

export const userPasses = pgTable(
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
        unlocks: json("unlocks").notNull().default({}).$type<Record<string, boolean>>(),
        newItems: boolean("new_items").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    },
    (table) => [uniqueIndex("user_pass_user_type").on(table.userId, table.passType)],
);

export type UserPassTableSelect = typeof userPasses.$inferSelect;

export const userQuests = pgTable(
    "user_quest",
    {
        id: serial("id").primaryKey(),
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
        complete: boolean("complete").notNull().default(false),
        rerolled: boolean("rerolled").notNull().default(false),
        timeAcquired: bigint("time_acquired", { mode: "number" }).notNull(),
        nextRefreshAt: bigint("next_refresh_at", { mode: "number" }).notNull(),
    },
    (table) => [uniqueIndex("user_quest_user_idx").on(table.userId, table.idx)],
);

export type UserQuestTableSelect = typeof userQuests.$inferSelect;

export const matchData = pgTable(
    "match_data",
    {
        userId: text("user_id").default(""),
        userBanned: boolean("user_banned").default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        region: text("region").notNull(),
        mapId: integer("map_id").notNull(),
        gameId: uuid("game_id").notNull(),
        mapSeed: bigint("map_seed", { mode: "number" }).notNull(),
        username: text("username").notNull(),
        playerId: integer("player_id").notNull(),
        teamMode: integer("team_mode").$type<TeamMode>().notNull(),
        teamCount: integer("team_count").notNull(),
        teamTotal: integer("team_total").notNull(),
        teamId: integer("team_id").notNull(),
        timeAlive: integer("time_alive").notNull(),
        rank: integer("rank").notNull(),
        died: boolean("died").notNull(),
        kills: integer("kills").notNull(),
        teamKills: integer("team_kills").notNull().default(0),
        damageDealt: integer("damage_dealt").notNull(),
        damageTaken: integer("damage_taken").notNull(),
        killerId: integer("killer_id").notNull(),
        killedIds: integer("killed_ids").array().notNull(),
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
// LOGS
//
export const ipLogs = pgTable(
    "ip_logs",
    {
        id: serial().primaryKey(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        region: text("region").notNull(),
        gameId: text("game_id").notNull(),
        mapId: integer("map_id").notNull(),
        username: text("username").notNull(),
        userId: text("user_id").default(""),
        encodedIp: text("encoded_ip").notNull(),
        teamMode: integer("team_mode").$type<TeamMode>().notNull().default(TeamMode.Solo),
        ip: text("ip").notNull(),
        // also store the IP that was used in api/find_game...
        // since one could exploit that to never get banned
        // by requesting it with a different IP than the in-game one
        findGameIp: text("find_game_ip").notNull(),
        findGameEncodedIp: text("find_game_encoded_ip").notNull(),
    },
    (table) => [index("name_created_at_idx").on(table.username, table.createdAt)],
);

export type IpLogsTable = typeof ipLogs.$inferSelect;

export const bannedIps = pgTable("banned_ips", {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresIn: timestamp("expires_in").notNull(),
    encodedIp: text("encoded_ip").notNull().primaryKey(),
    permanent: boolean("permanent").notNull().default(false),
    reason: text("reason").notNull().default(""),
    bannedBy: text("banned_by").notNull().default("admin"),
});
