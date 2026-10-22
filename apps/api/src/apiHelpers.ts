import { Config } from "@survev/config/serverConfig.ts";
import type { FindGamePrivateBody } from "@survev/contracts";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { isIP } from "node:net";
import { db } from "./db/index.ts";
import { fetchJson } from "./errors.ts";

export function getHonoIp(c: Context, proxyHeader?: string): string | undefined {
    const ip = proxyHeader
        ? c.req.header(proxyHeader)
        : getConnInfo(c).remote.address;

    if (!ip || isIP(ip) == 0) return undefined;
    if (ip.includes("::ffff:")) return ip.split("::ffff:")[1];
    return ip;
}

/** Ok(false): the token was rejected, Err: turnstile could not be reached */
export async function verifyTurnstile(token: string, ip: string) {
    const res = await fetchJson<{ success?: boolean }>(
        "Turnstile",
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: Config.secrets.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
            timeoutMs: 5000,
        },
    );
    return res.map((outcome) => outcome.success === true);
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
        const rows = await db.query.users.findMany({
            where: { id: { in: userIds } },
            columns: { id: true, loadout: true },
            with: { quests: { columns: { questType: true } } },
        });

        accountData = Object.fromEntries(
            rows.map((u) => [u.id, { loadout: u.loadout, quests: u.quests.map((q) => q.questType) }]),
        );
    }

    return players.map(({ joinToken, userId, ip }) => ({
        joinToken,
        userId,
        ip,
        loadout: userId ? accountData[userId]?.loadout : undefined,
        quests: userId ? (accountData[userId]?.quests ?? []) : [],
    }));
}
