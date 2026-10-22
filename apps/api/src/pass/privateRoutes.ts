import { QuestDefs } from "@survev/shared/defs/gameObjects/questDefs.ts";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.ts";
import { userQuests } from "../db/schema.ts";
import { query, respond } from "../lib/errors.ts";
import { validateParams } from "../lib/middleware.ts";
import { incrementPassXp } from "./xp.ts";

/** /private/quest_progress: the game server reports quest progress of logged in players */
export const PassPrivateRouter = new Hono()
    .post(
        "/quest_progress",
        validateParams(
            z.object({
                userId: z.string(),
                progress: z
                    .array(
                        z.object({
                            id: z.string(),
                            delta: z.number().positive(),
                        }),
                    )
                    .refine(
                        (entries) => new Set(entries.map((e) => e.id)).size === entries.length,
                        { message: "duplicate quest ids" },
                    ),
            }),
        ),
        async (c) => {
            const { userId, progress } = c.req.valid("json");

            if (progress.length === 0) {
                return c.json({ success: true }, 200);
            }

            const validEntries = progress
                .map((e) => ({ id: e.id, delta: Math.round(e.delta) }))
                .filter((e) => QuestDefs[e.id] && e.delta > 0);

            if (validEntries.length === 0) {
                return c.json({ success: true }, 200);
            }

            const deltaById = new Map(validEntries.map((e) => [e.id, e.delta]));

            const saved = await query(() =>
                db.transaction(async (tx) => {
                    const quests = await tx.query.userQuests.findMany({
                        where: { userId, questType: { in: validEntries.map((e) => e.id) } },
                    });

                    let xpGain = 0;
                    for (const quest of quests) {
                        const delta = deltaById.get(quest.questType) ?? 0;
                        const def = QuestDefs[quest.questType];
                        if (delta <= 0 || !def) continue;

                        const nextProgress = Math.min(quest.target, quest.progress + delta);
                        const nowComplete = nextProgress >= quest.target;

                        if (!quest.complete && nowComplete) {
                            xpGain += def.xp;
                        }

                        if (nextProgress === quest.progress && quest.complete === nowComplete) {
                            continue;
                        }

                        await tx
                            .update(userQuests)
                            .set({ progress: nextProgress, complete: nowComplete })
                            .where(eq(userQuests.id, quest.id));
                    }

                    if (xpGain > 0) {
                        await incrementPassXp(tx, userId, xpGain);
                    }
                })
            );

            return respond(c, saved.map(() => ({ success: true })));
        },
    );
