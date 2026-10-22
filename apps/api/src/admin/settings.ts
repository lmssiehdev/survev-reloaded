import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import { Result } from "better-result";
import { db } from "../db/index.ts";
import { serverSettings } from "../db/schema.ts";
import { type DatabaseError, InvalidParams, query } from "../lib/errors.ts";

const logger = new ServerLogger("Settings");

type Mode = (typeof Config)["modes"][number];

interface Values {
    modes: Mode[];
    clientTheme: MapDefKey;
    captchaEnabled: boolean;
}

/**
 * what admins can change at runtime through /private.
 * the config file holds the defaults, changes are stored in the server_settings table
 * (in memory only, until a restart, when the database is disabled)
 */
class Settings {
    #values: Values = {
        modes: [...Config.modes],
        clientTheme: Config.clientTheme,
        captchaEnabled: Config.captchaEnabled,
    };

    get modes(): readonly Mode[] {
        return this.#values.modes;
    }

    get clientTheme() {
        return this.#values.clientTheme;
    }

    get captchaEnabled() {
        return this.#values.captchaEnabled;
    }

    /** applies the stored changes on top of the config defaults, call once at startup */
    async load() {
        if (!Config.database.enabled) return;
        const rows = await query(() => db.select().from(serverSettings), "Failed to load settings");
        for (const { key, value } of rows.unwrapOr([])) {
            if (Object.hasOwn(this.#values, key)) {
                Object.assign(this.#values, { [key]: value });
            } else {
                logger.warn(`Ignoring unknown setting ${key}`);
            }
        }
    }

    async #set<K extends keyof Values>(key: K, value: Values[K]): Promise<Result<void, DatabaseError>> {
        if (Config.database.enabled) {
            const saved = await query(() =>
                db.insert(serverSettings).values({ key, value })
                    .onConflictDoUpdate({ target: serverSettings.key, set: { value } })
            );
            if (saved.isErr()) return Result.err(saved.error);
        }
        this.#values[key] = value;
        return Result.ok(undefined);
    }

    async setMode(index: number, patch: Partial<Mode>): Promise<Result<void, InvalidParams | DatabaseError>> {
        const mode = this.#values.modes[index];
        if (!mode) return Result.err(new InvalidParams({ message: "Invalid mode index" }));
        const modes = this.#values.modes.with(index, {
            mapName: patch.mapName ?? mode.mapName,
            teamMode: patch.teamMode ?? mode.teamMode,
            enabled: patch.enabled ?? mode.enabled,
        });
        return this.#set("modes", modes);
    }

    setClientTheme(theme: MapDefKey) {
        return this.#set("clientTheme", theme);
    }

    setCaptchaEnabled(enabled: boolean) {
        return this.#set("captchaEnabled", enabled);
    }
}

export const settings = new Settings();
