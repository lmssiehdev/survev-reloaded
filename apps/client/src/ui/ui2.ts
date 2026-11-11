import type { LootDef } from "@survev/shared/defs/gameObjectDefs.ts";
import { GEAR_TYPES, SCOPE_LEVELS } from "@survev/shared/defs/gameObjects/gearDefs.ts";
import type { GunDef } from "@survev/shared/defs/gameObjects/gunDefs.ts";
import type { MeleeDef } from "@survev/shared/defs/gameObjects/meleeDefs.ts";
import type { RoleDef } from "@survev/shared/defs/gameObjects/roleDefs.ts";
import type { ObstacleDef } from "@survev/shared/defs/mapObjects/obstacles/obstacleDefs.ts";

import { GameObjectDefs, MapObjectDefs } from "@survev/shared/defs/register.ts";
import { Action, DamageType, GameConfig, Input, type InventoryItem } from "@survev/shared/gameConfig.ts";
import { PickupMsgType } from "@survev/shared/net/net.ts";
import { collider } from "@survev/shared/utils/collider.ts";
import { math } from "@survev/shared/utils/math.ts";
import { util } from "@survev/shared/utils/util.ts";
import { v2 } from "@survev/shared/utils/v2.ts";
import { device } from "../device.ts";
import { helpers } from "../helpers.ts";
import type { InputBinds } from "../inputBinds.ts";
import type { Map } from "../map.ts";
import type { Loot, LootBarn } from "../objects/loot.ts";
import type { Obstacle } from "../objects/obstacle.ts";
import type { Player, PlayerBarn } from "../objects/player.ts";
import {
    getUiInventoryItemTypes,
    type HudGear,
    type HudKillFeedLine,
    type HudLoot,
    type HudPerk,
    type HudState,
    type HudWeapon,
    initialHud,
    InteractionType,
    MAX_KILL_FEED_LINES,
    PERK_UI_COUNT,
    setHud,
} from "./hudView.ts";
import { itemPresses, setHudUi, TOUCH_HOLD_MS } from "./itemActions.ts";
import type { Localization } from "./localization.ts";

const KILL_FEED_KEYS: Array<keyof HudKillFeedLine> = ["text", "color", "offset", "opacity"];
const WEAPON_KEYS: Array<keyof HudWeapon> = ["type", "ammo", "equipped", "selectable", "opacity", "width", "bindStr"];
const AMMO_KEYS: Array<keyof HudState["ammo"]> = ["current", "remaining", "displayCurrent", "displayRemaining"];
const SCOPE_KEYS: Array<keyof HudState["scopes"][number]> = ["visible", "equipped", "selectable"];
const LOOT_KEYS: Array<keyof HudLoot> = ["count", "maximum", "selectable", "width"];
const GEAR_KEYS: Array<keyof HudGear> = ["item", "selectable", "width"];
const PERK_KEYS: Array<keyof HudPerk> = ["type", "droppable", "width", "pulse"];

/**
 * Copies `keys` of one HUD group (a weapon slot, a loot item...) from the frame's state into the
 * plain mirror; if any changed (or `force`), queues a store write of the group.
 */
function syncGroup<T>(
    force: boolean,
    pending: Array<(hud: HudState) => void>,
    mirror: T,
    src: T,
    keys: ReadonlyArray<keyof T>,
    target: (hud: HudState) => T,
) {
    let changed = force;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (mirror[key] !== src[key]) {
            mirror[key] = src[key];
            changed = true;
        }
    }
    if (changed) {
        pending.push((hud) => {
            const dst = target(hud);
            for (let i = 0; i < keys.length; i++) dst[keys[i]] = mirror[keys[i]];
        });
    }
}

const WeaponSlotToBind = {
    [GameConfig.WeaponSlot.Primary]: Input.EquipPrimary,
    [GameConfig.WeaponSlot.Secondary]: Input.EquipSecondary,
    [GameConfig.WeaponSlot.Melee]: Input.EquipMelee,
    [GameConfig.WeaponSlot.Throwable]: Input.EquipThrowable,
};

/** the HUD's logic state (animation tickers, previous values); what it shows goes to the hud store */
class UiState {
    touch = false;
    rareLootMessage = {
        lootType: "",
        ticker: 0,
        duration: 0,
        opacity: 0,
    };

    pickupMessage = {
        message: "",
        ticker: 0,
        duration: 0,
        opacity: 0,
    };

    killMessage = {
        text: "",
        count: "",
        ticker: 0,
        duration: 0,
        opacity: 0,
    };

    killFeed = Array.from({ length: MAX_KILL_FEED_LINES }, () => ({
        text: "",
        color: "#000000",
        offset: 0,
        opacity: 0,
        ticker: Number.MAX_VALUE,
    }));

    ammo = {
        current: 0,
        remaining: 0,
        displayCurrent: false,
        displayRemaining: false,
    };

    interaction = {
        type: InteractionType.None,
        text: "",
        key: "",
        usable: false,
    };

    weapons = Array.from({ length: GameConfig.WeaponSlot.Count }, (_, i) => ({
        slot: i,
        type: "",
        ammo: 0,
        equipped: false,
        selectable: false,
        opacity: 0,
        width: 0,
        ticker: 0,
        bind: WeaponSlotToBind[i as keyof typeof WeaponSlotToBind],
        bindStr: "",
    }));

    scopes = SCOPE_LEVELS.map((type) => ({
        type,
        visible: false,
        equipped: false,
        selectable: false,
    }));

    loot = getUiInventoryItemTypes().map((type) => ({
        type,
        count: 0,
        maximum: 0,
        selectable: false,
        width: 0,
        ticker: 0,
    }));

    perks = Array.from({ length: PERK_UI_COUNT }, () => ({
        type: "",
        droppable: false,
        width: 0,
        ticker: 0,
        pulse: false,
    }));

    gear = GEAR_TYPES.map((type) => ({
        type,
        item: "",
        selectable: false,
        width: 0,
        ticker: 0,
        rot: 0,
    }));

    health = GameConfig.player.health as number;
    boost = 0;
    downed = false;
}

export class UiManager2 {
    state = new UiState();
    frameCount = 0;
    /** what was last written to the hud store (the store itself is never read back) */
    published = initialHud();
    pendingWrites: Array<(hud: HudState) => void> = [];

    rareLootMessageQueue: string[] = [];
    uiEvents: Array<{ action: string; type: string; data: string | number }> = [];

    clearQueuedItemActions: () => void;
    onKeyUp: (e: KeyboardEvent) => void;

    constructor(
        public localization: Localization,
        public inputBinds: InputBinds,
    ) {
        setHudUi(this);

        const canvas = document.getElementById("cvs")!;
        this.clearQueuedItemActions = () => {
            for (const press of itemPresses) press.queued = false;

            // @HACK: Get rid of :hover styling when using touch
            if (device.touch) {
                canvas.focus();
            }
        };

        window.addEventListener("mouseup", this.clearQueuedItemActions);
        window.addEventListener("focus", this.clearQueuedItemActions);

        this.onKeyUp = (e: KeyboardEvent) => {
            // Add an input handler specifically to handle fullscreen on Firefox;
            // "requestFullscreen() must be called from inside a short running user-generated event handler."
            const keyCode = e.which || e.keyCode;
            const bind = this.inputBinds.getBind(Input.Fullscreen);
            if (bind && keyCode == bind.code) {
                helpers.toggleFullScreen();
            }
        };
        window.addEventListener("keyup", this.onKeyUp);
    }

    m_free() {
        window.removeEventListener("focus", this.clearQueuedItemActions);

        window.removeEventListener("mouseup", this.clearQueuedItemActions);
        window.removeEventListener("keyup", this.onKeyUp);
    }

    pushAction(itemAction: { action: string; type: string; data: string | number }) {
        this.uiEvents.push({
            action: itemAction.action,
            type: itemAction.type,
            data: itemAction.data,
        });
    }

    flushInput() {
        this.uiEvents = [];
    }

    m_update(
        dt: number,
        activePlayer: Player,
        spectating: boolean,
        playerBarn: PlayerBarn,
        lootBarn: LootBarn,
        map: Map,
        inputBinds: InputBinds,
    ) {
        const state = this.state;

        // Device
        state.touch = device.touch;
        // Process touch-hold events
        if (state.touch) {
            const time = Date.now();
            for (const press of itemPresses) {
                if (press.queued && press.action == "drop" && time - press.time >= TOUCH_HOLD_MS) {
                    this.pushAction(press);
                    press.time = time;
                    press.queued = false;
                }
            }
        }

        // Perk message
        if (
            state.rareLootMessage.ticker >= state.rareLootMessage.duration
            // Create a new message if we aren't displaying one
            && this.rareLootMessageQueue.length > 0
        ) {
            const lootType = this.rareLootMessageQueue.shift()!;
            state.rareLootMessage.lootType = lootType;
            state.rareLootMessage.ticker = 0;
            state.rareLootMessage.duration = this.rareLootMessageQueue.length > 0 ? 2 : 4;
            state.rareLootMessage.opacity = 0;
        }

        {
            // Update displayed message message
            state.rareLootMessage.ticker += dt;
            const ticker = state.rareLootMessage.ticker;
            const duration = state.rareLootMessage.duration;
            state.rareLootMessage.opacity = 1
                - math.smoothstep(ticker, duration - 0.2, duration);
        }

        {
            // Pickup message
            state.pickupMessage.ticker += dt;
            const ticker = state.pickupMessage.ticker;
            const duration = state.pickupMessage.duration;
            state.pickupMessage.opacity = math.smoothstep(ticker, 0, 0.2)
                * (1 - math.smoothstep(ticker, duration, duration + 0.2))
                * (1 - state.rareLootMessage.opacity);
        }

        {
            // Kill message
            state.killMessage.ticker += dt;
            const ticker = state.killMessage.ticker;
            const duration = state.killMessage.duration;
            state.killMessage.opacity = (1 - math.smoothstep(ticker, duration - 0.2, duration))
                * (1 - state.rareLootMessage.opacity);
        }

        // KillFeed
        let offset = 0;
        for (let i = 0; i < state.killFeed.length; i++) {
            const line = state.killFeed[i];
            line.ticker += dt;
            const ticker = line.ticker;
            line.offset = offset;
            line.opacity = math.smoothstep(ticker, 0, 0.25) * (1 - math.smoothstep(ticker, 6, 6.5));
            offset += math.min(ticker / 0.25, 1);

            // Shorter animation on mobile
            if (device.mobile) {
                line.opacity = ticker < 6.5 ? 1 : 0;
            }
        }

        // Player status
        state.health = activePlayer.m_netData.m_dead
            ? 0
            : math.max(activePlayer.m_localData.m_health, 1);
        state.boost = activePlayer.m_localData.m_boost;
        state.downed = activePlayer.m_netData.m_downed;

        // Interaction
        let interactionType = InteractionType.None;
        let interactionObject: Obstacle | Loot | Player | null = null;
        let interactionUsable = true;

        if (activePlayer.canInteract(map)) {
            // Usable obstacles
            let closestObj = null;
            let closestPen = 0;
            const obstacles = map.m_obstaclePool.m_getPool();

            for (let i = 0; i < obstacles.length; i++) {
                const obstacle = obstacles[i];
                if (
                    obstacle.active
                    && !obstacle.dead
                    && util.sameLayer(obstacle.layer, activePlayer.layer)
                ) {
                    const interact = obstacle.getInteraction(activePlayer);
                    if (interact) {
                        if (obstacle.isButton && obstacle.button!.isVat) {
                            const distance = v2.distance(
                                activePlayer.m_pos,
                                obstacle.pos,
                            );

                            if (
                                distance + activePlayer.m_rad
                                    < interact.rad * obstacle.scale
                            ) {
                                closestObj = obstacle;
                                closestPen = 0;
                            }
                        } else {
                            const res = collider.intersectCircle(
                                obstacle.collider,
                                activePlayer.m_netData.m_pos,
                                interact.rad + activePlayer.m_rad,
                            );
                            if (res && res.pen >= closestPen) {
                                closestObj = obstacle;
                                closestPen = res.pen;
                            }
                        }
                    }
                }
            }
            if (closestObj) {
                interactionType = InteractionType.Object;
                interactionObject = closestObj;
                interactionUsable = true;
            }

            // Loot
            const loot = lootBarn.getClosestLoot();
            if (loot && !activePlayer.m_netData.m_downed) {
                // Ignore if it's a gun and we have full guns w/ fists out...
                // unless we're on a small screen
                const itemDef = GameObjectDefs.typeToDef(loot.type) as LootDef;

                const hasPrimaryWeapon = activePlayer.m_hasWeaponInSlot(GameConfig.WeaponSlot.Primary);
                const hasSecondaryWeapon = activePlayer.m_hasWeaponInSlot(GameConfig.WeaponSlot.Secondary);
                const hasBothWeapons = hasPrimaryWeapon && hasSecondaryWeapon;
                const usable = itemDef.type != "gun"
                    || !hasBothWeapons
                    || activePlayer.m_equippedWeaponType() == "gun";

                let canReplaceArmor = false;
                if (
                    (state.touch
                        && itemDef.type == "helmet"
                        && activePlayer.m_getHelmetLevel() == itemDef.level
                        && loot.type != activePlayer.m_netData.m_helmet)
                    || (itemDef.type == "chest"
                        && activePlayer.m_getChestLevel() == itemDef.level
                        && loot.type != activePlayer.m_netData.m_chest)
                ) {
                    canReplaceArmor = true;
                }

                if (usable || device.uiLayout == device.UiLayout.Sm) {
                    interactionType = InteractionType.Loot;
                    interactionObject = loot;
                }
                interactionUsable = usable
                    && (!state.touch
                        || itemDef.type == "gun"
                        || itemDef.type == "melee"
                        || itemDef.type == "outfit"
                        || itemDef.type == "perk"
                        || canReplaceArmor);
            }

            // Reviving
            const canSelfRevive = activePlayer.m_hasPerk("self_revive");

            if (
                activePlayer.m_action.type == Action.None
                && (!activePlayer.m_netData.m_downed || canSelfRevive)
            ) {
                const ourTeamId = playerBarn.getPlayerInfo(activePlayer.__id).teamId;
                const players = playerBarn.playerPool.m_getPool();

                for (let i = 0; i < players.length; i++) {
                    const player = players[i];
                    if (player.active) {
                        const theirTeamId = playerBarn.getPlayerInfo(player.__id).teamId;
                        if (
                            (player.__id != activePlayer.__id || canSelfRevive)
                            && ourTeamId == theirTeamId
                            && player.m_netData.m_downed
                            && !player.m_netData.m_dead
                            && player.m_action.type != Action.Revive
                        ) {
                            const dist = v2.length(
                                v2.sub(player.m_netData.m_pos, activePlayer.m_netData.m_pos),
                            );
                            if (
                                dist < GameConfig.player.reviveRange
                                && util.sameLayer(player.layer, activePlayer.layer)
                            ) {
                                interactionType = InteractionType.Revive;
                                interactionObject = player;
                                interactionUsable = true;
                            }
                        }
                    }
                }
            }

            if (
                activePlayer.m_action.type == Action.Revive
                && activePlayer.m_netData.m_downed
                && !canSelfRevive
            ) {
                interactionType = InteractionType.None;
                interactionObject = null;
                interactionUsable = false;
            }

            if (
                (activePlayer.m_action.type == Action.UseItem
                    || (activePlayer.m_action.type == Action.Revive
                        && (!activePlayer.m_netData.m_downed || !!canSelfRevive)))
                && !spectating
            ) {
                interactionType = InteractionType.Cancel;
                interactionObject = null;
                interactionUsable = true;
            }
        }
        state.interaction.type = interactionType;
        state.interaction.text = this.getInteractionText(
            interactionType,
            interactionObject!,
            activePlayer,
        );
        state.interaction.key = this.getInteractionKey(interactionType);
        state.interaction.usable = interactionUsable && !spectating;

        function updateAnimationWidth(item: { ticker: number; width: number }, duration: number) {
            if (device.mobile) {
                item.width = 0;
                return;
            }

            const animationTime = math.min(item.ticker / duration, Math.PI);
            const animationWidth = Math.sin(animationTime);
            item.width = animationWidth < 0.001 ? 0 : animationWidth;
        }

        for (let weaponIndex = 0; weaponIndex < activePlayer.m_localData.m_weapons.length; weaponIndex++) {
            const playerWeapon = activePlayer.m_localData.m_weapons[weaponIndex];
            const weaponState = state.weapons[weaponIndex];
            weaponState.type = playerWeapon.type;
            weaponState.ammo = playerWeapon.ammo;
            if (weaponIndex == GameConfig.WeaponSlot.Throwable) {
                weaponState.ammo = activePlayer.m_localData.m_inventory[playerWeapon.type] || 0;
            }

            const wasEquipped = weaponState.equipped;
            weaponState.equipped = weaponIndex == activePlayer.m_localData.m_curWeapIdx;
            weaponState.selectable = (playerWeapon.type != "" || weaponIndex == GameConfig.WeaponSlot.Primary
                || weaponIndex == GameConfig.WeaponSlot.Secondary) && !spectating;
            const targetOpacity = weaponState.equipped ? 1 : 0.6;
            const opacityDelta = targetOpacity - weaponState.opacity;
            const opacityStep = math.min(opacityDelta, (math.sign(opacityDelta) * dt) / 0.15);
            weaponState.opacity = math.clamp(weaponState.opacity + opacityStep, 0, 1);

            if (device.mobile) {
                weaponState.opacity = targetOpacity;
            }
            if (weaponState.type == "bugle" && weaponState.ammo == 0) {
                weaponState.opacity = 0.25;
            }
            weaponState.ticker += dt;
            if (!weaponState.equipped || !wasEquipped) {
                weaponState.ticker = 0;
            }
            if (this.frameCount < 2) {
                weaponState.ticker = 1;
            }

            updateAnimationWidth(weaponState, 0.09);

            const weaponInputBind = inputBinds.getBind(weaponState.bind);
            weaponState.bindStr = weaponInputBind ? weaponInputBind.toString() : "";
        }

        const playerWeaponState = state.weapons[activePlayer.m_localData.m_curWeapIdx];
        const weaponDef = GameObjectDefs.typeToDef(playerWeaponState.type) as GunDef | MeleeDef;
        const currentAmmo = playerWeaponState.ammo;
        let remainingWeaponAmmo = 0;
        if (weaponDef.type === "gun") {
            const infiniteAmmo = weaponDef.ammoInfinite
                || (activePlayer.m_hasPerk("endless_ammo") && !weaponDef.ignoreEndlessAmmo);
            remainingWeaponAmmo = infiniteAmmo
                ? Number.MAX_VALUE
                : activePlayer.m_localData.m_inventory[weaponDef.ammo];
        }
        state.ammo.current = currentAmmo;
        state.ammo.remaining = remainingWeaponAmmo;
        state.ammo.displayCurrent = weaponDef.type != "melee";
        state.ammo.displayRemaining = remainingWeaponAmmo > 0;

        for (let scopeIndex = 0; scopeIndex < state.scopes.length; scopeIndex++) {
            const scopeState = state.scopes[scopeIndex];
            scopeState.visible = activePlayer.m_localData.m_inventory[scopeState.type] > 0;
            scopeState.equipped = scopeState.visible && activePlayer.m_localData.m_scope == scopeState.type;
            scopeState.selectable = scopeState.visible && !spectating;
        }

        const playerBagLevel = activePlayer.m_getBagLevel();

        for (let lootIndex = 0; lootIndex < state.loot.length; lootIndex++) {
            const lootState = state.loot[lootIndex];
            const previousLootCount = lootState.count;
            lootState.count = activePlayer.m_localData.m_inventory[lootState.type] || 0;
            lootState.maximum = GameConfig.bagSizes[lootState.type as InventoryItem][playerBagLevel];
            lootState.selectable = lootState.count > 0 && !spectating;
            if (lootState.count > previousLootCount) {
                lootState.ticker = 0;
            }
            if (this.frameCount < 2) {
                lootState.ticker = 1;
            }
            lootState.ticker += dt;

            updateAnimationWidth(lootState, 0.05);
        }

        for (let gearIndex = 0; gearIndex < state.gear.length; gearIndex++) {
            const gearState = state.gear[gearIndex];
            let equippedItem = "";
            switch (gearState.type) {
                case "chest": {
                    equippedItem = activePlayer.m_netData.m_chest;
                    break;
                }
                case "helmet": {
                    equippedItem = activePlayer.m_netData.m_helmet;
                    break;
                }
                case "backpack": {
                    if ((equippedItem = activePlayer.m_netData.m_backpack) === "backpack00") {
                        equippedItem = "";
                        break;
                    }
                    break;
                }
            }

            const previousGearItem = gearState.item;
            gearState.item = equippedItem;
            gearState.selectable = equippedItem != "" && !spectating;
            if (previousGearItem != gearState.item) {
                gearState.ticker = 0;
            }
            if (this.frameCount < 2) {
                gearState.ticker = 1;
            }
            gearState.ticker += dt;

            updateAnimationWidth(gearState, 0.05);
        }

        for (let perkIndex = 0; perkIndex < state.perks.length; perkIndex++) {
            const perkState = state.perks[perkIndex];
            if (activePlayer.perks.length > perkIndex) {
                const playerPerk = activePlayer.perks[perkIndex];
                perkState.type = playerPerk.type;
                perkState.droppable = playerPerk.droppable;
                if (playerPerk.isNew) {
                    perkState.ticker = 0;
                }
                if (this.frameCount < 2) {
                    perkState.ticker = 1;
                }
                perkState.ticker += dt;

                updateAnimationWidth(perkState, 0.05);

                perkState.pulse = !device.mobile && perkState.ticker < 4;
            } else {
                perkState.type = "";
            }
        }

        this.publish(state);
        this.frameCount++;
    }

    /**
     * Copies what the HUD shows into the hud store. A plain mirror of the store finds the groups
     * that changed, so frames where nothing changed don't touch the store (or schedule a flush).
     */
    publish(state: UiState) {
        const m = this.published;
        const pending = this.pendingWrites;
        // the store still shows the previous game: write everything once
        const force = this.frameCount == 0;
        if (
            force || m.touch != state.touch || m.health != state.health || m.boost != state.boost
            || m.downed != state.downed
        ) {
            m.touch = state.touch;
            m.health = state.health;
            m.boost = state.boost;
            m.downed = state.downed;
            pending.push((hud) => {
                hud.touch = m.touch;
                hud.health = m.health;
                hud.boost = m.boost;
                hud.downed = m.downed;
            });
        }
        syncGroup(
            force,
            pending,
            m.rareLootMessage,
            state.rareLootMessage,
            ["lootType", "opacity"],
            (h) => h.rareLootMessage,
        );
        syncGroup(force, pending, m.pickupMessage, state.pickupMessage, ["message", "opacity"], (h) => h.pickupMessage);
        syncGroup(force, pending, m.killMessage, state.killMessage, ["text", "count", "opacity"], (h) => h.killMessage);
        for (let i = 0; i < state.killFeed.length; i++) {
            syncGroup(force, pending, m.killFeed[i], state.killFeed[i], KILL_FEED_KEYS, (h) => h.killFeed[i]);
        }
        syncGroup(
            force,
            pending,
            m.interaction,
            state.interaction,
            ["type", "text", "key", "usable"],
            (h) => h.interaction,
        );
        for (let i = 0; i < state.weapons.length; i++) {
            syncGroup(force, pending, m.weapons[i], state.weapons[i], WEAPON_KEYS, (h) => h.weapons[i]);
        }
        syncGroup(force, pending, m.ammo, state.ammo, AMMO_KEYS, (h) => h.ammo);
        for (let i = 0; i < state.scopes.length; i++) {
            syncGroup(force, pending, m.scopes[i], state.scopes[i], SCOPE_KEYS, (h) => h.scopes[i]);
        }
        for (let i = 0; i < state.loot.length; i++) {
            const type = state.loot[i].type;
            syncGroup(force, pending, m.loot[type], state.loot[i], LOOT_KEYS, (h) => h.loot[type]);
        }
        for (let i = 0; i < state.gear.length; i++) {
            syncGroup(force, pending, m.gear[i], state.gear[i], GEAR_KEYS, (h) => h.gear[i]);
        }
        for (let i = 0; i < state.perks.length; i++) {
            syncGroup(force, pending, m.perks[i], state.perks[i], PERK_KEYS, (h) => h.perks[i]);
        }

        if (pending.length > 0) {
            setHud((hud) => {
                for (let i = 0; i < pending.length; i++) pending[i](hud);
            });
            pending.length = 0;
        }
    }

    displayPickupMessage(type: PickupMsgType) {
        const pickupMessage = this.state.pickupMessage;
        pickupMessage.message = this.getPickupMessageText(type);
        pickupMessage.ticker = 0;
        pickupMessage.duration = 3;
    }

    displayKillMessage(text: string, count: string) {
        const killMessage = this.state.killMessage;
        killMessage.text = text;
        killMessage.count = count;
        killMessage.ticker = 0;
        killMessage.duration = 7;
    }

    hideKillMessage() {
        this.state.killMessage.ticker = math.max(
            this.state.killMessage.ticker,
            this.state.killMessage.duration - 0.2,
        );
    }

    addRareLootMessage(lootType: string, clearQueue?: boolean) {
        if (clearQueue) {
            this.state.rareLootMessage.ticker = this.state.rareLootMessage.duration;
            this.rareLootMessageQueue = [];
        }
        this.rareLootMessageQueue.push(lootType);
    }

    removeRareLootMessage(lootType: string) {
        const idx = this.rareLootMessageQueue.indexOf(lootType);

        if (idx >= 0) {
            this.rareLootMessageQueue.splice(idx, 1);
        }

        if (this.state.rareLootMessage.lootType == lootType) {
            this.state.rareLootMessage.ticker = this.state.rareLootMessage.duration;
        }
    }

    getRareLootMessageText(perk: string) {
        if (GameObjectDefs.typeExists(perk)) {
            return `Acquired perk: ${this.localization.translate(`game-${perk}`)}`;
        }
        return "";
    }

    addKillFeedMessage(text: string, color: string) {
        const killFeed = this.state.killFeed;
        const oldest = killFeed[killFeed.length - 1];
        oldest.text = text;
        oldest.color = color;
        oldest.ticker = 0;
        killFeed.sort((a, b) => {
            return a.ticker - b.ticker;
        });
    }

    getKillFeedText(
        targetName: string,
        killerName: string,
        sourceType: string,
        damageType: DamageType,
        downed: boolean,
    ) {
        switch (damageType) {
            case DamageType.Player:
                return `${killerName} ${
                    this.localization.translate(
                        downed ? "game-knocked-out" : "game-killed",
                    )
                } ${targetName} ${
                    this.localization.translate(
                        "game-with",
                    )
                } ${this.localization.translate(`game-${sourceType}`)}`;
            case DamageType.Bleeding: {
                const killTxt = this.localization.translate(
                    killerName ? "game-finally-killed" : "game-finally-bled-out",
                );
                if (killerName) {
                    return `${killerName} ${killTxt} ${targetName}`;
                }
                return `${targetName} ${killTxt}`;
            }
            case DamageType.Gas: {
                let killName;
                let killTxt;
                if (downed) {
                    killName = this.localization.translate("game-the-red-zone");
                    killTxt = this.localization.translate("game-knocked-out");
                } else {
                    killTxt = this.localization.translate(
                        killerName ? "game-finally-killed" : "game-died-outside",
                    );
                }
                if (killName) {
                    return `${killName} ${killTxt} ${targetName}`;
                }
                return `${targetName} ${killTxt}`;
            }
            case DamageType.Airdrop: {
                const mapObj = MapObjectDefs.typeToDefSafe(sourceType) as ObstacleDef;
                const killName = this.localization.translate("game-the-air-drop");
                // the plane dropped something that isn't a crate
                let killKey = mapObj && !mapObj.airdropCrate ? "game-killed" : "game-crushed";
                if (downed) killKey = "game-knocked-out";
                const killTxt = this.localization.translate(killKey);
                return `${killName} ${killTxt} ${targetName}`;
            }
            case DamageType.Airstrike: {
                const killTxt = this.localization.translate(
                    downed ? "game-knocked-out" : "game-killed",
                );
                if (killerName) {
                    return `${killerName} ${killTxt} ${targetName} ${
                        this.localization.translate(
                            "game-with",
                        )
                    } ${this.localization.translate("game-an-air-strike")}`;
                }
                return `${
                    this.localization.translate(
                        "game-the-air-strike",
                    )
                } ${killTxt} ${targetName}`;
            }
            default:
                return "";
        }
    }

    getKillFeedColor(
        activeTeamId: number,
        targetTeamId: number,
        killerTeamId: number,
        factionMode: boolean,
    ) {
        if (factionMode) {
            return "#efeeee";
        }
        if (activeTeamId == targetTeamId) {
            return "#d1777c";
        }
        if (activeTeamId == killerTeamId) {
            return "#00bfff";
        }
        return "#efeeee";
    }

    getRoleKillFeedColor(role: string, teamId: number, playerBarn: PlayerBarn) {
        const roleDef = GameObjectDefs.typeToDefSafe(role) as RoleDef | undefined;
        if (roleDef?.killFeed?.color) {
            return roleDef.killFeed.color;
        }
        return helpers.colorToHexString(playerBarn.getTeamColor(teamId));
    }

    getRoleTranslation(role: string, teamId: number) {
        let roleTxt = `game-${role}`;
        if (role == "leader") {
            roleTxt = teamId == GameConfig.FactionTeam.Red ? "game-red-leader" : "game-blue-leader";
        }
        return this.localization.translate(roleTxt);
    }

    getRoleAnnouncementText(role: string, teamId: number) {
        return `${
            this.localization.translate(
                "game-youve-been-promoted-to",
            )
        } ${this.getRoleTranslation(role, teamId)}!`;
    }

    getRoleAssignedKillFeedText(role: string, teamId: number, playerName: string) {
        const roleTxt = this.getRoleTranslation(role, teamId);
        return `${playerName} ${
            this.localization.translate(
                "game-promoted-to",
            )
        } ${roleTxt}!`;
    }

    getRoleKilledKillFeedText(role: string, teamId: number, killerName: string) {
        const roleTxt = this.getRoleTranslation(role, teamId);
        if (killerName) {
            return `${killerName} ${
                this.localization.translate(
                    "game-killed",
                )
            } ${roleTxt}!`;
        }
        return `${roleTxt} ${this.localization.translate("game-is-dead")}!`;
    }

    getKillText(
        killerName: string,
        targetName: string,
        completeKill: boolean,
        downed: boolean,
        killed: boolean,
        suicide: boolean,
        sourceType: string,
        damageType: DamageType,
        spectating: boolean,
    ) {
        const knockedOut = downed && !killed;
        const youTxt = spectating
            ? killerName
            : this.localization.translate("game-you").toUpperCase();
        let killKey = completeKill ? "game-killed" : "game-finally-killed";
        if (knockedOut) killKey = "game-knocked-out";
        const killTxt = this.localization.translate(killKey);
        let targetTxt = targetName;
        if (suicide) {
            targetTxt = spectating
                ? this.localization.translate("game-themselves")
                : this.localization.translate("game-yourself").toUpperCase();
        }
        const damageTxt = this.localization.translate(
            damageType == GameConfig.DamageType.Airstrike
                ? "game-an-air-strike"
                : `game-${sourceType}`,
        );
        const withTxt = this.localization.translate("game-with");

        if (damageTxt && (completeKill || knockedOut)) {
            return `${youTxt} ${killTxt} ${targetTxt} ${withTxt} ${damageTxt}`;
        }
        return `${youTxt} ${killTxt} ${targetTxt}`;
    }

    getKillCountText(killCount: number) {
        return `${killCount} ${
            this.localization.translate(
                killCount != 1 ? "game-kills" : "game-kill",
            )
        }`;
    }

    getDownedText(
        killerName: string,
        targetName: string,
        sourceType: string,
        damageType: DamageType,
        spectating: boolean,
    ) {
        const youTxt = spectating
            ? targetName
            : this.localization.translate("game-you").toUpperCase();
        let killerTxt = killerName;
        if (!killerTxt) {
            if (damageType == GameConfig.DamageType.Gas) {
                killerTxt = this.localization.translate("game-the-red-zone");
            } else if (damageType == GameConfig.DamageType.Airdrop) {
                killerTxt = this.localization.translate("game-the-air-drop");
            } else if (damageType == GameConfig.DamageType.Airstrike) {
                killerTxt = this.localization.translate("game-the-air-strike");
            }
        }
        let damageTxt = this.localization.translate(`game-${sourceType}`);
        if (killerName && damageType == GameConfig.DamageType.Airstrike) {
            damageTxt = this.localization.translate("game-an-air-strike");
        }
        const withTxt = this.localization.translate("game-with");
        if (damageTxt) {
            return `${killerTxt} knocked ${youTxt} out ${withTxt} ${damageTxt}`;
        }
        return `${killerTxt} knocked ${youTxt} out`;
    }

    getPickupMessageText(type: PickupMsgType) {
        const typeMap: Record<number, string> = {
            [PickupMsgType.Full]: "game-not-enough-space",
            [PickupMsgType.AlreadyOwned]: "game-item-already-owned",
            [PickupMsgType.AlreadyEquipped]: "game-item-already-equipped",
            [PickupMsgType.BetterItemEquipped]: "game-better-item-equipped",
            [PickupMsgType.GunCannotFire]: "game-gun-cannot-fire",
            [PickupMsgType.MaxPerks]: "game-max-perks",
        };
        const key = typeMap[type] || typeMap[PickupMsgType.Full];
        return this.localization.translate(key);
    }

    getInteractionText(
        type: InteractionType,
        object: Obstacle | Loot | Player,
        player: Player,
    ) {
        switch (type) {
            case InteractionType.None:
                return "";
            case InteractionType.Cancel:
                return this.localization.translate("game-cancel");
            case InteractionType.Revive:
                if (
                    object
                    && player
                    && (object == player || player.downed)
                    && player.m_hasPerk("self_revive")
                ) {
                    return this.localization.translate("game-revive-self");
                }
                return this.localization.translate("game-revive-teammate");
            case InteractionType.Object: {
                const x = (object as Obstacle).getInteraction(player)!;
                return `${
                    this.localization.translate(
                        x.action,
                    )
                } ${this.localization.translate(x.object)}`;
            }
            case InteractionType.Loot: {
                const loot = object as Loot;
                let txt = this.localization.translate(`game-${loot.type}`) || loot.type;
                if (loot.count > 1) {
                    txt += ` (${loot.count})`;
                }
                return txt;
            }
            default:
                return "";
        }
    }

    getInteractionKey(type: InteractionType) {
        let bind = null;
        switch (type) {
            case InteractionType.Cancel:
                bind = this.inputBinds.getBind(Input.Cancel);
                break;
            case InteractionType.Loot:
                bind = this.inputBinds.getBind(Input.Loot)
                    || this.inputBinds.getBind(Input.Interact);
                break;
            case InteractionType.Object:
                bind = this.inputBinds.getBind(Input.Use)
                    || this.inputBinds.getBind(Input.Interact);
                break;
            case InteractionType.Revive:
                bind = this.inputBinds.getBind(Input.Revive)
                    || this.inputBinds.getBind(Input.Interact);
                break;
            case InteractionType.None:
            default:
                bind = this.inputBinds.getBind(Input.Use);
        }

        if (bind) {
            return bind.toString();
        }
        return "<Unbound>";
    }
}

export function loadStaticDomImages() {
    // Fetch dom images here instead of index.html to speed up page responsiveness
    setHud((hud) => {
        hud.staticImages = true;
    });
}
