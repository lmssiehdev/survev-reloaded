import type { JSX } from "@solidjs/web";
import type { LootDef } from "@survev/shared/defs/gameObjectDefs.ts";
import type { AmmoDef, BackpackDef, ChestDef, HelmetDef } from "@survev/shared/defs/gameObjects/gearDefs.ts";
import { GEAR_TYPES, SCOPE_LEVELS } from "@survev/shared/defs/gameObjects/gearDefs.ts";
import type { MeleeDef } from "@survev/shared/defs/gameObjects/meleeDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import { math } from "@survev/shared/utils/math.ts";
import { createMemo, For } from "solid-js";
import { device, layout } from "../../device.ts";
import { helpers } from "../../helpers.ts";
import { gameUi, gameView } from "../gameView.ts";
import { hud, InteractionType, MAX_KILL_FEED_LINES, PERK_UI_COUNT } from "../hudView.ts";
import { t, translate } from "../i18n.ts";
import { type ItemAction, itemActions } from "../itemActions.ts";
import type { UiManager } from "../ui.ts";

const display = (visible: boolean, shown = "block") => (visible ? shown : "none");
const pointerEvents = (enabled: boolean) => (enabled ? "auto" : "none");
const popScale = (width: number) => {
    const scale = 1 + width * 0.33;
    return `scale(${scale}, ${scale})`;
};

// ---- inventory (right center) ----

function LootItem(props: { type: string; children: JSX.Element; ammo?: boolean; overlay?: string; img: string }) {
    const loot = () => hud.loot[props.type];
    const special = () => !!(GameObjectDefs.typeToDef(props.type) as AmmoDef).special;
    const scale = () => popScale(loot().width);
    const def = GameObjectDefs.typeToDef(props.type);
    const actions: ItemAction[] = [{ action: "drop", type: "loot", data: props.type }];
    if (def.type == "heal" || def.type == "boost") actions.unshift({ action: "use", type: "loot", data: props.type });
    return (
        <div
            {...itemActions(...actions)}
            id={`ui-loot-${props.type}`}
            class={props.ammo
                ? "ui-outline-hover ui-ammo tooltip"
                : "ui-loot ui-outline-hover ui-scale-hover ui-medical tooltip"}
            style={{
                opacity: String(special() && loot().count == 0 ? 0 : loot().count > 0 ? 1 : 0.25),
                color: loot().count === loot().maximum ? "#ff9900" : "#ffffff",
                "pointer-events": pointerEvents(loot().selectable),
            }}
        >
            <div class={props.ammo ? "tooltip-text click-through" : "tooltip-text"}>
                <div class="tooltip-title">{translate(`game-${props.type}`)}</div>
                <div class="tooltip-description">{props.children}</div>
            </div>
            <div class="ui-loot-count">{loot().count}</div>
            <img class="ui-loot-image" src={hud.staticImages ? props.img : ""} style={{ transform: scale() }} />
            {props.overlay
                ? <div class="ui-loot-overlay" style={{ background: props.overlay, transform: scale() }} />
                : null}
        </div>
    );
}

const MEDICAL = [
    { type: "bandage", img: "img/loot/loot-medical-bandage.svg" },
    { type: "healthkit", img: "img/loot/loot-medical-healthkit.svg" },
    { type: "soda", img: "img/loot/loot-medical-soda.svg" },
    { type: "painkiller", img: "img/loot/loot-medical-pill.svg" },
];

const AMMO = [
    { type: "50AE", overlay: "rgba(30, 30, 30, 0.75)" },
    { type: "9mm", overlay: "rgba(255, 153, 0, 0.75)" },
    { type: "308sub", overlay: "rgba(49, 56, 0, 0.75)" },
    { type: "12gauge", overlay: "rgba(255, 0, 0, 0.75)" },
    { type: "flare", overlay: "rgba(255, 85, 0, 0.75)" },
    { type: "762mm", overlay: "rgba(0, 102, 255, 0.75)" },
    { type: "45acp", overlay: "rgba(121, 0, 255, 0.75)" },
    { type: "556mm", overlay: "rgba(3, 123, 0, 0.75)" },
];

/** phones held upright list the ammo in another order */
const AMMO_PORTRAIT = ["9mm", "12gauge", "762mm", "556mm", "50AE", "308sub", "flare", "45acp"].map(
    (type) => AMMO.find((item) => item.type == type)!,
);

export function Inventory() {
    return (
        <>
            <div id="ui-medical-interactive">
                <For each={MEDICAL}>
                    {(item) => (
                        <LootItem type={item.type} img={item.img}>
                            <span>{translate(`game-${item.type}-tooltip`)}</span>
                            {item.type === "soda" ? [<br />, <span>{t("game-adrenaline-tooltip")}</span>] : null}
                        </LootItem>
                    )}
                </For>
            </div>
            <div id="ui-ammo-interactive">
                <For each={device.tablet || layout.landscape ? AMMO : AMMO_PORTRAIT}>
                    {(item) => (
                        <LootItem type={item.type} ammo overlay={item.overlay} img="img/loot/loot-ammo-box.svg">
                            <span>{translate(`game-${item.type}-tooltip`)}</span>
                        </LootItem>
                    )}
                </For>
            </div>
        </>
    );
}

// ---- kill feed ----

const KILL_FEED_LINES = Array.from({ length: MAX_KILL_FEED_LINES }, (_, i) => i);

export function KillFeed() {
    return (
        <div id="ui-killfeed-contents">
            <For each={KILL_FEED_LINES}>
                {(i) => {
                    const line = () => hud.killFeed[i];
                    const top = () => {
                        const lineHeight = !layout.small || device.tablet ? 35 : 15;
                        return `${Math.floor(line().offset * lineHeight)}px`;
                    };
                    return (
                        <div
                            id={`ui-killfeed-${i}`}
                            class="killfeed-div"
                            style={{ top: top(), opacity: String(line().opacity) }}
                        >
                            <div class="killfeed-text" style={{ color: line().color }}>{line().text}</div>
                        </div>
                    );
                }}
            </For>
        </div>
    );
}

// ---- scopes (top center) ----

export function Scopes() {
    return (
        <div id="ui-top-center-scopes" class="click-through js-ui-map-hidden">
            <For each={SCOPE_LEVELS}>
                {(type, i) => {
                    const scope = () => hud.scopes[i()];
                    const actions: ItemAction[] = [{ action: "use", type: "scope", data: type }];
                    if (type != "1xscope") actions.push({ action: "drop", type: "loot", data: type });
                    return (
                        <div
                            {...itemActions(...actions)}
                            id={`ui-scope-${type}`}
                            class={[
                                "ui-scope ui-zoom",
                                {
                                    "ui-outline-hover": type != "1xscope",
                                    "ui-zoom-hover": gameView.zoomHover,
                                    "ui-hidden": !scope().visible,
                                    "ui-zoom-active": scope().equipped,
                                    "ui-zoom-inactive": !scope().equipped,
                                },
                            ]}
                            style={{ "pointer-events": pointerEvents(scope().selectable) }}
                        >
                            <div class="ui-zoom-text">
                                <div class="ui-zoom-level">
                                    {type.replace("xscope", "")}
                                    <span class="ui-zoom-append">x</span>
                                </div>
                            </div>
                        </div>
                    );
                }}
            </For>
        </div>
    );
}

/** the faction patch beside the health bar */
const flairStyle = () =>
    gameView.flair
        ? { display: "block", "background-image": `url(../img/gui/player-patch-${gameView.flair}.svg)` }
        : undefined;

// ---- interaction prompt (lower center) ----

/** a touch on the interaction or reload buttons; it doesn't reach the game's own touch input */
const touchButton = (press: (ui: UiManager) => void) => (e: TouchEvent) => {
    e.stopPropagation();
    const ui = gameUi();
    if (ui) press(ui);
};
const onInteractionTouch = touchButton((ui) => ui.onInteractionTouch());
const onReloadTouch = touchButton((ui) => ui.onReloadTouch());

export function Interaction() {
    const key = () => (hud.touch ? "" : hud.interaction.key);
    return (
        <div
            id="ui-interaction"
            style={{
                display: display(hud.interaction.type != InteractionType.None, "flex"),
                "pointer-events": "auto",
            }}
            onTouchStart={onInteractionTouch}
        >
            <div
                id="ui-interaction-press"
                class={key().length > 1 ? "ui-interaction-small" : "ui-interaction-large"}
                style={{
                    "background-image": hud.touch ? "url('img/gui/tap.svg')" : "none",
                    display: display(hud.interaction.usable),
                    "pointer-events": "auto",
                }}
                onTouchStart={onInteractionTouch}
            >
                {key()}
            </div>
            <div id="ui-interaction-outer">
                <div id="ui-interaction-description">{hud.interaction.text}</div>
            </div>
        </div>
    );
}

// ---- pickup + rare loot messages (bottom center) ----

export function Messages() {
    const lootDef = createMemo(() => GameObjectDefs.typeToDefSafe(hud.rareLootMessage.lootType) as LootDef | undefined);
    const border = () => {
        const def = lootDef();
        return def?.lootImg?.border ? `url(img/loot/${def.lootImg.border.slice(0, -4)}.svg)` : "none";
    };
    const icon = () => {
        const img = helpers.getSvgFromGameType(hud.rareLootMessage.lootType);
        return img ? `url('${img}')` : "none";
    };
    const desc = () => {
        const def = lootDef();
        return def && def.type == "xp" ? `+${def.xp} ${t("game-xp-drop-desc")}` : "";
    };
    return (
        <>
            <div id="ui-pickup-message" class="notify-message" style={{ opacity: String(hud.pickupMessage.opacity) }}>
                {hud.pickupMessage.message}
            </div>
            <div
                id="ui-perk-message-wrapper"
                class="notify-message"
                style={{ opacity: String(hud.rareLootMessage.opacity) }}
            >
                <div id="ui-perk-message-image-wrapper" style={{ "background-image": border() }}>
                    <div id="ui-perk-message-image-icon" style={{ "background-image": icon() }} />
                </div>
                <div id="ui-perk-message-name" class="notify-message">
                    {translate(`game-${hud.rareLootMessage.lootType}`)}
                </div>
                <div id="ui-perk-message-acquired" class="notify-message">{desc()}</div>
            </div>
        </>
    );
}

// ---- equipped ammo ----

export function EquippedAmmo() {
    return (
        <div id="ui-equipped-ammo">
            <div id="ui-bullet-counter">
                <div
                    id="ui-current-clip"
                    style={{
                        color: hud.ammo.current > 0 ? "white" : "red",
                        opacity: hud.ammo.displayCurrent ? "1" : "0",
                        "pointer-events": "auto",
                    }}
                    onTouchStart={onReloadTouch}
                >
                    {hud.ammo.current}
                </div>
                <div
                    id="ui-remaining-ammo"
                    style={{
                        color: hud.ammo.remaining !== 0 ? "white" : "red",
                        opacity: hud.ammo.displayRemaining ? "1" : "0",
                        "pointer-events": "auto",
                    }}
                    onTouchStart={onReloadTouch}
                >
                    {hud.ammo.remaining === Number.MAX_VALUE ? "∞" : hud.ammo.remaining}
                </div>
                <div
                    id="ui-reload-button-container"
                    style={{
                        display: display(hud.touch),
                        opacity: hud.ammo.displayRemaining ? "1" : "0",
                        "pointer-events": "auto",
                    }}
                    onTouchStart={onReloadTouch}
                >
                    <div id="ui-reload-button" />
                </div>
            </div>
        </div>
    );
}

// ---- health + boost (bottom center) ----

const HEALTH_STEPS = [
    { health: 100, color: [179, 179, 179] },
    { health: 100, color: [255, 255, 255] },
    { health: 75, color: [255, 255, 255] },
    { health: 75, color: [255, 158, 158] },
    { health: 25, color: [255, 82, 82] },
    { health: 25, color: [255, 0, 0] },
    { health: 0, color: [255, 0, 0] },
];

function healthColor(health: number, downed: boolean) {
    if (downed) return "rgba(255, 0, 0, 1.0)";
    let endIdx = 0;
    const ceil = Math.ceil(health);
    while (HEALTH_STEPS[endIdx].health > ceil && endIdx < HEALTH_STEPS.length - 1) {
        endIdx++;
    }
    const stepA = HEALTH_STEPS[math.max(endIdx - 1, 0)];
    const stepB = HEALTH_STEPS[endIdx];
    const t = math.delerp(health, stepA.health, stepB.health);
    const rgb = stepA.color.map((a, i) => Math.floor(math.lerp(t, a, stepB.color[i])));
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1.0)`;
}

const BOOST_BREAKPOINTS = GameConfig.player.boostBreakpoints;
const BOOST_MAX = BOOST_BREAKPOINTS.reduce((a, b) => a + b, 0);

/** the width (0..1) of each boost bar */
function boostWidths(boost: number) {
    let boostT = boost / 100;
    return BOOST_BREAKPOINTS.map((breakPoint) => {
        const breakPointT = breakPoint / BOOST_MAX;
        const widthT = math.clamp(boostT / breakPointT, 0, 1);
        boostT = math.max(boostT - breakPointT, 0);
        return widthT;
    });
}

export function HealthAndBoost() {
    const widths = createMemo(() => boostWidths(hud.boost));
    const health = () => `${hud.health}%`;
    return (
        <>
            <div id="ui-boost-counter" style={{ opacity: hud.boost == 0 ? "0" : "1" }}>
                <For each={BOOST_BREAKPOINTS}>
                    {(_, i) => (
                        <div class="ui-boost-base" id={`ui-boost-counter-${i()}`}>
                            <div class="ui-bar-inner" style={{ width: `${widths()[i()] * 100}%` }} />
                        </div>
                    )}
                </For>
            </div>
            <div id="ui-health-counter">
                <div id="ui-health-flair-left" class="ui-health-flair" style={flairStyle()} />
                <div id="ui-health-flair-right" class="ui-health-flair" style={flairStyle()} />
                <div id="ui-health-container">
                    <div
                        class={["ui-bar-inner", { "ui-bar-danger": hud.health <= 25 }]}
                        id="ui-health-actual"
                        style={{ "background-color": healthColor(hud.health, hud.downed), width: health() }}
                    />
                    <div
                        class="ui-bar-inner"
                        id="ui-health-depleted"
                        style={{ width: health(), display: display(hud.health > 0) }}
                    />
                </div>
            </div>
        </>
    );
}

// ---- perks (bottom center left) ----

const PERK_SLOTS = Array.from({ length: PERK_UI_COUNT }, (_, i) => i);

export function Perks() {
    return (
        <For each={PERK_SLOTS}>
            {(i) => {
                const perk = () => hud.perks[i];
                return (
                    <div
                        {...itemActions({ action: "drop", type: "perk", data: i })}
                        id={`ui-perk-${i}`}
                        class={[
                            "ui-armor-counter tooltip-perk",
                            {
                                "ui-outline-hover": perk().droppable,
                                "ui-perk-no-drop": !perk().droppable,
                                "ui-perk-pulse": perk().pulse,
                            },
                        ]}
                        style={{ display: display(!!perk().type) }}
                    >
                        <div class="tooltip-text">
                            <div class="tooltip-title">{translate(`game-${perk().type}`)}</div>
                            <div class="tooltip-desc">{translate(`game-${perk().type}-desc`)}</div>
                        </div>
                        <img
                            class="ui-armor-image ui-loot-image"
                            src={perk().type ? helpers.getSvgFromGameType(perk().type) : ""}
                            style={{ transform: popScale(perk().width) }}
                        />
                    </div>
                );
            }}
        </For>
    );
}

// ---- gear (bottom center right) ----

/** on-screen order; the store follows GEAR_TYPES */
const GEAR_ORDER = ["helmet", "chest", "backpack"] as const;

export function Gear() {
    return (
        <For each={GEAR_ORDER}>
            {(gearType) => {
                const idx = GEAR_TYPES.indexOf(gearType);
                const gear = () => hud.gear[idx];
                const def = createMemo(() => (gear().item
                    ? (GameObjectDefs.typeToDef(gear().item) as HelmetDef | ChestDef | BackpackDef)
                    : null)
                );
                const level = () => def()?.level ?? 0;
                const transform = () => {
                    const rot = (GameObjectDefs.typeToDefSafe(gear().item) as MeleeDef | undefined)?.lootImg.rot;
                    return popScale(gear().width) + (rot !== undefined ? ` rotate(${rot}rad)` : "");
                };
                const actions: ItemAction[] = gearType == "backpack"
                    ? []
                    : [{ action: "drop", type: "loot", data: gearType }];
                return (
                    <div
                        {...itemActions(...actions)}
                        id={`ui-armor-${gearType}`}
                        class={gearType == "backpack"
                            ? "ui-armor-counter tooltip-perk"
                            : "ui-armor-counter ui-outline-hover tooltip-perk"}
                        style={{ display: display(!!def()), "pointer-events": pointerEvents(gear().selectable) }}
                    >
                        <div class="ui-armor-counter-inner" />
                        <div
                            class="ui-armor-level"
                            style={{ color: level() === 4 ? "#b30000" : level() === 3 ? "#ff9900" : "#ffffff" }}
                        >
                            {translate(`game-level-${level()}`)}
                        </div>
                        <div class="tooltip-text tooltip-shifted" style={{ display: display(!!def()?.hasDesc) }}>
                            <div class="tooltip-title">{translate(`game-${gear().item}`)}</div>
                            <div class="tooltip-desc">{translate(`game-${gear().item}-desc`)}</div>
                        </div>
                        <img
                            class="ui-armor-image ui-loot-image"
                            src={helpers.getSvgFromGameType(gear().item)}
                            style={{ transform: transform() }}
                        />
                    </div>
                );
            }}
        </For>
    );
}

// ---- weapons (bottom right) ----

function WeaponSlot(props: { idx: number }) {
    const weapon = () => hud.weapons[props.idx];
    const actions = itemActions(
        { action: "use", type: "weapon", data: props.idx },
        { action: "drop", type: "weapon", data: props.idx },
    );
    /** slots 1 and 2 can be dragged onto each other */
    const slot = props.idx < 2 ? props.idx + 1 : undefined;
    const drag = () => gameView.weaponDrag;
    const dragged = () => slot !== undefined && drag().slot == slot && drag().moved;
    const def = createMemo(() => GameObjectDefs.typeToDefSafe(weapon().type));
    const name = () => def() ? translate(`game-hud-${weapon().type}`) || translate(`game-${weapon().type}`) : "";
    return (
        <div class="ui-weapon-info">
            <div
                {...actions}
                onMouseDown={(e) => {
                    actions.onMouseDown(e);
                    if (slot !== undefined) gameUi()?.onWeapMouseDown(e, slot);
                }}
                onMouseUp={(e) => {
                    actions.onMouseUp(e);
                    if (slot !== undefined) gameUi()?.onWeapMouseUp(e, e.currentTarget.matches(":hover"), slot);
                }}
                class={[
                    "ui-weapon-switch",
                    {
                        // the other slots don't highlight while one is dragged
                        "ui-outline-hover": slot !== undefined || !drag().dragging,
                        "ui-weapon-dragged": dragged(),
                    },
                ]}
                id={`ui-weapon-id-${props.idx + 1}`}
                data-slot={slot}
                style={{
                    left: dragged() ? `${drag().left}px` : undefined,
                    top: dragged() ? `${drag().top}px` : undefined,
                    "background-color": weapon().equipped ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0)",
                    "pointer-events": pointerEvents(weapon().type !== "" || weapon().selectable),
                    width: `${math.lerp(weapon().width, 83.33, 100)}%`,
                    opacity: String(weapon().opacity),
                }}
            >
                <div class="ui-weapon-name">{name()}</div>
                <div class="ui-weapon-number">{weapon().bindStr[0] || ""}</div>
                {props.idx == GameConfig.WeaponSlot.Throwable
                    ? (
                        <div
                            class="ui-weapon-exp ui-weapon-ammo-counter"
                            style={{ display: display(weapon().ammo > 0) }}
                        >
                            {weapon().ammo}
                        </div>
                    )
                    : null}
                <img
                    class="ui-weapon-image"
                    src={helpers.getSvgFromGameType(weapon().type)}
                    style={{
                        display: display(!!def(), "inline"),
                        transform: def() ? helpers.getCssTransformFromGameType(weapon().type) : "",
                    }}
                />
            </div>
        </div>
    );
}

export function Weapons() {
    return (
        <div id="ui-weapon-container">
            <WeaponSlot idx={0} />
            <WeaponSlot idx={1} />
            <WeaponSlot idx={2} />
            <WeaponSlot idx={3} />
        </div>
    );
}

// ---- kill message (bottom center) ----

export function KillMessage() {
    return (
        <div id="ui-kills" style={{ opacity: String(hud.killMessage.opacity) }}>
            <div id="ui-kill-text">{hud.killMessage.text}</div>
            <div id="ui-kill-count">{hud.killMessage.count}</div>
        </div>
    );
}
