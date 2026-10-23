import { type SaveGameBody, zSaveGameMatchData } from "@survev/contracts";
import { getLogger } from "@survev/logger/node.ts";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.ts";
import { matchData, type MatchDataTable } from "../db/schema.ts";
import { query, respond } from "../lib/errors.ts";
import { validateParams } from "../lib/middleware.ts";
import { logPlayerIps } from "../moderation/bans.ts";
import { cache } from "./cache.ts";

const logger = getLogger(["api", "stats"]);

// @survev/contracts can't depend on the drizzle schema, so check here that the game's
// save_game payload still fits the match_data insert type
type AssertAssignable<T extends U, U> = T;
type _SaveGameMatchDataFitsTable = AssertAssignable<
    SaveGameBody["matchData"],
    (MatchDataTable & { ip: string; findGameIp: string })[]
>;

/** /private/save_game: the game server saves finished games */
export const StatsPrivateRouter = new Hono()
    .post(
        "/save_game",
        validateParams(z.object({ matchData: zSaveGameMatchData.min(1) })),
        async (c) => {
            const rows = c.req.valid("json").matchData;

            // safe to send again: rows that already exist are skipped, match data and player ips alike
            const saved = await query(() => db.insert(matchData).values(rows).onConflictDoNothing());
            if (saved.isErr()) return respond(c, saved);

            await logPlayerIps(rows);
            await cache.invalidateLeaderboards(rows);
            logger.info("game.saved", { gameId: rows[0].gameId });
            return c.json({ message: `Saved ${rows.length} rows` }, 200);
        },
    );
