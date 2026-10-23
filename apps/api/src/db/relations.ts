import { defineRelations } from "drizzle-orm";
import * as schema from "./schema.ts";

/**
 * Relations for the relational query API (`db.query.*` with `with` / nested `where`).
 * match_data, player_ips and bans have no foreign keys to users, relations don't need one.
 */
export const relations = defineRelations(schema, (r) => ({
    users: {
        sessions: r.many.sessions({ from: r.users.id, to: r.sessions.userId }),
        accounts: r.many.accounts({ from: r.users.id, to: r.accounts.userId }),
        items: r.many.items({ from: r.users.id, to: r.items.userId }),
        passes: r.many.userPasses({ from: r.users.id, to: r.userPasses.userId }),
        quests: r.many.userQuests({ from: r.users.id, to: r.userQuests.userId }),
        matches: r.many.matchData({ from: r.users.id, to: r.matchData.userId }),
        playerIps: r.many.playerIps({ from: r.users.id, to: r.playerIps.userId }),
        bans: r.many.bans({ from: r.users.id, to: r.bans.target, where: { kind: "account" } }),
    },
    sessions: {
        user: r.one.users({ from: r.sessions.userId, to: r.users.id, optional: false }),
    },
    accounts: {
        user: r.one.users({ from: r.accounts.userId, to: r.users.id, optional: false }),
    },
    items: {
        user: r.one.users({ from: r.items.userId, to: r.users.id, optional: false }),
    },
    userPasses: {
        user: r.one.users({ from: r.userPasses.userId, to: r.users.id, optional: false }),
        // quests belong to the user, not to a specific pass
        quests: r.many.userQuests({ from: r.userPasses.userId, to: r.userQuests.userId }),
    },
    userQuests: {
        user: r.one.users({ from: r.userQuests.userId, to: r.users.id, optional: false }),
    },
    matchData: {
        user: r.one.users({ from: r.matchData.userId, to: r.users.id }),
    },
    playerIps: {
        user: r.one.users({ from: r.playerIps.userId, to: r.users.id }),
    },
}));
