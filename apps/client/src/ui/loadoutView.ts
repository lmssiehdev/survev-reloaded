import { createSignal, createStore } from "solid-js";
import type { LoadoutMenu } from "./loadoutMenu.ts";

export const SORT_TYPES = ["newest", "alpha", "rarity", "subcat"] as const;
export type SortType = (typeof SORT_TYPES)[number];

/** one tab in the customize modal's header */
export interface LoadoutCategoryView {
    loadoutType: string;
    image: string;
    /** the category has new (unacknowledged) items */
    alert: boolean;
}

/** one tile in the item grid */
export interface LoadoutItemView {
    /** position in the category when it was opened (item types can repeat) */
    key: number;
    type: string;
    /** `url(...)` of the item's svg */
    image: string;
    transform: string;
    filter: string;
    /** emotes can be dragged onto the wheel */
    draggable: boolean;
    /** the tile was rendered with a "new item" pulse */
    alert: boolean;
    /** the pulse is still on (selecting the item clears it) */
    alertActive: boolean;
    /** crosshair tiles preview their crosshair as the mouse cursor */
    cursor: string;
}

/** wheel and auto emote slots, indexed by EmoteSlot */
export const EMOTE_SLOT_COUNT = 6;

/**
 * What the customize modal and the "new item" modal show. LoadoutMenu (ui/loadoutMenu.ts) writes
 * it, components/Loadout.tsx reads it.
 */
export const [loadoutView, setLoadoutView] = createStore({
    categories: [] as LoadoutCategoryView[],
    catIdx: 0,
    sort: "newest" as SortType,
    /** the "Category" sort option only applies to emotes */
    subcatSort: true,
    items: [] as LoadoutItemView[],
    /** key of the highlighted grid tile, -1 for none */
    selected: -1,
    itemName: "",
    itemRarity: "",
    itemRarityColor: "",
    itemSource: "",
    itemLore: "",
    /** account request spinner; null until the first request */
    loading: null as boolean | null,
    /** phone portrait layout shortens the grid */
    listHeight: "",
    /** set once the modal has been closed (it closes with cursor: initial) */
    cursorReset: false,
    /** the modal is open: the start menu and its background fade out */
    open: false,
    /** the dark screen behind the "new item" modal */
    screenBlock: false,
    crosshairPanel: false,
    crosshairParent: false,
    emotePanel: false,
    emoteParent: false,
    /** background image of each emote slot, "" before the slot is first filled */
    slotImages: Array.from({ length: EMOTE_SLOT_COUNT }, () => ""),
    /** the slots' drop highlights */
    slotHighlight: false,
    slotHighlightOpacity: Array.from({ length: EMOTE_SLOT_COUNT }, () => 0),
    crosshairHex: "",
    crosshairSize: "0.5",
    crosshairStroke: "0.0",
    crosshairImage: "",
    crosshairCursor: "",
    confirmName: "",
    confirmImage: "",
    confirmTransform: "",
    confirmFilter: "",
});

/** the loadout modal's controller; LoadoutMenu sets it once it exists */
export const [loadoutMenu, setLoadoutMenu] = createSignal<LoadoutMenu>();
