import { sql } from "drizzle-orm";

import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import { PassDefs } from "@survev/shared/defs/gameObjects/passDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { passUtil } from "@survev/shared/utils/passUtil.ts";
import type { Tx } from "../../db/index.ts";
import { items, userPasses } from "../../db/schema.ts";

const logger = new ServerLogger("Pass");

/** runs inside a (synchronous) transaction, see db/index.ts */
export function incrementPassXp(transaction: Tx, userId: string, xpGain: number) {
    if (xpGain <= 0) return;

    const passDef = PassDefs[Config.passType];

    const pass = transaction.query.userPasses.findFirst({
        where: { userId, passType: Config.passType },
    }).sync();

    if (!pass) {
        logger.error(`Could not find pass for user ${userId}`);
        return;
    }

    const oldTotalXp = pass.totalXp;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel = passUtil.getPassLevelAndXp(Config.passType, oldTotalXp).level;
    const newLevel = passUtil.getPassLevelAndXp(Config.passType, newTotalXp).level;

    const unlockedRewardItems = passDef.items
        .filter((reward) => reward.level > oldLevel && reward.level <= newLevel)
        .map((reward) => reward.item)
        .filter((item) => GameObjectDefs.typeExists(item));

    let unlockedNewItems = false;

    const now = Date.now();
    if (unlockedRewardItems.length > 0) {
        const insertedRewards = transaction
            .insert(items)
            .values(
                unlockedRewardItems.map((item) => ({
                    userId,
                    type: item,
                    source: Config.passType,
                    timeAcquired: now,
                })),
            )
            .onConflictDoNothing()
            .returning({
                type: items.type,
            })
            .all();

        unlockedNewItems = insertedRewards.length > 0;
    }

    transaction
        .insert(userPasses)
        .values({
            userId,
            passType: Config.passType,
            totalXp: newTotalXp,
            newItems: unlockedNewItems,
        })
        .onConflictDoUpdate({
            target: [userPasses.userId, userPasses.passType],
            set: {
                totalXp: newTotalXp,
                newItems: unlockedNewItems ? true : sql`${userPasses.newItems}`,
            },
        })
        .run();
}
