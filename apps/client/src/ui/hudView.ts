import type { AmmoDef, BoostDef, HealDef } from "@survev/shared/defs/gameObjects/gearDefs.ts";
import { GEAR_TYPES, SCOPE_LEVELS } from "@survev/shared/defs/gameObjects/gearDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import { createStore } from "solid-js";

export const MAX_KILL_FEED_LINES = 6;
export const PERK_UI_COUNT = 4;

export enum InteractionType {
    None,
    Cancel,
    Loot,
    Revive,
    Object,
}

/** heal, boost and ammo types the HUD inventory counts (some exist only in the store, not on screen) */
export function getUiInventoryItemTypes() {
    return GameObjectDefs.getAllTypes().filter((itemType) => {
        const itemDef = GameObjectDefs.typeToDef(itemType) as AmmoDef | HealDef | BoostDef;
        return !(itemDef as AmmoDef).hideUi
            && (itemDef.type == "heal" || itemDef.type == "boost" || itemDef.type == "ammo");
    });
}

export interface HudWeapon {
    type: string;
    ammo: number;
    equipped: boolean;
    selectable: boolean;
    opacity: number;
    /** 0..1 pop animation when the slot gets equipped */
    width: number;
    /** the slot's equip key, e.g. "1" */
    bindStr: string;
}

export interface HudLoot {
    count: number;
    maximum: number;
    selectable: boolean;
    /** 0..1 pop animation when the count goes up */
    width: number;
}

export interface HudGear {
    item: string;
    selectable: boolean;
    width: number;
}

export interface HudPerk {
    type: string;
    droppable: boolean;
    width: number;
    pulse: boolean;
}

export interface HudKillFeedLine {
    text: string;
    color: string;
    /** in lines: the line's top is offset * line height */
    offset: number;
    opacity: number;
}

export function initialHud() {
    return {
        touch: false,
        /** loadStaticDomImages() ran: the inventory icons get their src */
        staticImages: false,
        rareLootMessage: { lootType: "", opacity: 0 },
        pickupMessage: { message: "", opacity: 0 },
        killMessage: { text: "", count: "", opacity: 0 },
        killFeed: Array.from(
            { length: MAX_KILL_FEED_LINES },
            (): HudKillFeedLine => ({ text: "", color: "#000000", offset: 0, opacity: 0 }),
        ),
        ammo: { current: 0, remaining: 0, displayCurrent: false, displayRemaining: false },
        interaction: { type: InteractionType.None, text: "", key: "", usable: false },
        weapons: Array.from(
            { length: GameConfig.WeaponSlot.Count },
            (): HudWeapon => ({
                type: "",
                ammo: 0,
                equipped: false,
                selectable: false,
                opacity: 0,
                width: 0,
                bindStr: "",
            }),
        ),
        /** by SCOPE_LEVELS index */
        scopes: SCOPE_LEVELS.map(() => ({ visible: false, equipped: false, selectable: false })),
        /** by item type (getUiInventoryItemTypes) */
        loot: Object.fromEntries(
            getUiInventoryItemTypes().map((type): [string, HudLoot] => [
                type,
                { count: 0, maximum: 0, selectable: false, width: 0 },
            ]),
        ),
        /** by GEAR_TYPES index */
        gear: GEAR_TYPES.map((): HudGear => ({ item: "", selectable: false, width: 0 })),
        perks: Array.from({ length: PERK_UI_COUNT }, (): HudPerk => ({
            type: "",
            droppable: false,
            width: 0,
            pulse: false,
        })),
        health: GameConfig.player.health as number,
        boost: 0,
        downed: false,
    };
}

export type HudState = ReturnType<typeof initialHud>;

/**
 * The per-frame in-game HUD (components/Hud.tsx). UiManager2 (ui/ui2.ts) writes it every frame
 * with leaf assignments; equal values don't notify, so only what changed reaches the DOM.
 */
export const [hud, setHud] = createStore(initialHud());
