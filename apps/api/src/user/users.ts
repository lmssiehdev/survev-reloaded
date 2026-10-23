import { UnlockDefs } from "@survev/shared/defs/gameObjects/unlockDefs.ts";
import { checkForBadWords } from "@survev/shared/utils/badWords.ts";
import { util } from "@survev/shared/utils/util.ts";
import { generateRandomString } from "better-auth/crypto";
import slugify from "slugify";
import { db } from "../db/index.ts";
import { items } from "../db/schema.ts";

export function randomId(length: number) {
    return generateRandomString(length, "a-z", "0-9");
}

export function sanitizeSlug(username: string) {
    let slug = slugify(
        username
            .toLowerCase()
            .trim()
            .replace(/[.,?""!@#$%^&*()_=+;:<>/\\|}{[\]`~]/g, "-"),
        {
            trim: true,
            strict: true,
        },
    );

    if (!slug || checkForBadWords(slug)) {
        slug = `player_${randomId(6)}`;
    }

    return slug;
}

/** new accounts get a random "Player xxxxxx" name with a free slug */
export async function generateUsername() {
    while (true) {
        const username = `Player ${randomId(6)}`;
        const slug = sanitizeSlug(username);
        const taken = await db.query.users.findFirst({
            where: { slug },
            columns: { id: true },
        });
        if (!taken) return { username, slug };
    }
}

export async function giveNewAccountItems(userId: string) {
    const unlockType = "unlock_new_account";
    const itemsToUnlock = UnlockDefs[unlockType].unlocks || [];
    if (!itemsToUnlock.length) return;

    await db
        .insert(items)
        .values(
            itemsToUnlock.map((type) => ({
                userId,
                source: unlockType,
                type,
                timeAcquired: Date.now(),
            })),
        )
        .onConflictDoNothing();
}

const usernameCooldown = util.daysToMs(10);

export function getTimeUntilNextUsernameChange(lastChangeTime: Date | null | undefined) {
    if (!(lastChangeTime instanceof Date)) return 0;
    return usernameCooldown - (Date.now() - lastChangeTime.getTime());
}
