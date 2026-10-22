import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import type { TeamMode } from "@survev/shared/gameConfig.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";

/** what to play, picked per game by matchmaking */
export interface GameMode {
    /**
     * The ID of the map this mode will be running
     */
    readonly mapName: MapDefKey;
    /**
     * The team mode, "Solo", "Duo" or "Squad" are the only supported values
     */
    readonly teamMode: TeamMode;
}

export interface GameLogger {
    debug(...message: any[]): void;
    info(...message: any[]): void;
    warn(...message: any[]): void;
    error(...message: any[]): void;
}

export interface GameDebugOptions {
    /**
     * If should use the map default spawn mode or a fixed one
     */
    spawnMode: "default" | "fixed";
    /**
     * Fixed spawn mode position, if not set will use the map center
     */
    spawnPos?: Vec2;
    /**
     * If clients that tag themselves as bots can join
     * This is used for the stress test bots so they get no custom loadout
     */
    allowBots: boolean;
    /**
     * If clients can send edit msgs from the client-side debug editor
     */
    allowEditMsg: boolean;
}

/**
 * Overrides default items players spawn with, mostly for development.
 * Account loadouts and mode spawn items (eg from cobalt) can still override this!
 */
export interface DefaultItems {
    weapons?: [
        {
            type: string;
            ammo: number;
        },
    ];
    outfit?: string;
    backpack?: string;
    helmet?: string;
    chest?: string;
    scope?: string;
    perks?: Array<{ type: string; droppable?: boolean }>;
    /**
     * ammo, grenades, healing items and scopes
     */
    inventory?: Record<string, number>;
}

/**
 * Everything the game needs from whoever hosts it,
 * passed in so the game never reads the server config or does I/O itself
 */
export interface GameOptions {
    logger: GameLogger;
    debugLogs: boolean;
    /**
     * Game tick rate.
     * Controls how many physics and logic ticks the game will try to process every second.
     */
    gameTps: number;
    /**
     * "Net Synchronization" tick rate.
     * Controls how frequently the game will try sending updates to clients.
     *
     * Updates done in the game tick will accumulate to be sent on the next net sync tick.
     */
    netSyncTps: number;
    /**
     * Limits how many simultaneous connections an IP can have in a game.
     */
    rateLimitsEnabled: boolean;
    /**
     * If in-game names should be unique.
     */
    uniqueInGameNames: boolean;
    defaultItems: DefaultItems;
    debug: GameDebugOptions;
}
