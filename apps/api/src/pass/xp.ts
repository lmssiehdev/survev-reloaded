import { sql } from "drizzle-orm";

import { getLogger } from "@survev/logger/node.ts";
import { PassDefs } from "@survev/shared/defs/gameObjects/passDefs.ts";
import { activePassType } from "@survev/shared/defs/gameObjects/passDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { passUtil } from "@survev/shared/utils/passUtil.ts";
import type { db } from "../db/index.ts";
import { items, userPasses } from "../db/schema.ts";

const logger = getLogger(["api", "pass"]);

export async function incrementPassXp(
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    xpGain: number,
) {
    if (xpGain <= 0) return;

    const passDef = PassDefs[activePassType];

    const pass = await transaction.query.userPasses.findFirst({
        where: { userId, passType: activePassType },
    });

    if (!pass) {
        logger.error("pass.not_found", { userId });
        return;
    }

    const oldTotalXp = pass.totalXp;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel = passUtil.getPassLevelAndXp(activePassType, oldTotalXp).level;
    const newLevel = passUtil.getPassLevelAndXp(activePassType, newTotalXp).level;

    const unlockedRewardItems = passDef.items
        .filter((reward) => reward.level > oldLevel && reward.level <= newLevel)
        .map((reward) => reward.item)
        .filter((item) => GameObjectDefs.typeExists(item));

    let unlockedNewItems = false;

    const now = Date.now();
    if (unlockedRewardItems.length > 0) {
        const insertedRewards = await transaction
            .insert(items)
            .values(
                unlockedRewardItems.map((item) => ({
                    userId,
                    type: item,
                    source: activePassType,
                    timeAcquired: now,
                })),
            )
            .onConflictDoNothing()
            .returning({
                type: items.type,
            });

        unlockedNewItems = insertedRewards.length > 0;
    }

    await transaction
        .insert(userPasses)
        .values({
            userId,
            passType: activePassType,
            totalXp: newTotalXp,
            newItems: unlockedNewItems,
        })
        .onConflictDoUpdate({
            target: [userPasses.userId, userPasses.passType],
            set: {
                totalXp: newTotalXp,
                newItems: unlockedNewItems ? true : sql`${userPasses.newItems}`,
            },
        });
}
