import { Config } from "@survev/config/serverConfig.ts";
import type { FindGamePrivateBody } from "@survev/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { isIP } from "node:net";
import { db } from "./db/index.ts";
import { userQuestTable, usersTable } from "./db/schema.ts";

export function getHonoIp(c: Context, proxyHeader?: string): string | undefined {
    const ip = proxyHeader
        ? c.req.header(proxyHeader)
        : getConnInfo(c).remote.address;

    if (!ip || isIP(ip) == 0) return undefined;
    if (ip.includes("::ffff:")) return ip.split("::ffff:")[1];
    return ip;
}

export async function verifyTurnsStile(token: string, ip: string): Promise<boolean> {
    const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    const result = await fetch(url, {
        body: JSON.stringify({
            secret: Config.secrets.TURNSTILE_SECRET_KEY,
            response: token,
            remoteip: ip,
        }),
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
    });

    const outcome = await result.json();

    if (!outcome.success) {
        return false;
    }
    return true;
}

export async function getFindGamePlayerData(
    players: Pick<FindGamePrivateBody["playerData"][number], "joinToken" | "userId" | "ip">[],
): Promise<FindGamePrivateBody["playerData"]> {
    const userIds = [
        ...new Set(players.map((p) => p.userId).filter((id) => id !== null)),
    ];

    let accountData: Record<
        string,
        {
            loadout: FindGamePrivateBody["playerData"][0]["loadout"];
            quests: FindGamePrivateBody["playerData"][0]["quests"];
        }
    > = {};

    if (userIds.length) {
        const query = await db
            .select({
                userId: usersTable.id,
                loadout: usersTable.loadout,
                quests: sql<
                    string[]
                >`array_agg(${userQuestTable.questType}) filter (where ${userQuestTable.questType} is not null)`,
            })
            .from(usersTable)
            .leftJoin(userQuestTable, and(eq(userQuestTable.userId, usersTable.id)))
            .where(inArray(usersTable.id, userIds))
            .groupBy(usersTable.id);

        accountData = Object.fromEntries(query.map((r) => [r.userId, r]));
    }

    return players.map(({ joinToken, userId, ip }) => ({
        joinToken,
        userId,
        ip,
        loadout: userId ? accountData[userId]?.loadout : undefined,
        quests: userId ? (accountData[userId]?.quests ?? []) : [],
    }));
}
