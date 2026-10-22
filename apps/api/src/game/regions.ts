import { sharedEnv } from "@survev/config/env.ts";
import type { FindGamePrivateBody, FindGamePrivateRes, UpdateRegionBody } from "@survev/contracts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { db } from "../db/index.ts";
import { fetchJson } from "../lib/fetchJson.ts";

/**
 * regions are whatever game servers report through /private/update_region (every 5s),
 * one that hasn't reported in 30 seconds is likely down and is left out
 */
const reports = new Map<string, UpdateRegionBody["data"] & { at: number }>();

function liveReport(regionId: string) {
    const report = reports.get(regionId);
    return report && Date.now() - report.at < 30_000 ? report : undefined;
}

export function isRegion(regionId: string) {
    return !!liveReport(regionId);
}

export function regionIds() {
    return [...reports.keys()].filter(isRegion);
}

export function updateRegion(regionId: string, data: UpdateRegionBody["data"]) {
    reports.set(regionId, { ...data, at: Date.now() });
}

export function siteRegions(): SiteInfoRes["regions"] {
    return Object.fromEntries(
        regionIds().map((id) => {
            const { playerCount, l10n, url } = reports.get(id)!;
            const { protocol, host } = new URL(url);
            return [id, { playerCount, l10n, address: host, https: protocol === "https:" }];
        }),
    );
}

/** POST to a region's game server */
export function regionFetch<T>(regionId: string, endPoint: string, body: object, timeoutMs?: number) {
    const url = new URL(endPoint, reports.get(regionId)!.url);
    return fetchJson<T>(`Region ${regionId} ${endPoint}`, url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "survev-api-key": sharedEnv.SURVEV_API_KEY,
        },
        body: JSON.stringify(body),
        timeoutMs,
    });
}

export async function findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
    if (!isRegion(body.region)) return { error: "invalid_region" };
    // can wait for a new game process to start
    const res = await regionFetch<FindGamePrivateRes>(body.region, "api/find_game", body, 20_000);
    return res.unwrapOr({ error: "find_game_failed" as const });
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
