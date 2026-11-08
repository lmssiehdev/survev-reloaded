import "@taufik-nurrohman/color-picker";

import type { GameObjectDef } from "@survev/shared/defs/gameObjectDefs.ts";
import { EmoteCategory, type EmoteDef } from "@survev/shared/defs/gameObjects/emoteDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { EmoteSlot, Rarity } from "@survev/shared/gameConfig.ts";
import type { Item, LoadoutItemDef } from "@survev/shared/utils/loadout.ts";
import { type Loadout, loadout } from "@survev/shared/utils/loadout.ts";
import { util } from "@survev/shared/utils/util.ts";
import { flush, reconcile } from "solid-js";
import type { Account } from "../account.ts";
import { crosshair } from "../crosshair.ts";
import { device } from "../device.ts";
import { helpers } from "../helpers.ts";
import { translate } from "./i18n.ts";
import {
    EMOTE_SLOT_COUNT,
    type LoadoutItemView,
    setLoadoutMenu,
    setLoadoutView,
    SORT_TYPES,
    type SortType,
} from "./loadoutView.ts";
import { MenuModal } from "./menuModal.ts";
import type { LoadoutDisplay } from "./opponentDisplay.ts";

interface SortableItem {
    type: string;
    timeAcquired: number;
}

function itemSort(sortFn: (a: SortableItem, b: SortableItem) => number) {
    return function(a: SortableItem, b: SortableItem) {
        // Always put stock items at the front of the list;
        // if not stock, sort by the given sort routine
        const rarityA = (GameObjectDefs.typeToDef(a.type) as LoadoutItemDef).rarity || Rarity.Stock;
        const rarityB = (GameObjectDefs.typeToDef(b.type) as LoadoutItemDef).rarity || Rarity.Stock;
        if (rarityA == Rarity.Stock && rarityB == Rarity.Stock) {
            return sortAlphabetical(a, b);
        }
        if (rarityA == Rarity.Stock) {
            return -1;
        }
        if (rarityB == Rarity.Stock) {
            return 1;
        }
        return sortFn(a, b);
    };
}

function sortAcquired(a: SortableItem, b: SortableItem) {
    if (b.timeAcquired == a.timeAcquired) {
        return sortSubcat(a, b);
    }
    return b.timeAcquired - a.timeAcquired;
}

function sortAlphabetical(a: SortableItem, b: SortableItem): number {
    const defA = GameObjectDefs.typeToDef(a.type) as LoadoutItemDef;
    const defB = GameObjectDefs.typeToDef(b.type) as LoadoutItemDef;
    if (defA.name! < defB.name!) {
        return -1;
    }
    if (defA.name! > defB.name!) {
        return 1;
    }
    return 0;
}

function sortRarity(a: SortableItem, b: SortableItem) {
    const rarityA = (GameObjectDefs.typeToDef(a.type) as LoadoutItemDef).rarity || Rarity.Stock;
    const rarityB = (GameObjectDefs.typeToDef(b.type) as LoadoutItemDef).rarity || Rarity.Stock;
    if (rarityA == rarityB) {
        return sortAlphabetical(a, b);
    }
    return rarityB - rarityA;
}

function sortSubcat(a: SortableItem, b: SortableItem) {
    const defA = GameObjectDefs.typeToDef(a.type) as EmoteDef;
    const defB = GameObjectDefs.typeToDef(b.type) as EmoteDef;
    if (!defA.category || !defB.category || defA.category == defB.category) {
        return sortAlphabetical(a, b);
    }
    return defA.category - defB.category;
}

const sortTypes: Record<SortType, ReturnType<typeof itemSort>> = {
    newest: itemSort(sortAcquired),
    alpha: itemSort(sortAlphabetical),
    rarity: itemSort(sortRarity),
    subcat: itemSort(sortSubcat),
};

interface ItemInfo {
    type: string;
    loadoutType: string;
    rarity: number;
    displayName: string;
    displaySource: string;
    displayLore: string;
    timeAcquired: number;
    subcat: EmoteCategory;
    /** the tile in the grid */
    view: LoadoutItemView;
}

/** an emote in a wheel / auto slot; empty slots are `{}` */
interface EquippedItem {
    loadoutType?: string;
    type?: string;
    rarity?: number;
    displayName?: string;
    displayLore?: string;
    subcat?: EmoteCategory;
    displaySource?: string;
}

interface SelectedItem {
    /** the emote slot it was picked up from (null: from the grid) */
    prevSlot?: number | null;
    /** `url(...)` of its image */
    img?: string;
    type?: string;
    rarity?: number;
    displayName?: string;
    displaySource?: string;
    loadoutType?: string;
    displayLore?: string;
    subcat?: number;
}

/** a grid tile (by LoadoutItemView.key) or an emote slot */
export type ItemRef = { key: number } | { slot: number };

/** the parts of @taufik-nurrohman/color-picker in use */
interface ColorPicker {
    self: HTMLElement;
    set(color: string): unknown;
    fire(event: string, args: unknown[]): unknown;
    on(event: string, fn: (color: string) => void): unknown;
    enter(): unknown;
    exit(): unknown;
}

/** elements the controller measures or drives directly; components/Loadout.tsx fills it */
export interface LoadoutDom {
    list?: HTMLElement;
    itemName?: HTMLElement;
    picker?: HTMLElement;
    hex?: HTMLInputElement;
    size?: HTMLInputElement;
    stroke?: HTMLInputElement;
}

const RARITY_NAMES = ["stock", "common", "uncommon", "rare", "epic", "mythic"];
const RARITY_COLORS = ["#c5c5c5", "#c5c5c5", "#12ff00", "#00deff", "#f600ff", "#d96100"];

/**
 * The loadout / customize modal's logic. It keeps the working loadout and item state, and writes
 * what the modal shows into the loadoutView store (./loadoutView.ts); components/Loadout.tsx
 * renders it and calls back into the on* handlers here.
 */
export class LoadoutMenu {
    initialized = false;
    active = false;
    items: Item[] = [];

    loadoutDisplay: LoadoutDisplay | null = null;
    loadout = loadout.defaultLoadout();
    localPendingConfirm: Item[] = [];
    localConfirmed: Item[] = [];
    confirmingItems = false;
    localAckItems: Item[] = [];

    categories: Array<{
        loadoutType: Exclude<keyof Loadout, "emotes"> | "emote";
        gameType: GameObjectDef["type"];
        categoryImage: string;
    }> = [
        {
            loadoutType: "outfit",
            gameType: "outfit",
            categoryImage: "img/gui/loadout-outfit.svg",
        },
        {
            loadoutType: "melee",
            gameType: "melee",
            categoryImage: "img/gui/loadout-melee.svg",
        },
        {
            loadoutType: "emote",
            gameType: "emote",
            categoryImage: "img/gui/loadout-emote.svg",
        },
        {
            loadoutType: "heal",
            gameType: "heal_effect",
            categoryImage: "img/gui/loadout-heal.svg",
        },
        {
            loadoutType: "boost",
            gameType: "boost_effect",
            categoryImage: "img/gui/loadout-boost.svg",
        },
    ];

    selectedItem: SelectedItem = {
        prevSlot: null,
        img: "",
        type: "",
    };

    selectedCatIdx = 0;
    selectedCatItems: ItemInfo[] = [];
    /** indexed by EmoteSlot */
    equippedItems: EquippedItem[] = [];
    /** what each emote slot shows, indexed by EmoteSlot; undefined until first filled */
    slotImages: Array<string | undefined> = [];
    sortType: SortType = "newest";
    itemSelected = false;
    highlightOpacityMin = 0.4;

    picker: ColorPicker | null = null;
    readonly dom: LoadoutDom = {};

    modal = new MenuModal();
    confirmItemModal = new MenuModal();

    constructor(public account: Account) {
        if (!device.touch) {
            this.categories.push({
                loadoutType: "crosshair",
                gameType: "crosshair",
                categoryImage: "img/gui/loadout-crosshair.svg",
            });
        }
        this.categories.push({
            loadoutType: "player_icon",
            gameType: "emote",
            categoryImage: "img/gui/loadout-emote.svg",
        });
        setLoadoutView((s) => {
            reconcile(
                this.categories.map((cat) => ({
                    loadoutType: cat.loadoutType,
                    image: cat.categoryImage,
                    alert: false,
                })),
            )(s.categories);
        });

        this.modal.onShow(() => {
            this.onShow();
        });
        this.modal.onHide(() => {
            this.onHide();
        });
        this.confirmItemModal.onShow(() => {
            setLoadoutView((s) => {
                s.screenBlock = true;
            });
        });
        this.confirmItemModal.onHide((e) => {
            const confirmAll = e?.target instanceof HTMLElement && e.target.dataset.confirmAll;
            if (confirmAll) {
                this.confirmAllItems();
                return;
            }
            this.confirmNextItem();
        });
        account.addEventListener("request", this.onRequest.bind(this));
        account.addEventListener("loadout", this.onLoadout.bind(this));
        account.addEventListener("items", this.onItems.bind(this));
        setLoadoutMenu(() => this);
    }

    init() {
        if (this.initialized) return;
        const container = this.dom.picker;
        if (container) {
            const picker: ColorPicker = new window.CP(container, false, container);
            picker.self.classList.add("static");
            picker.on("change", (color: string) => {
                setLoadoutView((s) => {
                    s.crosshairHex = color;
                });
                if (this.loadout?.crosshair) {
                    this.updateLoadoutFromDOM();
                }
            });
            this.picker = picker;
        }
        this.initialized = true;
    }

    show() {
        this.init();
        this.modal.show();
    }

    hide() {
        this.modal.hide();
    }

    onShow() {
        this.active = true;

        // Reset items to ack locally
        this.localAckItems = [];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item.status! < loadout.ItemStatus.Ackd) {
                this.localAckItems.push(item);
            }
        }
        this.selectCat(0);
        this.tryBeginConfirmingItems();
        setLoadoutView((s) => {
            s.open = true;
        });
    }

    onHide() {
        this.active = false;
        if (loadout.modified(this.loadout, this.account.loadout)) {
            this.account.setLoadout(this.loadout);
        }
        this.clearConfirmItemModal();
        setLoadoutView((s) => {
            s.cursorReset = true;
            s.open = false;
        });
    }

    onResize() {
        // Adjust the emote modal content on mobile
        if (device.mobile) {
            const isEmote = this.categories[this.selectedCatIdx].loadoutType == "emote";
            setLoadoutView((s) => {
                s.listHeight = isEmote || device.isLandscape ? "" : "380px";
            });
        }
    }

    onRequest() {
        setLoadoutView((s) => {
            s.loading = this.account.requestsInFlight > 0;
        });
    }

    onLoadout(_loadout: Loadout) {
        this.loadout = loadout.validate(_loadout);
        crosshair.setGameCrosshair(_loadout.crosshair);
        if (this.active) {
            this.selectCat(this.selectedCatIdx);
        }
    }

    onItems(items: Item[]) {
        this.items = loadout.getUserAvailableItems(items) as Item[];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (
                item.status! < loadout.ItemStatus.Confirmed
                && !this.localPendingConfirm.find((x) => {
                    return x.type == item.type;
                })
                && !this.localConfirmed.find((x) => {
                    return x.type == item.type;
                })
            ) {
                this.localPendingConfirm.push(item);
            }
            if (
                item.status! < loadout.ItemStatus.Ackd
                && !this.localAckItems.find((x) => {
                    return x.type == item.type;
                })
            ) {
                this.localAckItems.push(item);
            }
        }
        if (this.active) {
            this.tryBeginConfirmingItems();
            this.selectCat(this.selectedCatIdx);
        }
    }

    getCategory(gameType: string) {
        for (let i = 0; i < this.categories.length; i++) {
            const category = this.categories[i];
            if (category.gameType == gameType) {
                return category;
            }
        }
        return null;
    }

    clearConfirmItemModal() {
        this.localPendingConfirm = [];
        this.localConfirmed = [];
        this.confirmingItems = false;
        this.confirmItemModal.hide();
    }

    setItemsConfirmed() {
        const confirmItemTypes = [];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item.status! < loadout.ItemStatus.Confirmed) {
                confirmItemTypes.push(item.type);
            }
        }
        if (confirmItemTypes.length > 0) {
            this.account.setItemStatus(loadout.ItemStatus.Confirmed, confirmItemTypes);
        }
    }

    setItemsAckd(catIdx: number) {
        const category = this.categories[catIdx];

        // Ack items on the server
        const ackItemTypes = [];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const objDef = GameObjectDefs.typeToDefSafe(item.type);
            if (
                objDef
                && objDef.type == category.gameType
                && item.status! < loadout.ItemStatus.Ackd
            ) {
                ackItemTypes.push(item.type);
            }
        }
        if (ackItemTypes.length > 0) {
            this.account.setItemStatus(loadout.ItemStatus.Ackd, ackItemTypes);
        }
    }

    tryBeginConfirmingItems() {
        if (this.active && !this.confirmingItems) {
            this.confirmingItems = true;
            this.confirmNextItem();
        }
    }

    confirmAllItems() {
        this.clearConfirmItemModal();
        setLoadoutView((s) => {
            s.screenBlock = false;
        });
    }

    confirmNextItem() {
        // Confirm all pending new items in one shot upon displaying
        // the first item
        this.setItemsConfirmed();
        const currentNewItem = this.localPendingConfirm.shift();
        if (currentNewItem) {
            this.localConfirmed.push(currentNewItem);
            const objDef = GameObjectDefs.typeToDef(currentNewItem.type) as LoadoutItemDef;
            const displayName = translate(`game-${currentNewItem.type}`) || objDef.name!;
            const svg = helpers.getSvgFromGameType(currentNewItem.type);
            const transform = helpers.getCssTransformFromGameType(currentNewItem.type);
            const filter = objDef?.type === "outfit" ? helpers.getSvgFilterForTint(objDef.lootImg.tint) : "";
            setTimeout(() => {
                setLoadoutView((s) => {
                    s.confirmName = displayName;
                    s.confirmImage = `url(${svg})`;
                    s.confirmTransform = transform;
                    s.confirmFilter = filter;
                });
                this.confirmItemModal.show();
            }, 200);
        } else {
            this.confirmingItems = false;
            setLoadoutView((s) => {
                s.screenBlock = false;
            });
        }
    }

    /** the sort select changed */
    sortItems(value: string) {
        const sort = SORT_TYPES.find((s) => s === value);
        if (!sort) return;
        this.sortType = sort;
        setLoadoutView((s) => {
            s.sort = sort;
        });
        this.selectedCatItems.sort(sortTypes[sort]);
        this.renderItems();
        if (this.categories[this.selectedCatIdx].loadoutType == "crosshair") {
            this.syncCrosshairInputs();
        }
    }

    /** writes the grid in selectedCatItems order */
    renderItems() {
        setLoadoutView((s) => {
            reconcile(
                this.selectedCatItems.map((info) => ({ ...info.view })),
                "key",
            )(s.items);
        });
    }

    /** the crosshair panel shows the loadout's crosshair */
    syncCrosshairInputs() {
        const crosshairHex = util.intToHex(this.loadout.crosshair.color);
        this.picker?.set(crosshairHex);
        setLoadoutView((s) => {
            s.crosshairHex = crosshairHex.slice(1);
            s.crosshairSize = String(this.loadout.crosshair.size);
            s.crosshairStroke = String(this.loadout.crosshair.stroke);
        });
    }

    onCategoryMouseUp(catIdx: number) {
        if (this.selectedCatIdx != catIdx) {
            this.selectCat(catIdx);
        }
    }

    onListItemMouseUp(key: number) {
        this.selectItem({ key });
        this.updateLoadoutFromDOM();
    }

    onSlotMouseUp(slot: number) {
        if (this.itemSelected) {
            this.deselectItem();
            return;
        }
        this.selectItem({ slot });
        this.updateLoadoutFromDOM();
    }

    /** with an item picked up, pressing on a slot puts it there */
    onSlotMouseDown(slot: number, e: MouseEvent) {
        if (this.itemSelected) {
            e.stopPropagation();
            this.updateSlot(slot, this.selectedItem.img, this.selectedItem.type);
            this.updateLoadoutFromDOM();
        }
    }

    onSlotDrop(slot: number) {
        this.updateSlot(slot, this.selectedItem.img, this.selectedItem.type);
        this.updateLoadoutFromDOM();
        this.deselectItem();
    }

    /** the auto emotes' trash button empties the slot */
    onTrash(slot: number) {
        this.updateSlot(slot, "", "");
        this.updateLoadoutFromDOM();
    }

    onDragStart(ref: ItemRef, e: DragEvent) {
        this.selectItem(ref, false);

        const imgDiv = document.createElement("img");
        imgDiv.src = this.selectedItem.img
            ? this.selectedItem.img
                .replace("url(", "")
                .replace(")", "")
                .replace(/'/gi, "")
            : "";
        e.dataTransfer?.setDragImage(imgDiv, 64, 64);
    }

    setSlotHighlightOpacity(slot: number, opacity: number) {
        setLoadoutView((s) => {
            s.slotHighlightOpacity[slot] = opacity;
        });
    }

    onHexInput(value: string) {
        setLoadoutView((s) => {
            s.crosshairHex = value;
        });
        const picker = this.picker;
        if (!picker || !value.length) return;
        // Only accept 6 digit hex or 7 digit with a hash
        if (value.length == 6) {
            picker.set(`#${value}`);
            picker.fire("change", [value]);
        } else if (value.length == 7 && value[0] == "#") {
            picker.set(value);
            picker.fire("change", [value.slice(1)]);
        }
    }

    onCrosshairSize(value: string) {
        setLoadoutView((s) => {
            s.crosshairSize = value;
        });
        this.updateLoadoutFromDOM();
    }

    onCrosshairStroke(value: string) {
        setLoadoutView((s) => {
            s.crosshairStroke = value;
        });
        this.updateLoadoutFromDOM();
    }

    /** the item name scrolls the grid to the selected tile */
    scrollToSelected() {
        const elements = document.getElementsByClassName("customize-list-item-selected");
        if (elements.length > 0 && window.self === window.top) {
            elements[0].scrollIntoView({
                behavior: "smooth",
                block: "start",
                inline: "nearest",
            });
        }
    }

    updateLoadoutFromDOM() {
        const loadoutType = this.categories[this.selectedCatIdx].loadoutType;
        if (loadoutType == "emote") {
            for (let t = 0; t < EmoteSlot.Count; t++) {
                const slotItem = this.equippedItems[t];
                if (slotItem?.type) {
                    this.loadout.emotes[t] = slotItem.type;
                } else {
                    this.loadout.emotes[t] = "";
                }
            }
        } else if (loadoutType == "crosshair") {
            // the inputs' own (sanitized) values, as the player sees them
            flush();
            const size = parseFloat(this.dom.size?.value ?? "");
            const color = this.dom.hex?.value ?? "";
            const stroke = parseFloat(this.dom.stroke?.value ?? "");
            this.loadout.crosshair = {
                type: this.selectedItem.type ?? "",
                color: util.hexToInt(color),
                size: size.toFixed(2),
                stroke: stroke.toFixed(2),
            };
        } else {
            this.loadout[loadoutType] = this.selectedItem.type ?? "";
        }

        this.loadout = loadout.validate(this.loadout);

        if (this.loadoutDisplay?.initialized) {
            this.loadoutDisplay.setLoadout(this.loadout);
        }
        if (this.selectedItem.loadoutType == "crosshair") {
            this.setSelectedCrosshair();
        }
    }

    selectItem(ref: ItemRef, deselect = true) {
        const listKey = "key" in ref ? ref.key : null;
        const slot = "slot" in ref ? ref.slot : null;
        const listItem = listKey !== null ? this.selectedCatItems.find((x) => x.view.key == listKey) : undefined;
        const selectedItem: ItemInfo | EquippedItem | undefined = slot !== null
            ? this.equippedItems[slot]
            : listItem;

        if (!selectedItem) {
            this.itemSelected = false;
            this.selectedItem = {
                prevSlot: null,
                img: "",
                type: "",
            };
            return;
        }

        // Deselect this emote if it's already selected
        if (
            selectedItem.type == this.selectedItem.type
            && selectedItem.loadoutType == "emote"
            && this.selectedItem.loadoutType == "emote"
            && deselect
        ) {
            this.deselectItem();
            return;
        }

        this.itemSelected = true;

        this.selectedItem = {
            prevSlot: slot,
            img: slot !== null ? this.slotImages[slot] : listItem?.view.image,
            type: selectedItem.type,
            rarity: selectedItem.rarity,
            displayName: selectedItem.displayName || "",
            displaySource: selectedItem.displaySource || "Unknown",
            displayLore: selectedItem.displayLore || "",
            loadoutType: selectedItem.loadoutType,
            subcat: selectedItem.subcat,
        };
        const rawSource = selectedItem.displaySource;
        const source = (rawSource !== undefined
            && (translate(`loadout-${rawSource}`) || translate(rawSource)))
            || this.selectedItem.displaySource;

        // Use the 2nd line on emotes to display the subcategory
        const emoteSubcatNames = {
            [EmoteCategory.Locked]: translate("emote-subcat-locked"),
            [EmoteCategory.Faces]: translate("emote-subcat-faces"),
            [EmoteCategory.Food]: translate("emote-subcat-food"),
            [EmoteCategory.Animals]: translate("emote-subcat-animals"),
            [EmoteCategory.Logos]: translate("emote-subcat-logos"),
            [EmoteCategory.Other]: translate("emote-subcat-other"),
            [EmoteCategory.Flags]: translate("emote-subcat-flags"),
            [EmoteCategory.Default]: translate("emote-subcat-default"),
        };
        const subcat = selectedItem.subcat;
        const localizedLore = selectedItem.loadoutType == "emote"
            ? `${translate("loadout-category")}: ${subcat === undefined ? "undefined" : emoteSubcatNames[subcat]}`
            : this.selectedItem.displayLore;
        const rarity = this.selectedItem.rarity;
        const rarityName = rarity === undefined ? undefined : RARITY_NAMES[rarity];
        const rarityColor = rarity === undefined ? undefined : RARITY_COLORS[rarity];
        const isEmote = this.selectedItem.loadoutType == "emote";
        setLoadoutView((s) => {
            s.itemName = this.selectedItem.displayName ?? "";
            s.itemSource = `${translate("loadout-acquired")}: ${source}`;
            s.itemLore = localizedLore ?? "";
            s.itemRarity = rarityName ? translate(`loadout-${rarityName}`) : "";
            // (an empty slot has no rarity and keeps the previous color)
            if (rarityColor) s.itemRarityColor = rarityColor;
            if (isEmote) {
                s.slotHighlight = true;
                for (let i = 0; i < EMOTE_SLOT_COUNT; i++) s.slotHighlightOpacity[i] = this.highlightOpacityMin;
            }
            // Highlight clicked item
            s.selected = listKey ?? -1;
            if (slot !== null) s.slotHighlightOpacity[slot] = 1;
        });

        if (this.selectedItem.loadoutType == "crosshair") {
            const objDef = GameObjectDefs.typeToDefSafe(this.selectedItem.type ?? "");
            const hasCursor = !!(objDef && objDef.type == "crosshair" && objDef.cursor);
            setLoadoutView((s) => {
                s.crosshairPanel = !hasCursor;
            });
            if (!hasCursor) {
                // the picker measures itself when it enters: it has to be on screen
                flush();
                this.picker?.exit();
                this.picker?.enter();
            }
        }

        // Mark item as ackd
        const itemIdx = this.localAckItems.findIndex((x) => {
            return x.type == this.selectedItem.type;
        });
        if (itemIdx !== -1) {
            if (listItem && slot === null) {
                listItem.view.alertActive = false;
                setLoadoutView((s) => {
                    const view = s.items.find((x) => x.key == listItem.view.key);
                    if (view) view.alertActive = false;
                });
            }
            this.localAckItems.splice(itemIdx, 1);
            this.setCategoryAlerts();
        }
    }

    updateSlot(slot: number, img: string | undefined, type: string | undefined) {
        const prevSlot = this.selectedItem.prevSlot;
        this.selectedItem = {};
        if (prevSlot !== null && prevSlot !== undefined) {
            const slotItem = this.equippedItems[slot];
            let slotItemType = "";
            if (slotItem?.type) {
                slotItemType = slotItem.type;
            }
            this.updateSlot(prevSlot, this.slotImages[slot], slotItemType);
        }
        this.updateSlotData(slot, img, type);
    }

    deselectItem() {
        this.itemSelected = false;
        this.selectedItem = {};
        setLoadoutView((s) => {
            s.selected = -1;
            s.slotHighlight = false;
            for (let i = 0; i < EMOTE_SLOT_COUNT; i++) s.slotHighlightOpacity[i] = 0;
            s.itemName = "";
            s.itemSource = "";
            s.itemLore = "";
            s.itemRarity = "";
        });
    }

    updateSlotData(slot: number, img: string | undefined, type: string | undefined) {
        const image = img || "none";
        this.slotImages[slot] = image;
        setLoadoutView((s) => {
            s.slotImages[slot] = image;
        });
        const emoteDef = type ? GameObjectDefs.typeToDefSafe(type) : undefined;
        if (emoteDef && type) {
            const def = emoteDef as LoadoutItemDef;
            this.equippedItems[slot] = {
                loadoutType: "emote",
                type,
                rarity: def.rarity || Rarity.Stock,
                displayName: translate(`game-${type}`) || def.name!,
                displayLore: translate(`game-${type}-lore`) || def.lore,
                subcat: (def as EmoteDef).category,
            };
        } else {
            this.equippedItems[slot] = {};
        }
    }

    selectCat(catIdx: number) {
        const r = this.selectedCatIdx;
        this.selectedCatIdx = catIdx;
        this.setItemsAckd(this.selectedCatIdx);
        if (r != this.selectedCatIdx) {
            const category = this.categories[r];
            for (let i = this.localAckItems.length - 1; i >= 0; i--) {
                const s = this.localAckItems[i];
                const n = GameObjectDefs.typeToDef(s.type);
                if (n.type == category.gameType) {
                    this.localAckItems.splice(i, 1);
                }
            }
        }
        const category = this.categories[this.selectedCatIdx];

        const loadoutItems = this.items.filter((x) => {
            const gameTypeDef = GameObjectDefs.typeToDefSafe(x.type);
            return gameTypeDef && gameTypeDef.type == category.gameType;
        });

        // Sort items based on currently selected sort
        const displaySubcatSort = category.loadoutType == "emote" || category.loadoutType == "player_icon";

        if (!displaySubcatSort && this.sortType == "subcat") {
            this.sortType = "newest";
        }
        const sortType = this.sortType;

        loadoutItems.sort(sortTypes[sortType]);

        const draggable = category.loadoutType == "emote";

        this.loadoutDisplay?.setView(category.loadoutType);

        const getItemSourceName = function(source: string) {
            const sourceDef = GameObjectDefs.typeToDefSafe(source) as LoadoutItemDef;
            if (sourceDef?.name) {
                return sourceDef.name;
            }
            return source;
        };

        this.selectedCatItems = [];
        let loadoutItemKey = -1;
        for (let i = 0; i < loadoutItems.length; i++) {
            const item = loadoutItems[i];
            const objDef = GameObjectDefs.typeToDef(item.type) as LoadoutItemDef;
            const svg = helpers.getSvgFromGameType(item.type);
            const alert = this.localAckItems.findIndex((x) => {
                return x.type == item.type;
            }) !== -1;

            const itemInfo: ItemInfo = {
                loadoutType: category.loadoutType,
                type: item.type,
                rarity: objDef.rarity || Rarity.Stock,
                displayName: translate(`game-${item.type}`) || objDef.name!,
                displayLore: translate(`game-${item.type}-lore`) || objDef.lore!,
                displaySource: getItemSourceName(item.source),
                timeAcquired: item.timeAcquired,
                subcat: (objDef as EmoteDef).category,
                view: {
                    key: i,
                    type: item.type,
                    image: `url(${svg})`,
                    transform: helpers.getCssTransformFromGameType(item.type),
                    filter: objDef.type === "outfit" ? helpers.getSvgFilterForTint(objDef.lootImg.tint) : "",
                    draggable,
                    // Notification pulse
                    alert,
                    alertActive: alert,
                    // Crosshair tiles preview their crosshair as the pointer
                    cursor: category.gameType == "crosshair"
                        ? crosshair.getCursor({ type: item.type, color: 0xffffff, size: "1", stroke: "0" })
                        : "",
                },
            };
            this.selectedCatItems.push(itemInfo);
            if (loadoutItemKey == -1) {
                if (
                    category.loadoutType == "crosshair"
                    && itemInfo.type == this.loadout.crosshair.type
                ) {
                    loadoutItemKey = i;
                } else if (
                    category.loadoutType != "emote"
                    && category.loadoutType != "crosshair"
                    && itemInfo.type == this.loadout[category.loadoutType]
                ) {
                    loadoutItemKey = i;
                }
            }
        }

        setLoadoutView((s) => {
            s.catIdx = this.selectedCatIdx;
            s.subcatSort = displaySubcatSort;
            s.sort = sortType;
            s.crosshairPanel = category.loadoutType == "crosshair";
            s.emotePanel = category.loadoutType == "emote";
            s.emoteParent = category.loadoutType == "emote";
            s.crosshairParent = category.loadoutType == "crosshair";
            s.itemName = "";
            s.itemSource = "";
            s.itemLore = "";
            s.itemRarity = "";
            s.selected = -1;
        });
        this.renderItems();
        if (window.self === window.top) {
            flush();
            if (this.dom.list) this.dom.list.scrollTop = 0;
        }

        // Set itemInfo for equipped emotes
        if (category.loadoutType == "emote") {
            this.equippedItems = [];

            for (let T = 0; T < this.loadout.emotes.length; T++) {
                this.equippedItems.push({});
                const emote = this.loadout.emotes[T];
                if (GameObjectDefs.typeExists(emote)) {
                    const svg = helpers.getSvgFromGameType(emote);
                    this.updateSlotData(T, `url(${svg})`, emote);
                }
            }
        }

        this.itemSelected = false;

        if (category.loadoutType == "crosshair") {
            this.syncCrosshairInputs();
        }
        this.setCategoryAlerts();

        // Select loadout item
        this.deselectItem();
        if (loadoutItemKey != -1) {
            this.selectItem({ key: loadoutItemKey });
            if (category.loadoutType == "crosshair") {
                this.setSelectedCrosshair();
            }
            // (a real click, as jQuery's trigger("click") was: it also reaches document listeners)
            flush();
            this.dom.itemName?.click();
        }

        this.onResize();
    }

    setCategoryAlerts() {
        // Display alerts on each category that has new items
        const alerts = this.categories.map((category) =>
            this.localAckItems.some((x) => {
                const gameTypeDef = GameObjectDefs.typeToDefSafe(x.type);
                return gameTypeDef && gameTypeDef.type == category.gameType;
            })
        );
        setLoadoutView((s) => {
            for (let i = 0; i < alerts.length; i++) {
                s.categories[i].alert = alerts[i];
            }
        });
    }

    setSelectedCrosshair() {
        const crosshairDef = this.loadout.crosshair;
        setLoadoutView((s) => {
            s.crosshairImage = crosshair.getCursorURL(crosshairDef);
            s.crosshairCursor = crosshair.getCursor(crosshairDef);
        });
    }
}
