import { defineRelations } from "drizzle-orm";
import * as schema from "./schema.ts";

/**
 * Relations for the relational query API (`db.query.*` with `with` / nested `where`).
 * match_data and ip_logs have no foreign keys on user_id (anonymous players use ""),
 * relations don't need one.
 */
export const relations = defineRelations(schema, (r) => ({
    usersTable: {
        sessions: r.many.sessionTable({ from: r.usersTable.id, to: r.sessionTable.userId }),
        accounts: r.many.accountTable({ from: r.usersTable.id, to: r.accountTable.userId }),
        items: r.many.itemsTable({ from: r.usersTable.id, to: r.itemsTable.userId }),
        passes: r.many.userPassTable({ from: r.usersTable.id, to: r.userPassTable.userId }),
        quests: r.many.userQuestTable({ from: r.usersTable.id, to: r.userQuestTable.userId }),
        matches: r.many.matchDataTable({ from: r.usersTable.id, to: r.matchDataTable.userId }),
        ipLogs: r.many.ipLogsTable({ from: r.usersTable.id, to: r.ipLogsTable.userId }),
    },
    sessionTable: {
        user: r.one.usersTable({ from: r.sessionTable.userId, to: r.usersTable.id, optional: false }),
    },
    accountTable: {
        user: r.one.usersTable({ from: r.accountTable.userId, to: r.usersTable.id, optional: false }),
    },
    itemsTable: {
        user: r.one.usersTable({ from: r.itemsTable.userId, to: r.usersTable.id, optional: false }),
    },
    userPassTable: {
        user: r.one.usersTable({ from: r.userPassTable.userId, to: r.usersTable.id, optional: false }),
        // quests belong to the user, not to a specific pass
        quests: r.many.userQuestTable({ from: r.userPassTable.userId, to: r.userQuestTable.userId }),
    },
    userQuestTable: {
        user: r.one.usersTable({ from: r.userQuestTable.userId, to: r.usersTable.id, optional: false }),
    },
    matchDataTable: {
        user: r.one.usersTable({ from: r.matchDataTable.userId, to: r.usersTable.id }),
    },
    ipLogsTable: {
        user: r.one.usersTable({ from: r.ipLogsTable.userId, to: r.usersTable.id }),
    },
}));
