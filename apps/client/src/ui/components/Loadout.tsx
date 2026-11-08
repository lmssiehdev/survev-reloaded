import { For, Show } from "solid-js";
import { t, translate } from "../i18n.ts";
import type { ItemRef, LoadoutMenu } from "../loadoutMenu.ts";
import { loadoutView } from "../loadoutView.ts";

function display(visible: boolean) {
    return visible ? "block" : "none";
}

/** the category tabs above the item grid */
function Categories(props: { menu: LoadoutMenu }) {
    return (
        <div id="modal-customize-header" class="modal-header">
            <For each={loadoutView.categories}>
                {(cat, idx) => {
                    const selected = () => loadoutView.catIdx === idx();
                    return (
                        <div
                            id={idx() === loadoutView.categories.length - 1
                                ? "modal-customize-cat-standalone"
                                : undefined}
                            class={["modal-customize-cat", { "modal-customize-cat-selected": selected() }]}
                            data-idx={idx()}
                            onMouseUp={() => props.menu.onCategoryMouseUp(idx())}
                        >
                            <div
                                class={["modal-customize-cat-image", {
                                    "modal-customize-cat-image-selected": selected(),
                                }]}
                                style={{ "background-image": `url(${cat.image})` }}
                            />
                            <div
                                class={["modal-customize-cat-connect", {
                                    "modal-customize-cat-connect-selected": selected(),
                                }]}
                            />
                            <div class="account-alert account-alert-cat" style={{ display: display(cat.alert) }} />
                        </div>
                    );
                }}
            </For>
        </div>
    );
}

/** the grid of owned items in the selected category */
function ItemList(props: { menu: LoadoutMenu }) {
    return (
        <div
            id="modal-customize-list"
            ref={(el) => (props.menu.dom.list = el)}
            style={{ height: loadoutView.listHeight || undefined }}
        >
            <div>
                <For each={loadoutView.items}>
                    {(item) => (
                        <div
                            class={["customize-list-item customize-list-item-unlocked", {
                                "customize-list-item-selected": loadoutView.selected === item.key,
                            }]}
                            style={{ cursor: item.cursor || undefined }}
                            onMouseUp={() => props.menu.onListItemMouseUp(item.key)}
                            onDragStart={(e) => {
                                if (item.draggable) props.menu.onDragStart({ key: item.key }, e);
                            }}
                        >
                            <div
                                class="customize-item-image"
                                style={{
                                    "background-image": item.image,
                                    transform: item.transform || undefined,
                                    filter: item.filter || undefined,
                                }}
                                draggable={item.draggable ? "true" : "false"}
                            />
                            <Show when={item.alert}>
                                <div
                                    class={item.alertActive ? "account-alert account-alert-cat" : undefined}
                                    style={{ display: "block" }}
                                />
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
}

function CrosshairPanel(props: { menu: LoadoutMenu }) {
    return (
        <div
            id="modal-content-right-crosshair"
            class="modal-content-right modal-content-shadow"
            style={{ display: display(loadoutView.crosshairPanel) }}
        >
            <div class="modal-spacer" />
            <div class="modal-disabled" />
            <div id="customize-crosshair-parent" style={{ display: display(loadoutView.crosshairParent) }}>
                <div id="customize-crosshair-selected" style={{ cursor: loadoutView.crosshairCursor || undefined }}>
                    <div
                        class="customize-item-image customize-crosshair-image"
                        draggable="false"
                        style={{ "background-image": loadoutView.crosshairImage || undefined }}
                    />
                </div>
                <div id="customize-crosshair-sliders">
                    <div class="crosshair-hex-outer">
                        <span>#</span>
                        <input
                            type="text"
                            id="color-picker-hex"
                            ref={(el) => (props.menu.dom.hex = el)}
                            value={loadoutView.crosshairHex}
                            onInput={(e) => props.menu.onHexInput(e.currentTarget.value)}
                            onKeyUp={(e) => props.menu.onHexInput(e.currentTarget.value)}
                            onCut={(e) => props.menu.onHexInput(e.currentTarget.value)}
                            onPaste={(e) => props.menu.onHexInput(e.currentTarget.value)}
                        />
                    </div>
                    <section id="color-picker" ref={(el) => (props.menu.dom.picker = el)} />
                    <div class="crosshair-slider-container">
                        <p>{t("loadout-size")}</p>{" "}
                        <input
                            type="range"
                            min="0.25"
                            max="1.0"
                            step="0.025"
                            class="crosshair-slider"
                            id="crosshair-size"
                            ref={(el) => (props.menu.dom.size = el)}
                            value={loadoutView.crosshairSize}
                            onInput={(e) => props.menu.onCrosshairSize(e.currentTarget.value)}
                        />
                    </div>
                    <div class="crosshair-slider-container">
                        <p>{t("loadout-stroke")}</p>{" "}
                        <input
                            type="range"
                            min="0.0"
                            max="1.5"
                            step="0.025"
                            class="crosshair-slider"
                            id="crosshair-stroke"
                            ref={(el) => (props.menu.dom.stroke = el)}
                            value={loadoutView.crosshairStroke}
                            onInput={(e) => props.menu.onCrosshairStroke(e.currentTarget.value)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

/** the highlight, image and drop target shared by the wheel and auto emote slots */
function SlotParts(props: { menu: LoadoutMenu; slot: number; image: string; size: "small" | "large" }) {
    const ref = (): ItemRef => ({ slot: props.slot });
    return (
        <>
            <div
                class="ui-emote ui-emote-hl"
                style={{
                    display: display(loadoutView.slotHighlight),
                    opacity: String(loadoutView.slotHighlightOpacity[props.slot]),
                }}
            />
            <div
                class={props.image}
                style={{ "background-image": loadoutView.slotImages[props.slot] || undefined }}
            />
            <div
                class={`customize-col customize-col-${props.size}`}
                draggable="true"
                onMouseDown={(e) => props.menu.onSlotMouseDown(props.slot, e)}
                onMouseUp={() => props.menu.onSlotMouseUp(props.slot)}
                onDragStart={(e) => props.menu.onDragStart(ref(), e)}
                onDrop={(e) => {
                    e.preventDefault();
                    props.menu.onSlotDrop(props.slot);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    props.menu.setSlotHighlightOpacity(props.slot, 1);
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    props.menu.setSlotHighlightOpacity(props.slot, props.menu.highlightOpacityMin);
                }}
                onDragEnd={(e) => {
                    e.preventDefault();
                    props.menu.deselectItem();
                }}
            />
        </>
    );
}

const WHEEL_SLOTS = [
    { slot: 0, side: "top", name: "emoteTop" },
    { slot: 1, side: "right", name: "emoteRight" },
    { slot: 2, side: "bottom", name: "emoteBottom" },
    { slot: 3, side: "left", name: "emoteLeft" },
] as const;

const AUTO_SLOTS = [
    { slot: 4, id: "customize-emote-win", name: "emoteWin", icon: "ui-emote-auto-chicken" },
    { slot: 5, id: "customize-emote-death", name: "emoteDeath", icon: "ui-emote-auto-skull" },
] as const;

function EmotePanel(props: { menu: LoadoutMenu }) {
    return (
        <div
            id="modal-content-right-emote"
            class="modal-content-right modal-content-shadow"
            style={{ display: display(loadoutView.emotePanel) }}
        >
            <div id="customize-emote-parent" style={{ display: display(loadoutView.emoteParent) }}>
                <div id="customize-emote-wheel" class="ui-emote-wheel">
                    <div id="customize-emote-middle" class="ui-emote-middle ui-emote-circle ui-emote-parent">
                        <div class="ui-emote ui-emote-bg-circle" />
                        <div class="ui-emote ui-emote-hl" />
                        <div class="customize-emote-slot customize-item-image ui-emote-image" />
                    </div>
                    <For each={WHEEL_SLOTS}>
                        {(s) => (
                            <div
                                id={`customize-emote-${s.side}`}
                                class={`ui-emote-${s.side} ui-emote-quarter ui-emote-parent`}
                                data-slot={s.name}
                                data-idx={s.slot}
                            >
                                <div class="ui-emote ui-emote-bg-quarter" />
                                <SlotParts
                                    menu={props.menu}
                                    slot={s.slot}
                                    image="customize-emote-slot customize-item-image ui-emote-image"
                                    size="small"
                                />
                            </div>
                        )}
                    </For>
                </div>
                <div id="customize-emote-autos">
                    <For each={AUTO_SLOTS}>
                        {(s) => (
                            <div
                                id={s.id}
                                class="ui-emote-middle ui-emote-circle ui-emote-parent"
                                data-slot={s.name}
                                data-idx={s.slot}
                            >
                                <div class="ui-emote ui-emote-auto-trash" onClick={() => props.menu.onTrash(s.slot)} />
                                <div class={`ui-emote ui-emote-auto-icon ${s.icon}`} />
                                <div class="ui-emote ui-emote-bg-circle-outer" />
                                <div class="ui-emote ui-emote-bg-circle" />
                                <SlotParts
                                    menu={props.menu}
                                    slot={s.slot}
                                    image="customize-emote-slot customize-item-image"
                                    size="large"
                                />
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </div>
    );
}

/** the loadout / customize modal, opened from the start menu */
export function CustomizeModal(props: { menu: LoadoutMenu }) {
    const title = () => {
        const cat = loadoutView.categories[loadoutView.catIdx];
        return cat ? translate(`loadout-title-${cat.loadoutType}`).toUpperCase() : "";
    };
    return (
        <div
            id="modal-customize"
            class={["modal", props.menu.modal.classes()]}
            ref={(el) => props.menu.modal.attach(el)}
            style={{ cursor: loadoutView.cursorReset ? "initial" : undefined }}
        >
            <div id="modal-customize-wrapper" class="modal-close">
                <div id="modal-content-left" class="modal-content-shadow">
                    <div id="modal-customize-cat-title">{title()}</div>
                    <div id="modal-customize-sort-wrap">
                        <select
                            id="modal-customize-sort"
                            value={loadoutView.sort}
                            onChange={(e) => props.menu.sortItems(e.currentTarget.value)}
                        >
                            <option id="customize-sort-newest" value="newest">{t("loadout-newest")}</option>
                            <option id="customize-sort-alpha" value="alpha">{t("loadout-alpha")}</option>
                            <option id="customize-sort-rarity" value="rarity">{t("loadout-rarity")}</option>
                            <option
                                id="customize-sort-subcat"
                                value="subcat"
                                style={{ display: display(loadoutView.subcatSort) }}
                            >
                                {t("loadout-subcat")}
                            </option>
                        </select>
                    </div>
                    <div id="modal-customize-close">
                        <span class="close close-corner" onClick={(e) => props.menu.modal.hide(e)} />
                    </div>
                    <Categories menu={props.menu} />
                    <div class="modal-disabled">
                        <div class="modal-disabled-message">The Edge browser does not support custom cursors.</div>
                    </div>
                    <div id="modal-customize-body" class="modal-body">
                        <div id="modal-customize-item-header">
                            <div
                                id="modal-customize-item-name"
                                ref={(el) => (props.menu.dom.itemName = el)}
                                onClick={() => props.menu.scrollToSelected()}
                            >
                                {loadoutView.itemName}
                            </div>{" "}
                            <div
                                id="modal-customize-item-rarity"
                                style={{ color: loadoutView.itemRarityColor || undefined }}
                            >
                                {loadoutView.itemRarity}
                            </div>
                            <div id="modal-customize-loading-container">
                                <div
                                    id="modal-customize-loading"
                                    style={{
                                        opacity: loadoutView.loading === null
                                            ? undefined
                                            : loadoutView.loading
                                            ? "1"
                                            : "0",
                                    }}
                                />
                            </div>
                        </div>
                        <ItemList menu={props.menu} />
                    </div>
                    <div id="modal-customize-footer" class="modal-footer modal-footer-round">
                        <div id="modal-customize-item-source">{loadoutView.itemSource}</div>
                        <div id="modal-customize-item-lore">{loadoutView.itemLore}</div>
                    </div>
                </div>
                <CrosshairPanel menu={props.menu} />
                <EmotePanel menu={props.menu} />
            </div>
        </div>
    );
}

/** "You got a new item!", shown over a dark screen block when the loadout opens */
export function ItemConfirmModal(props: { menu: LoadoutMenu }) {
    const modal = props.menu.confirmItemModal;
    return (
        <div
            id="modal-screen-block"
            class={["fade", { faded: !loadoutView.screenBlock }]}
            style={{ "--fade": loadoutView.screenBlock ? "200ms" : "300ms" }}
        >
            <div id="modal-item-confirm" class={["modal", modal.classes()]} ref={(el) => modal.attach(el)}>
                <div class="modal-content modal-close">
                    <div class="modal-header modal-header-name">
                        <h2>You got a new item!</h2>
                    </div>
                    <div class="modal-body modal-body-name">
                        <div id="modal-item-confirm-image-outer">
                            <div
                                id="modal-item-confirm-image-inner"
                                style={{
                                    "background-image": loadoutView.confirmImage || undefined,
                                    transform: loadoutView.confirmTransform || undefined,
                                    filter: loadoutView.confirmFilter || undefined,
                                }}
                            />
                        </div>
                        <div class="modal-settings-item">
                            <p id="modal-item-confirm-name" class="modal-body-text">{loadoutView.confirmName}</p>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-name modal-footer-round">
                        <h3 class="close close-footer" onClick={(e) => modal.hide(e)}>{t("index-confirm")}</h3>
                        <h3 class="close close-footer" data-confirm-all="true" onClick={(e) => modal.hide(e)}>
                            {t("index-confirm-all")}
                        </h3>
                    </div>
                </div>
            </div>
        </div>
    );
}
