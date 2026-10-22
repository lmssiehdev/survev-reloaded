import type { SaveGameBody } from "@survev/contracts";
import { util } from "@survev/shared/utils/util.ts";
import { Result } from "better-result";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/index.ts";
import { type Ban, bans, matchData, playerIps, users } from "../db/schema.ts";
import { env } from "../env.ts";
import { query } from "../lib/errors.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BanInput {
    reason: string;
    bannedBy: string;
    /** null: permanent */
    expiresAt: Date | null;
}

const salt = env.SURVEV_IP_SECRET;
export function hashIp(ip: string) {
    return createHash("sha256")
        .update(salt + ip)
        .digest("hex");
}

/** relational filter for bans in effect right now */
function activeBans(kind: Ban["kind"], targets: string[]) {
    return {
        kind,
        target: { in: targets },
        revokedAt: { isNull: true as const },
        OR: [{ expiresAt: { isNull: true as const } }, { expiresAt: { gt: new Date() } }],
    };
}

/** the ban in effect on a raw IP; a failed lookup lets the player through */
export async function findIpBan(ip: string): Promise<Ban | undefined> {
    const ban = await query(
        () => db.query.bans.findFirst({ where: activeBans("ip", [hashIp(ip)]) }),
        "Failed to check if IP is banned",
    );
    return ban.unwrapOr(undefined);
}

/** what find_game / check_ip tell a banned player */
export function banInfo(ban: Ban) {
    return { reason: ban.reason, expiresAt: ban.expiresAt };
}

/** places a ban on every target, an unrevoked older ban is revoked and kept as history */
async function placeBans(tx: Tx, kind: Ban["kind"], targets: string[], input: BanInput) {
    if (!targets.length) return;
    await revokeBans(tx, kind, targets, input.bannedBy);
    await tx.insert(bans).values(targets.map((target) => ({ kind, target, ...input })));
}

/** revokes the unrevoked bans on the targets (all of that kind when undefined), returns how many */
export async function revokeBans(tx: Tx, kind: Ban["kind"], targets: string[] | undefined, revokedBy: string) {
    const revoked = await tx
        .update(bans)
        .set({ revokedAt: new Date(), revokedBy })
        .where(and(
            eq(bans.kind, kind),
            isNull(bans.revokedAt),
            targets && inArray(bans.target, targets),
        ))
        .returning({ id: bans.id });
    return revoked.length;
}

export function banIps(tx: Tx, ipHashes: string[], input: BanInput) {
    return placeBans(tx, "ip", [...new Set(ipHashes)], input);
}

export async function banAccount(tx: Tx, userId: string, input: Omit<BanInput, "expiresAt">) {
    await tx.update(users).set({ banned: true }).where(eq(users.id, userId));
    // NOTE: some lb queries join with the userTable so we do
    // this so it's easier to filter them
    await tx.update(matchData).set({ userBanned: true }).where(eq(matchData.userId, userId));
    await placeBans(tx, "account", [userId], { ...input, expiresAt: null });
}

export async function unbanAccount(tx: Tx, userId: string, revokedBy: string) {
    await tx.update(users).set({ banned: false }).where(eq(users.id, userId));
    await tx.update(matchData).set({ userBanned: false }).where(eq(matchData.userId, userId));
    await revokeBans(tx, "account", [userId], revokedBy);
}

/** a game can be saved again (lost game files), the key makes that a no-op */
export async function logPlayerIps(rows: SaveGameBody["matchData"]) {
    const result = await query(
        () =>
            db.insert(playerIps).values(rows.map((row) => ({
                gameId: row.gameId,
                playerId: row.playerId,
                userId: row.userId || null,
                username: row.username,
                region: row.region,
                mapId: row.mapId,
                teamMode: row.teamMode,
                ip: row.ip,
                ipHash: hashIp(row.ip),
                findGameIp: row.findGameIp,
                findGameIpHash: hashIp(row.findGameIp),
            }))).onConflictDoNothing(),
        "Failed to log player IPs",
    );
    return Result.isOk(result);
}

export async function cleanupOldPlayerIps() {
    const thirtyDaysAgo = new Date(Date.now() - util.daysToMs(30));
    await query(
        () => db.delete(playerIps).where(lt(playerIps.createdAt, thirtyDaysAgo)),
        "Failed to clean up old player IPs",
    );
}
