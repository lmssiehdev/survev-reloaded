import * as PIXI from "pixi.js-legacy";
import { reconcile } from "solid-js";

import { PingDefs } from "@survev/shared/defs/gameObjects/pingDefs.ts";
import type { RoleDef } from "@survev/shared/defs/gameObjects/roleDefs.ts";
import type { MapDef } from "@survev/shared/defs/mapDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { Action, GameConfig, GasMode, TeamMode } from "@survev/shared/gameConfig.ts";
import type { PlayerStatsMsg } from "@survev/shared/net/playerStatsMsg.ts";
import { SpectateAction } from "@survev/shared/net/spectateMsg.ts";
import type { MapIndicator } from "@survev/shared/net/updateMsg.ts";
import { coldet } from "@survev/shared/utils/coldet.ts";
import { math } from "@survev/shared/utils/math.ts";
import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import type { AudioManager } from "../audioManager.ts";
import type { Camera } from "../camera.ts";
import { device } from "../device.ts";
import type { Game } from "../game.ts";
import { type Gas, GasRenderer, GasSafeZoneRenderer } from "../gas.ts";
import { helpers } from "../helpers.ts";
import type { InputBinds, InputBindUi } from "../inputBinds.ts";
import type { SoundHandle } from "../lib/createJS.ts";
import type { Map } from "../map.ts";
import { MapIndicatorBarn } from "../objects/mapIndicator.ts";
import { type MapSprite, MapSpriteBarn } from "../objects/mapSprite.ts";
import type { ParticleBarn } from "../objects/particles.ts";
import type { PlaneBarn } from "../objects/plane.ts";
import type { ClientPlayerStatus, Player, PlayerBarn } from "../objects/player.ts";
import {
    type GameTab,
    setGameUi,
    setGameView,
    type StatsPlayerView,
    type TeamMemberStatus,
    type TeamMemberView,
} from "./gameView.ts";
import type { Localization } from "./localization.ts";
import { PieTimer } from "./pieTimer.ts";
import type { Touch } from "./touch.ts";
import type { UiManager2 } from "./ui2.ts";

function Interpolate(start: number, end: number, steps: number, count: number) {
    const f = start + ((end - start) / steps) * count;
    return Math.floor(f);
}

class Color {
    constructor(
        public r: number,
        public g: number,
        public b: number,
    ) {}

    getColors() {
        return {
            r: this.r,
            g: this.g,
            b: this.b,
        };
    }
}

interface ContainerWithMask extends PIXI.Container {
    mask: PIXI.Graphics;
}

/** module-wide, so a new game's UiManager never repeats the previous one's */
let statsSeq = 0;
let announcementSeq = 0;

type PrevStatus = Pick<ClientPlayerStatus, "downed" | "dead" | "disconnected" | "role">;
export class UiManager {
    m_pieTimer = new PieTimer();
    escMenuDisplayed = false;
    roleMenuActive = false;
    roleMenuTicker = 0;
    roleDisplayed = "";
    roleSelected = "";

    roleMenuInst: SoundHandle | null = null;
    waitingForPlayers = true;
    spectating = false;
    prevSpectatorCount = 0;
    spectatorCount = 0;
    spectatorCounterDisplayed = false;
    spectatedPlayerName = "";
    spectatedPlayerId = 0;
    localStatsDisplayed = false;
    playersAliveCounter = 0;
    playersAliveRedCounter = 0;
    playersAliveBlueCounter = 0;
    mapContainerBottom = 52;
    mapInfoBottom = 218;
    gasState = {} as {
        mode: number;
        time: number;
    };

    actionSeq = -1;
    displayMapDirty = false;
    displayMapClear = false;

    // In-game menu
    currentGameTab: GameTab = "settings";

    onTouchScreen: (e: TouchEvent) => void;

    specAction = SpectateAction.None;

    // touch buttons pressed since the last input update
    interactionTouched = false;
    reloadTouched = false;

    flairId = 0;

    // Health bar values
    healthRed = new Color(255, 0, 0);
    healthDarkpink = new Color(255, 45, 45);
    healthLightpink = new Color(255, 112, 112);
    healthWhite = new Color(255, 255, 255);
    healthGrey = new Color(179, 179, 179);

    // Store minimap hidden
    minimapDisplayed = true;

    // Store UI visibility mode
    visibilityMode = 0;
    hudVisible = true;

    gasRenderer!: GasRenderer;
    gasSafeZoneRenderer = new GasSafeZoneRenderer();
    sentAdStatus = false;
    frame = 0;
    weapsDirty = false;
    // weapon slot dragging
    weapDraggedId = 0;
    swapWeapSlots = false;
    weapDragging = false;
    weapDropped = false;

    mapSpriteBarn = new MapSpriteBarn();
    mapIndicatorBarn!: MapIndicatorBarn;
    playerMapSprites: MapSprite[] = [];
    playerPingSprites = {} as Record<number, MapSprite[]>;
    container = new PIXI.Container() as ContainerWithMask;

    display: {
        gas: PIXI.DisplayObject;
        gasSafeZone: PIXI.Container;
        airstrikeZones: PIXI.Container;
        mapSprites: PIXI.Container;
        border: PIXI.Graphics;
    };

    mapSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    bigmapDisplayed = false;
    screenScaleFactor = 1;
    minimapPos!: Vec2;

    dead = false;

    displayingStats = false;
    teamMemberHealthBarWidth: number;

    teamMemberHeight = 48;
    groupPlayerCount = 0;
    teamSelectors: Array<{
        groupIdDisplayed: boolean;
        playerId: number;
        prevHealth: number;
        prevStatus: PrevStatus;
    }> = [];

    displayOldMapSprites = false;

    constructor(
        public game: Game,
        public audioManager: AudioManager,
        public particleBarn: ParticleBarn,
        public planeBarn: PlaneBarn,
        public localization: Localization,
        public canvasMode: boolean,
        public touch: Touch,
        public inputBinds: InputBinds,
        public inputBindUi: InputBindUi,
    ) {
        setGameUi(this);
        // the minimap and team panels show from now on
        setGameView((v) => {
            v.active = true;
        });

        this.onTouchScreen = (e: TouchEvent) => {
            if (e.target instanceof HTMLElement && e.target.id == "cvs") {
                this.toggleEscMenu(true);
            }
        };
        document.addEventListener("touchstart", this.onTouchScreen);

        this.setCurrentGameTab(this.currentGameTab);

        this.gasRenderer = new GasRenderer(canvasMode, 0x000000);

        this.mapIndicatorBarn = new MapIndicatorBarn(this.mapSpriteBarn);

        this.container.mask = new PIXI.Graphics();

        this.display = {
            gas: this.gasRenderer.display!,
            gasSafeZone: this.gasSafeZoneRenderer.display,
            airstrikeZones: planeBarn.airstrikeZoneContainer,
            mapSprites: this.mapSpriteBarn.container,
            border: new PIXI.Graphics(),
        };

        this.mapSprite.anchor.set(0.5, 0.5);
        this.container.addChild(this.mapSprite);
        this.container.addChild(this.display.gas);
        this.container.addChild(this.display.gasSafeZone);
        this.container.addChild(this.display.airstrikeZones);
        this.container.addChild(this.display.mapSprites);
        this.container.addChild(this.display.border);

        const minimapMargin = this.getMinimapMargin();
        const minimapSize = this.getMinimapSize();
        this.minimapPos = v2.create(
            minimapMargin + minimapSize / 2,
            game.m_camera.m_screenHeight - minimapSize / 2 - minimapMargin,
        );

        // the stylesheet's full width (it differs per layout)
        const healthBar = document.querySelector(".ui-team-member-health .ui-bar-inner");
        this.teamMemberHealthBarWidth = healthBar ? parseInt(getComputedStyle(healthBar).width) : 0;

        for (let i = 0; i < 4; i++) {
            this.teamSelectors.push({
                groupIdDisplayed: false,
                playerId: 0,
                prevHealth: 0,
                prevStatus: {
                    disconnected: false,
                    dead: false,
                    downed: false,
                    role: "",
                },
            });
        }
        this.init();
    }

    /** the touch interaction button (components/Hud.tsx) */
    onInteractionTouch() {
        this.interactionTouched = true;
    }

    /** the touch reload buttons (components/Hud.tsx) */
    onReloadTouch() {
        this.reloadTouched = true;
    }

    /** a left press on weapon slot 1 or 2 may start dragging it onto the other (mouse only) */
    onWeapMouseDown(e: MouseEvent, slot: number) {
        if (device.touch || e.button != 0) return;
        this.weapDraggedId = slot;
    }

    onWeapMouseMove(e: MouseEvent) {
        if (device.touch || !this.weapDraggedId || this.weapDropped) return;
        const dragging = this.weapDragging;
        this.weapDragging = true;
        setGameView((v) => {
            v.weaponDrag.slot = this.weapDraggedId;
            v.weaponDrag.dragging = true;
            // the slot follows the mouse from the second move on
            v.weaponDrag.moved = dragging;
            v.weaponDrag.left = e.pageX - 80;
            v.weaponDrag.top = e.pageY - 30;
        });
    }

    /** a left release over a weapon slot (`slot`, if 1 or 2) or anywhere else in the game UI */
    onWeapMouseUp(e: MouseEvent, hovered: boolean, slot?: number) {
        if (device.touch || e.button != 0 || !this.weapDraggedId) return;
        if (hovered && this.weapDraggedId != slot) {
            this.swapWeapSlots = true;
            this.weapDropped = true;
        }
        if (!this.swapWeapSlots) {
            this.resetWeapSlotStyling();
        }
    }

    resetWeapSlotStyling() {
        this.weapDraggedId = 0;
        this.weapDragging = false;
        this.weapDropped = false;
        setGameView((v) => {
            v.weaponDrag.slot = 0;
            v.weaponDrag.dragging = false;
            v.weaponDrag.moved = false;
        });
    }

    m_free() {
        this.gasRenderer.free();

        this.clearUI();

        document.removeEventListener("touchstart", this.onTouchScreen);

        // Reset team member health bar widths
        setGameView((v) => {
            for (const member of v.team) member.healthWidth = null;
        });

        this.inputBinds.menuHovered = false;

        if (!this.hudVisible) {
            this.cycleHud();
        }

        this.m_pieTimer.destroy();
        this.clearStatsElems();
        this.setRoleMenuActive(false);
        this.init();
    }

    init() {
        this.setMapHiddenDisplay("block");
        this.flairId = 0;
        setGameView((v) => {
            v.flair = "";
            v.alive.mapFaction = false;
        });
        this.clearStatsElems();
        this.setSpectating(false);
        this.updateSpectatorCountDisplay(true);
        this.resetWeapSlotStyling();
        this.dead = false;
    }

    /** `.js-ui-map-hidden` elements, plus `.js-ui-mobile-map-hidden` ones when given */
    setMapHiddenDisplay(display: "block" | "none", mobile = false) {
        setGameView((v) => {
            v.map.hidden = display;
            if (mobile) v.map.mobileHidden = display;
        });
    }

    onMapLoad(map: Map, camera: Camera) {
        this.resize(map, camera);
        const displayLeader = map.getMapDef().gameMode.killLeaderEnabled;

        setGameView((v) => {
            v.killLeaderEnabled = displayLeader;
        });

        if (!device.mobile) {
            setGameView((v) => {
                v.killfeedTop = displayLeader ? "60px" : "12px";
            });
        }
    }

    m_update(
        dt: number,
        player: Player,
        map: Map,
        gas: Gas,
        playerBarn: PlayerBarn,
        camera: Camera,
        teamMode: TeamMode,
        factionMode: boolean,
    ) {
        const localPlayer = player;

        if (this.weapsDirty) {
            this.resetWeapSlotStyling();
        }

        this.weapsDirty = false;
        this.mapIndicatorBarn.updateIndicatorPulses(dt);

        // Gas timer display
        const timeLeft = math.max(Math.floor(gas.duration * (1 - gas.circleT)), 0);
        const gasState = {
            mode: gas.mode,
            time: timeLeft,
        };
        if (this.gasState.mode != gasState.mode || this.gasState.time != gasState.time) {
            this.gasState = gasState;
            const minutes = Math.floor(this.gasState.time / 60);
            const seconds = this.gasState.time % 60;
            const strSeconds = `0${seconds}`.slice(-2);
            setGameView((v) => {
                v.map.gasMoving = gasState.mode == GasMode.Moving;
                v.map.gasTime = `${minutes}:${strSeconds}`;
            });
        }

        // Spectator count display
        this.spectatorCount = player.m_localData.m_spectatorCount;
        this.updateSpectatorCountDisplay(false);

        if (player.m_netData.m_dead && !this.dead) {
            this.dead = true;
            this.m_pieTimer.stop();
        }

        if (localPlayer.downed || this.dead) {
            this.resetWeapSlotStyling();
        }

        // Action pie timer
        if (
            this.actionSeq != player.m_action.seq
            && ((this.actionSeq = player.m_action.seq),
                this.m_pieTimer.stop(),
                player.m_action.type != Action.None && !this.displayingStats)
        ) {
            let desc = "";
            let actionTxt1 = "";
            let actionTxt2 = "";
            switch (player.m_action.type) {
                case Action.Reload:
                case Action.ReloadAlt:
                    if (GameObjectDefs.typeExists(player.m_action.item)) {
                        actionTxt1 = this.localization.translate("game-reloading");
                    }
                    break;
                case Action.UseItem:
                    if (GameObjectDefs.typeExists(player.m_action.item)) {
                        actionTxt1 = this.localization.translate("game-using");
                        actionTxt2 = this.localization.translate(
                            `game-${player.m_action.item}`,
                        );
                    }
                    break;
                case Action.Revive: {
                    const targetName = playerBarn.getPlayerInfo(
                        player.m_action.targetId,
                    ).name;
                    actionTxt1 = this.localization.translate("game-reviving");
                    actionTxt2 = localPlayer.downed ? "" : targetName;
                    break;
                }
            }

            if (actionTxt1 != "" || actionTxt2 != "") {
                // Change subject/verb/object order
                if (this.localization.translate("word-order") == "svo") {
                    desc += actionTxt1 || "";
                    desc += actionTxt2 ? ` ${actionTxt2}` : "";
                } else if (this.localization.translate("word-order") == "sov") {
                    desc += actionTxt2 ? `${actionTxt2} ` : "";
                    desc += actionTxt1 ? ` ${actionTxt1}` : "";
                }
                this.m_pieTimer.start(
                    desc,
                    player.m_action.time,
                    player.m_action.duration,
                );
            }
        }

        if (!this.bigmapDisplayed) {
            this.mapSprite.x = this.minimapPos.x
                + this.mapSprite.width / 2
                - (player.m_visualPos.x / map.width) * this.mapSprite.width;
            this.mapSprite.y = this.minimapPos.y
                - this.mapSprite.height / 2
                + (player.m_visualPos.y / map.height) * this.mapSprite.height;
        }

        const camExtents = v2.create(
            (camera.m_screenWidth * 0.5) / camera.m_z(),
            (camera.m_screenHeight * 0.5) / camera.m_z(),
        );
        const camAabb = {
            min: v2.sub(camera.m_pos, camExtents),
            max: v2.add(camera.m_pos, camExtents),
        };

        // Update team UI elements
        const groupId = playerBarn.getPlayerInfo(player.__id).groupId;
        const groupInfo = playerBarn.getGroupInfo(groupId);

        const layoutSm = device.uiLayout == device.UiLayout.Sm;
        const groupPlayerCount = groupInfo.playerIds.length;

        for (let i = 0; i < groupPlayerCount; i++) {
            const teamElems = this.teamSelectors[i];
            const playerId = groupInfo.playerIds[i];
            const playerInfo = playerBarn.getPlayerInfo(playerId);
            const isLocalPlayer = playerId == localPlayer.__id;
            const playerStatus = playerBarn.getPlayerStatus(playerId);
            if (playerStatus && teamMode > TeamMode.Solo) {
                if (!teamElems.groupIdDisplayed) {
                    setGameView((v) => {
                        v.team[i].displayed = true;
                    });
                    teamElems.groupIdDisplayed = true;
                }

                // Team UI
                this.updateTeam(
                    i,
                    playerInfo.name,
                    playerStatus.health!,
                    {
                        disconnected: playerStatus.disconnected,
                        dead: playerStatus.dead,
                        downed: playerStatus.downed,
                        role: playerStatus.role,
                    },
                    playerInfo.playerId,
                );

                // Team indicator at the screen edge (per frame)
                let indicator: TeamMemberView["indicator"] = null;
                if (!isLocalPlayer && !factionMode && !playerStatus.dead) {
                    const playerPos = playerStatus.pos;
                    const dir = v2.normalizeSafe(v2.sub(playerPos, camera.m_pos), v2.create(1, 0));
                    const edge = coldet.intersectRayAabb(camera.m_pos, dir, camAabb.min, camAabb.max)!;
                    // fixme: find actual cause for the indicator rotation facing backwards
                    const rot = Math.atan2(dir.y, -dir.x) - Math.PI * 0.5;
                    const screenEdge = camera.m_pointToScreen(edge);
                    const onscreen = coldet.testCircleAabb(
                        playerPos,
                        GameConfig.player.radius,
                        camAabb.min,
                        camAabb.max,
                    );
                    if (!onscreen) {
                        const off = layoutSm ? 16 : 32;
                        indicator = {
                            left: math.clamp(screenEdge.x, off, camera.m_screenWidth - off),
                            top: math.clamp(screenEdge.y, off, camera.m_screenHeight - off),
                            transform: `translate(-50%, -50%) rotate(${rot}rad)${layoutSm ? " scale(0.5)" : ""}`,
                        };
                    }
                }
                this.setTeamIndicator(i, indicator);
            }
        }
        // Hide unused elements
        for (let i = groupPlayerCount; i < this.teamSelectors.length; i++) {
            const teamElems = this.teamSelectors[i];
            this.setTeamIndicator(i, null);
            if (teamElems.groupIdDisplayed) {
                setGameView((v) => {
                    v.team[i].displayed = false;
                });
                teamElems.groupIdDisplayed = false;
            }
        }

        // Faction specific rendering
        if (map.factionMode) {
            const localPlayerInfo = playerBarn.getPlayerInfo(localPlayer.__id);
            if (this.flairId != localPlayerInfo.teamId) {
                this.flairId = localPlayerInfo.teamId;
                // Assume red or blue for now
                setGameView((v) => {
                    v.flair = this.flairId == GameConfig.FactionTeam.Red ? "red" : "blue";
                });
            }
        }

        // Set the spectate options height if player count changed
        if (
            teamMode > TeamMode.Solo
            && this.groupPlayerCount != groupPlayerCount
            && device.uiLayout == device.UiLayout.Lg
        ) {
            this.groupPlayerCount = groupPlayerCount;
            setGameView((v) => {
                v.spectate.optionsTop = this.groupPlayerCount * this.teamMemberHeight + 12;
            });
        } else if (teamMode == TeamMode.Solo) {
            setGameView((v) => {
                v.spectate.optionsTop = 12;
            });
        }
        this.updatePlayerMapSprites(player, playerBarn, map);
        this.mapSpriteBarn.update(dt, this, map);
        this.m_pieTimer.update(dt, camera);

        // Update role selection menu
        if (this.roleMenuActive) {
            this.roleMenuTicker -= dt;

            const seconds = Math.ceil(this.roleMenuTicker);
            setGameView((v) => {
                v.role.seconds = seconds;
            });
            if (
                !this.roleMenuInst
                && this.audioManager.isSoundLoaded("ambient_lab_01", "ambient")
            ) {
                this.roleMenuInst = this.audioManager.playSound("ambient_lab_01", {
                    channel: "ambient",
                });
            }
            if (this.roleMenuTicker <= 0) {
                this.confirmRole();
            }
        }
    }

    updatePlayerMapSprites(activePlayer: Player, playerBarn: PlayerBarn, map: Map) {
        const activePlayerInfo = playerBarn.getPlayerInfo(activePlayer.__id);

        let spriteIdx = 0;
        const addSprite = (
            pos: Vec2,
            scale: number,
            alpha: number,
            visible: boolean,
            zOrder: number,
            texture: string,
            tint: number,
        ) => {
            if (spriteIdx >= this.playerMapSprites.length) {
                const m = this.mapSpriteBarn.addSprite();
                this.playerMapSprites.push(m);
            }
            const mapSprite = this.playerMapSprites[spriteIdx++];
            mapSprite.pos = v2.copy(pos);
            mapSprite.scale = scale;
            mapSprite.alpha = alpha;
            mapSprite.visible = visible;
            mapSprite.zOrder = zOrder;
            mapSprite.sprite.texture = PIXI.Texture.from(texture);
            mapSprite.sprite.tint = tint;
        };
        const keys = Object.keys(playerBarn.playerStatus);
        for (let i = 0; i < keys.length; i++) {
            const playerStatus = playerBarn.playerStatus[keys[i] as unknown as number];
            const playerId = playerStatus.playerId!;
            const playerInfo = playerBarn.getPlayerInfo(playerId);
            const sameGroup = playerInfo.groupId == activePlayerInfo.groupId;
            let zOrder = 65535 + playerId * 2;
            if (playerId == activePlayerInfo.playerId) {
                zOrder += 65535 * 2;
            }
            const roleDef = GameObjectDefs.typeToDefSafe(playerStatus.role) as RoleDef | undefined;
            const customMapIcon = roleDef?.mapIcon;
            if (customMapIcon) {
                zOrder += 65535;
            }

            // Add the inner dot sprite
            let texture = "player-map-inner.img";
            if (customMapIcon && roleDef.mapIcon?.alive) {
                texture = roleDef.mapIcon.alive;
            }
            if (playerStatus.dead) {
                texture = "skull-outlined.img";
                if (roleDef?.mapIcon?.dead) {
                    texture = roleDef.mapIcon!.dead;
                }
            } else if (playerStatus.downed) {
                texture = sameGroup ? "player-group-downed.img" : "player-map-downed.img";
            }
            let tint = sameGroup
                ? playerBarn.getGroupColor(playerId)
                : playerBarn.getTeamColor(playerInfo.teamId);
            if (map.factionMode && customMapIcon) {
                tint = playerBarn.getTeamColor(playerInfo.teamId);
            }
            const dotScale = device.uiLayout == device.UiLayout.Sm ? 0.15 : 0.2;
            let scale = dotScale;

            scale = sameGroup
                ? playerStatus.dead
                    ? dotScale * 1.5
                    : customMapIcon
                    ? dotScale * 1.25
                    : dotScale * 1
                : playerStatus.dead || playerStatus.downed || customMapIcon
                ? dotScale * 1.25
                : dotScale * 0.75;

            addSprite(
                playerStatus.pos,
                scale,
                playerStatus.minimapAlpha!,
                playerStatus.minimapVisible!,
                zOrder,
                texture,
                tint,
            );

            // Add an outer sprite if this player is in our group
            if (sameGroup) {
                const scale = device.uiLayout == device.UiLayout.Sm ? 0.25 : 0.3;
                const visible = playerStatus.minimapVisible! && !customMapIcon;

                addSprite(
                    playerStatus.pos,
                    scale,
                    playerStatus.minimapAlpha!,
                    visible,
                    zOrder - 1,
                    "player-map-outer.img",
                    0xffffff,
                );
            }
        }

        // Hide any sprites that weren't used
        for (let i = this.playerMapSprites.length - 1; i >= spriteIdx; i--) {
            this.playerMapSprites[i].visible = false;
        }
    }

    getMinimapMargin() {
        if (device.uiLayout == device.UiLayout.Sm) {
            return 4;
        }
        return 16;
    }

    getMinimapSize() {
        if (device.uiLayout == device.UiLayout.Sm) {
            return 192;
        }
        return 256;
    }

    getMinimapBorderWidth() {
        if (device.uiLayout == device.UiLayout.Sm) {
            return 1;
        }
        return 4;
    }

    createPing(
        pingType: string,
        pos: Vec2,
        playerId: number,
        activePlayerId: number,
        playerBarn: PlayerBarn,
    ) {
        const pingDef = PingDefs[pingType];
        if (pingDef) {
            const createPingSprite = (scale: number, tint: number) => {
                const s = this.mapSpriteBarn.addSprite();
                s.pos = v2.copy(pos);
                s.scale = scale;
                s.lifetime = pingDef.mapLife;
                s.pulse = false;
                s.zOrder = 100;
                s.sprite.texture = PIXI.Texture.from(pingDef.mapTexture);
                s.sprite.tint = tint;
                return s;
            };
            const createPulseSprite = (tint: number) => {
                const s = this.mapSpriteBarn.addSprite();
                s.pos = v2.copy(pos);
                s.scale = 0;
                s.lifetime = pingDef.pingLife;
                s.pulse = true;
                s.zOrder = 99;
                s.sprite.texture = PIXI.Texture.from("ping-map-pulse.img");
                s.sprite.tint = tint;
                return s;
            };
            if (pingDef.mapEvent) {
                // Map-event pings free themselves after they are finished;
                // there's no limit to the number that an occur simultaneously.
                const scale = (device.uiLayout == device.UiLayout.Sm ? 0.15 : 0.2) * 1.5;
                createPingSprite(scale, pingDef.tint).release();

                createPulseSprite(pingDef.tint).release();
            } else {
                //
                // Player pings
                //

                // Figure out which tint to use by determining if this player
                // is in our group; if they are use their group color.
                // Otherwise, use their team color.
                // Faction leaders get a special color.
                let tint = 0xffffff;
                const activePlayerInfo = playerBarn.getPlayerInfo(activePlayerId);
                const playerInfo = playerBarn.getPlayerInfo(playerId);
                const playerStatus = playerBarn.getPlayerStatus(playerId);
                if (activePlayerInfo && playerInfo && playerStatus) {
                    if (playerStatus.role == "leader") {
                        // Use a special color if they are a faction leader
                        tint = 0x00ff00;
                    } else if (activePlayerInfo.groupId == playerInfo.groupId) {
                        // Use group color
                        tint = playerBarn.getGroupColor(playerId);
                    } else {
                        // Use the team color
                        tint = playerBarn.getTeamColor(playerInfo.teamId);
                    }
                }

                // Store ping sprites per-player so we can cancel the most recent
                if (!this.playerPingSprites[playerId]) {
                    this.playerPingSprites[playerId] = [];
                }

                // Free the most recently created ping sprites
                const pingSprites = this.playerPingSprites[playerId];
                for (let i = 0; i < pingSprites.length; i++) {
                    pingSprites[i].free();
                }

                // Create new ping sprites for this player
                const scale = device.uiLayout == device.UiLayout.Sm ? 0.15 : 0.2;
                const pingSprite = createPingSprite(scale, tint);
                const pulseSprite = createPulseSprite(tint);
                pingSprites.push(pingSprite);
                pingSprites.push(pulseSprite);
            }
        }
    }

    /* not used? */
    updateMapSprite(
        mapSprite: any,
        sprite: PIXI.Sprite,
        spriteVisible: boolean,
        dt: number,
    ) {
        if (mapSprite.displayed) {
            if (mapSprite.life != undefined) {
                mapSprite.life -= dt;
                mapSprite.displayed = mapSprite.life > 0;
                // Quickfades
                if (mapSprite.maxLife - mapSprite.life < 0.1) {
                    sprite.alpha = (mapSprite.maxLife - mapSprite.life) / 0.1;
                } else if (mapSprite.life < 0.5) {
                    sprite.alpha = math.max(mapSprite.life / 0.5, 0);
                } else {
                    sprite.alpha = 1;
                }
            }
            if (mapSprite.pulse && mapSprite.displayed) {
                mapSprite.scale = mapSprite.scale + dt / 2.5;
                sprite.scale.set(mapSprite.scale, mapSprite.scale);
            }
            sprite.visible = spriteVisible && sprite.alpha > 0;
        }
    }

    updateMapIndicators(data: MapIndicator[]) {
        this.mapIndicatorBarn.updateIndicatorData(data);
    }

    getMapPosFromWorldPos(worldPos: Vec2, map: Map) {
        const xPos = this.mapSprite.x
            - this.mapSprite.width / 2
            + (worldPos.x / map.width) * this.mapSprite.width;
        const yPos = this.mapSprite.y
            + this.mapSprite.height / 2
            - (worldPos.y / map.height) * this.mapSprite.height;
        return v2.create(xPos, yPos);
    }

    getWorldPosFromMapPos(screenPos: Vec2, map: Map, camera: Camera): Vec2 | undefined {
        let insideMap = false;
        if (this.bigmapDisplayed) {
            const xBuffer = (camera.m_screenWidth - this.mapSprite.width) / 2;
            let yBuffer = (camera.m_screenHeight - this.mapSprite.height) / 2;
            if (device.uiLayout == device.UiLayout.Sm && !device.isLandscape) {
                yBuffer = 0;
            }
            insideMap = screenPos.x > xBuffer
                && screenPos.x < camera.m_screenWidth - xBuffer
                && screenPos.y > yBuffer
                && screenPos.y < camera.m_screenHeight - yBuffer;
        } else if (this.minimapDisplayed) {
            const thisMinimapSize = this.getMinimapSize();
            const thisMinimapMargin = this.getMinimapMargin();
            const minimapSize = thisMinimapSize * this.screenScaleFactor;
            const halfSize = (minimapSize + thisMinimapMargin) * 0.5;
            insideMap = screenPos.x > this.minimapPos.x - halfSize
                && screenPos.x < this.minimapPos.x + halfSize
                && screenPos.y > this.minimapPos.y - halfSize
                && screenPos.y < this.minimapPos.y + halfSize;
        }
        if (insideMap) {
            const mapOrigin = v2.create(
                this.mapSprite.x - this.mapSprite.width / 2,
                this.mapSprite.y + this.mapSprite.height / 2,
            );
            const xWorldPos = ((screenPos.x - mapOrigin.x) / this.mapSprite.width) * map.width;
            const yWorldPos = ((mapOrigin.y - screenPos.y) / this.mapSprite.height) * map.height;
            return v2.create(xWorldPos, yWorldPos);
        }
        return undefined;
    }

    setLocalKills(kills: number) {
        setGameView((v) => {
            v.kills = kills;
        });
    }

    clearUI() {
        this.m_pieTimer.stop();
        this.displayMapLarge(true);
        this.displayMiniMap();
        this.clearStatsElems();
        this.clearTeamUI();
        this.toggleEscMenu(true);
        this.toggleLocalStats(true);
        this.visibilityMode = 0;
        this.spectatorCount = 0;
        this.setLocalKills(0);
    }

    beginSpectating() {
        this.specAction = SpectateAction.Begin;
    }

    spectateNext() {
        this.specAction = SpectateAction.Next;
    }

    spectatePrev() {
        this.specAction = SpectateAction.Prev;
    }

    hideStats() {
        this.displayingStats = false;
        setGameView((v) => {
            v.stats.open = false;
            v.stats.contents = false;
        });
    }

    /** translation key of the death screen's rank label */
    teamModeToL10n(teamMode: TeamMode) {
        const l10nMap = {
            unknown: "game-rank",
            [TeamMode.Solo]: "game-solo-rank",
            [TeamMode.Duo]: "game-duo-rank",
            [TeamMode.Squad]: "game-squad-rank",
        };
        return l10nMap[teamMode] || l10nMap.unknown;
    }

    getTitleVictoryText(spectatingAnotherTeam: boolean, gameMode: MapDef["gameMode"]) {
        if (spectatingAnotherTeam) {
            return `${this.spectatedPlayerName} ${
                this.localization.translate(
                    "game-won-the-game",
                )
            }`;
        }
        let chickenTxt = "game-chicken";
        if (gameMode.turkeyMode) {
            chickenTxt = "game-turkey";
        }
        return this.localization.translate(chickenTxt);
    }

    getTitleDefeatText(teamMode: TeamMode, spectatingAnotherTeam: boolean) {
        if (spectatingAnotherTeam) {
            return `${this.spectatedPlayerName} ${
                this.localization.translate(
                    "game-player-died",
                )
            }.`;
        }
        if (teamMode > TeamMode.Solo) {
            return this.localization.translate("game-team-eliminated");
        }
        return `${
            this.localization.translate(
                "game-You",
            )
        } ${this.localization.translate("game-you-died")}.`;
    }

    quitGame() {
        this.game.m_gameOver = true;
        this.game.onQuit();
    }

    /** the in-game menu's quit button: the pass refreshes after the game */
    quitToMenu() {
        this.game.m_updatePass = true;
        this.game.m_updatePassDelay = 1;
        this.quitGame();
    }

    toggleFullScreen() {
        helpers.toggleFullScreen();
        this.toggleEscMenu();
    }

    /** the map expand buttons */
    onMapExpand() {
        if (device.touch) {
            if (!this.bigmapDisplayed) {
                this.displayMapLarge();
            }
        } else if (device.uiLayout == device.UiLayout.Lg) {
            this.displayMapLarge(this.bigmapDisplayed);
        }
    }

    /** the pointer is over the escape menu: the game ignores clicks */
    setMenuHovered(hovered: boolean) {
        if (this.escMenuDisplayed) {
            this.inputBinds.menuHovered = hovered;
        }
    }

    showStats(
        playerStats: Array<PlayerStatsMsg["playerStats"]>,
        teamId: number,
        teamRank: number,
        winningTeamId: number,
        gameOver: boolean,
        localTeamId: number,
        teamMode: TeamMode,
        spectating: boolean,
        playerBarn: PlayerBarn,
        _audioManager: AudioManager,
        map: Map,
        ui2: UiManager2,
    ) {
        // If we're spectating a team that's not our own, and the game isn't over yet,
        // don't display the stats screen again.
        if (!spectating || teamId == localTeamId || gameOver) {
            this.toggleEscMenu(true);
            this.displayingStats = true;
            this.m_pieTimer.stop();
            this.displayMapLarge(true);
            this.clearStatsElems();
            this.setSpectating(false, teamMode);

            const victory = localTeamId == winningTeamId;
            const statsDelay = victory ? 1750 : 2500;

            setTimeout(() => ui2.hideKillMessage(), Math.max(statsDelay - 150, 0));

            const isLocalTeamWinner = localTeamId == winningTeamId || (spectating && winningTeamId == teamId);
            const spectatingAnotherTeam = spectating && localTeamId != teamId;
            const title = isLocalTeamWinner
                ? this.getTitleVictoryText(
                    spectatingAnotherTeam,
                    map.getMapDef().gameMode,
                )
                : this.getTitleDefeatText(teamMode, spectatingAnotherTeam);
            let teamKills = 0;
            for (let i = 0; i < playerStats.length; i++) {
                teamKills += playerStats[i].kills;
            }
            const factionMode = !!map.getMapDef().gameMode.factionMode;

            const layoutLg = device.uiLayout != device.UiLayout.Sm || device.tablet;
            const columnWidth = layoutLg ? 250 : 125;
            let left = 0;
            left -= ((playerStats.length - 1) * columnWidth) / 2;
            left -= (playerStats.length - 1) * 10;
            const players: StatsPlayerView[] = [];
            for (let i = 0; i < playerStats.length; i++) {
                const stats = playerStats[i];
                const playerInfo = playerBarn.getPlayerInfo(stats.playerId);
                let badge = "";
                if (factionMode && gameOver) {
                    switch (i) {
                        case 1:
                            badge = "ui-stats-info-player-red-leader";
                            break;
                        case 2:
                            badge = "ui-stats-info-player-blue-leader";
                            break;
                        case 3:
                            badge = playerInfo.teamId == GameConfig.FactionTeam.Red
                                ? "ui-stats-info-player-red-ribbon"
                                : "ui-stats-info-player-blue-ribbon";
                    }
                }
                players.push({
                    playerId: stats.playerId,
                    name: playerInfo.name,
                    dead: stats.dead,
                    left,
                    kills: stats.kills,
                    damageDealt: stats.damageDealt,
                    damageTaken: stats.damageTaken,
                    timeAlive: stats.timeAlive,
                    badge,
                });
                left += 10;
            }
            const alive = this.playersAliveCounter + this.playersAliveRedCounter + this.playersAliveBlueCounter;
            const spectatable = !gameOver && alive !== 0;

            setGameView((v) => {
                const s = v.stats;
                s.open = true;
                s.contents = true;
                s.seq = ++statsSeq;
                s.delay = statsDelay;
                s.teamAd = false;
                s.filled = true;
                s.title = title;
                const overview = s.overview;
                if (factionMode) {
                    overview.kind = "faction";
                    overview.red = this.playersAliveRedCounter;
                    overview.blue = this.playersAliveBlueCounter;
                } else {
                    overview.kind = teamMode == TeamMode.Solo ? "solo" : "team";
                    overview.rankL10n = this.teamModeToL10n(teamMode);
                    overview.rank = teamRank;
                    overview.kills = teamKills;
                }
                reconcile(players, "playerId")(s.players);
                s.restartWidth = spectatable ? null : layoutLg ? 225 : 130;
                s.restartLeft = spectatable ? (layoutLg ? -72 : -46) : null;
                s.spectateButton = spectatable;
            });
        }
    }

    clearStatsElems() {
        setGameView((v) => {
            const s = v.stats;
            s.open = false;
            s.contents = false;
            s.teamAd = false;
            s.filled = false;
            s.title = "";
            reconcile([], "playerId")(s.players);
            s.restartWidth = null;
            s.restartLeft = null;
            s.spectateButton = false;
        });
    }

    showTeamAd(playerStats: PlayerStatsMsg["playerStats"], _ui2Manager: unknown) {
        this.toggleEscMenu(true);
        this.displayMapLarge(true);
        this.clearStatsElems();
        this.m_pieTimer.stop();
        this.displayingStats = true;
        const title = `${this.localization.translate("game-You")} ${this.localization.translate("game-you-died")}.`;
        setGameView((v) => {
            const s = v.stats;
            s.open = true;
            s.contents = true;
            s.seq = ++statsSeq;
            s.delay = 2500;
            // no logo, contents higher up, no player columns
            s.teamAd = true;
            s.filled = true;
            s.title = title;
            s.overview.kind = "kills";
            s.overview.kills = playerStats.kills;
            s.restartLeft = device.uiLayout != device.UiLayout.Sm || device.tablet ? -72 : -46;
            s.spectateButton = true;
        });
    }

    setSpectateTarget(
        targetId: number,
        localId: number,
        teamMode: TeamMode,
        playerBarn: PlayerBarn,
    ) {
        if (targetId != this.spectatedPlayerId) {
            this.setSpectating(true, teamMode);
            const name = playerBarn.getPlayerName(targetId, localId, false);
            this.spectatedPlayerId = targetId;
            this.spectatedPlayerName = name;
            setGameView((v) => {
                v.spectate.name = name;
            });
            this.actionSeq = -1;
            this.m_pieTimer.stop();
        }
    }

    setSpectating(spectating: boolean, teamMode?: TeamMode) {
        if (this.spectating != spectating) {
            this.spectating = spectating;
            setGameView((v) => {
                v.zoomHover = !spectating;
            });
            if (this.spectating) {
                const hideSpec = teamMode == TeamMode.Solo;
                setGameView((v) => {
                    v.spectate.active = true;
                    v.spectate.teamButtons = !hideSpec;
                });
                this.hideStats();
            } else {
                setGameView((v) => {
                    v.spectate.active = false;
                });
            }
        }
    }

    setLocalStats(stats: PlayerStatsMsg["playerStats"]) {
        setGameView((v) => {
            const local = v.spectate.stats;
            local.kills = stats.kills;
            local.damageDealt = stats.damageDealt;
            local.damageTaken = stats.damageTaken;
            local.timeAlive = stats.timeAlive;
            v.spectate.hasStats = true;
        });
    }

    toggleLocalStats(hide = false) {
        this.localStatsDisplayed = !this.localStatsDisplayed && !hide;
        setGameView((v) => {
            v.spectate.statsShown = this.localStatsDisplayed;
        });
    }

    updatePlayersAlive(alive: number) {
        this.playersAliveCounter = alive;
        setGameView((v) => {
            v.alive.count = alive;
            v.alive.leaderboardFaction = false;
        });
    }

    updatePlayersAliveRed(alive: number) {
        this.playersAliveRedCounter = alive;
        setGameView((v) => {
            v.alive.red = alive;
            v.alive.leaderboardFaction = true;
            v.alive.mapFaction = true;
        });
    }

    updatePlayersAliveBlue(alive: number) {
        this.playersAliveBlueCounter = alive;
        setGameView((v) => {
            v.alive.blue = alive;
            v.alive.leaderboardFaction = true;
            v.alive.mapFaction = true;
        });
    }

    updateKillLeader(
        playerId: number,
        playerName: string,
        kills: number,
        gameMode: MapDef["gameMode"],
    ) {
        setGameView((v) => {
            const leader = v.killLeader;
            leader.playerId = playerId;
            leader.name = playerName;
            leader.kills = kills;
            leader.hunted = !!gameMode?.sniperMode;
        });
    }

    displayMapLarge(clear?: boolean) {
        this.bigmapDisplayed = !clear && !this.bigmapDisplayed;
        if (this.bigmapDisplayed) {
            this.container.alpha = 1;
        } else {
            this.container.alpha = this.minimapDisplayed ? 1 : 0;
        }
        this.setMapHiddenDisplay(this.bigmapDisplayed ? "none" : "block", device.uiLayout == device.UiLayout.Sm);
        const mapShow = this.bigmapDisplayed ? "block" : "none";
        setGameView((v) => {
            v.map.bigmap = this.bigmapDisplayed;
            v.map.show = mapShow;
        });
        this.updateSpectatorCountDisplay(true);
        this.redraw(this.game.m_camera);
    }

    updateSpectatorCountDisplay(dirty: boolean) {
        const displayCounter = !this.bigmapDisplayed && this.spectatorCount > 0;
        dirty = dirty
            || (this.spectatorCount > 0 && !this.spectatorCounterDisplayed)
            || (this.spectatorCount == 0 && this.spectatorCounterDisplayed);

        if (this.spectatorCount != this.prevSpectatorCount) {
            const text = String(this.spectatorCount);
            setGameView((v) => {
                v.map.spectators.text = text;
            });
            this.prevSpectatorCount = this.spectatorCount;
        }
        if (dirty) {
            setGameView((v) => {
                v.map.spectators.displayed = displayCounter;
            });
            this.spectatorCounterDisplayed = displayCounter;
        }
    }

    toggleMiniMap() {
        if (this.minimapDisplayed) {
            this.hideMiniMap();
        } else {
            this.displayMiniMap();
        }
    }

    cycleVisibilityMode() {
        if (!this.bigmapDisplayed) {
            switch (this.visibilityMode) {
                case 0:
                    this.hideMiniMap();
                    this.visibilityMode = 1;
                    break;
                case 1:
                    this.displayMiniMap();
                    this.visibilityMode = 0;
            }
        }
    }

    cycleHud() {
        this.hudVisible = !this.hudVisible;
        setGameView((v) => {
            v.hidden = !this.hudVisible;
        });
        if (this.hudVisible) this.displayMiniMap();
        else this.hideMiniMap();
    }

    hideMiniMap() {
        if (!this.bigmapDisplayed) {
            this.minimapDisplayed = false;
            this.container.alpha = 0;
            setGameView((v) => {
                v.map.infoBottom = "auto";
                v.map.spectators.bottom = 6;
                v.map.spectators.left = 98;
            });
        }
    }

    displayMiniMap() {
        if (!this.bigmapDisplayed) {
            const layoutSm = device.uiLayout == device.UiLayout.Sm;
            this.minimapDisplayed = true;
            this.container.alpha = 1;
            setGameView((v) => {
                v.map.infoBottom = `${this.mapInfoBottom}px`;
                v.map.spectators.bottom = layoutSm ? 0 : 218;
                v.map.spectators.left = layoutSm ? 0 : 6;
            });
        }
    }

    displayAnnouncement(message: string) {
        if (message) {
            setGameView((v) => {
                v.announcement.text = message;
                v.announcement.seq = ++announcementSeq;
            });
        }
    }

    displayGasAnnouncement(type: GasMode, timeLeft: number) {
        let message = "";
        switch (type) {
            case GasMode.Waiting: {
                message = this.localization.translate("game-red-zone-advances");
                const minutes = Math.floor(timeLeft / 60);
                const seconds = timeLeft - minutes * 60;
                message += minutes > 1
                    ? ` ${minutes} ${this.localization.translate("game-minutes")}`
                    : "";
                message += minutes == 1
                    ? ` ${minutes} ${this.localization.translate("game-minute")}`
                    : "";
                message += seconds > 0
                    ? ` ${Math.floor(seconds)} ${
                        this.localization.translate(
                            "game-seconds",
                        )
                    }`
                    : "";
                break;
            }
            case GasMode.Moving:
                message = this.localization.translate("game-red-zone-advancing");
                break;
        }
        this.displayAnnouncement(message);
    }

    setWaitingForPlayers(waiting: boolean) {
        this.waitingForPlayers = waiting;
        setGameView((v) => {
            v.waiting = waiting;
        });
    }

    m_render(playerPos: Vec2, gas: Gas, map: Map, planeBarn: PlaneBarn) {
        // Gas
        const circle = gas.getCircle(1);
        const gasPos = this.getMapPosFromWorldPos(circle.pos, map);
        const gasEdge = this.getMapPosFromWorldPos(
            v2.add(circle.pos, v2.create(circle.rad, 0)),
            map,
        );
        const gasRad = v2.length(v2.sub(gasEdge, gasPos));
        this.gasRenderer.render(gasPos, gasRad, gas.isActive());

        // Gas safe zone
        const circleSafe = gas.circleNew;
        const safePos = this.getMapPosFromWorldPos(circleSafe.pos, map);
        const safeEdge = this.getMapPosFromWorldPos(
            v2.add(circleSafe.pos, v2.create(circleSafe.rad, 0)),
            map,
        );
        const safeRad = v2.length(v2.sub(safeEdge, safePos));
        const playerMapPos = this.getMapPosFromWorldPos(playerPos, map);
        const drawCircle = gas.isActive();
        const drawLine = gas.isActive() && !this.bigmapDisplayed;
        this.gasSafeZoneRenderer.render(
            safePos,
            safeRad,
            playerMapPos,
            drawCircle,
            drawLine,
        );

        planeBarn.renderAirstrikeZones(this, map);
    }

    /** a health bar's width, color (null: unchanged) and danger pulse */
    getHealthBarStyle(
        innerWidth: number,
        status: {
            health: number;
            dead: boolean;
            downed: boolean;
        },
    ) {
        const healthBarWidth = innerWidth;
        let uiHealth = status.health * 0.01 * healthBarWidth;
        uiHealth = status.dead ? 0 : math.max(uiHealth, 1);

        let color: string | null = null;
        const val = status.health;
        let l = this.healthRed;
        let c = this.healthDarkpink;
        if (val > 25) {
            if (status.downed) {
                color = "red";
            } else {
                if (math.eqAbs(val, 100, 0.2)) {
                    l = this.healthGrey;
                    c = this.healthGrey;
                } else if (math.eqAbs(val, 75, 0.2) || val >= 75) {
                    l = this.healthWhite;
                    c = this.healthWhite;
                } else {
                    l = this.healthDarkpink;
                    c = this.healthLightpink;
                }
                const m = l.getColors();
                const p = c.getColors();
                const h = Interpolate(m.r, p.r, 45, val);
                const d = Interpolate(m.g, p.g, 45, val);
                const u = Interpolate(m.b, p.b, 45, val);
                color = `rgba(${h},${d},${u},1)`;
            }
        }
        return { width: uiHealth, color, danger: val <= 25 };
    }

    updateTeam(
        slotIdx: number,
        name: string,
        health: number,
        status: PrevStatus,
        playerId: number,
    ) {
        const selector = this.teamSelectors[slotIdx];
        const prevHealth = selector.prevHealth;
        const prevStatus = selector.prevStatus;

        const statusChange = status.dead != prevStatus.dead
            || status.disconnected != prevStatus.disconnected
            || status.downed != prevStatus.downed
            || status.role != prevStatus.role;
        if (
            selector.playerId != playerId
            || health != prevHealth
            || statusChange
        ) {
            selector.playerId = playerId;
            const bar = this.getHealthBarStyle(this.teamMemberHealthBarWidth, {
                health,
                dead: status.dead,
                downed: status.downed,
            });
            let memberStatus: TeamMemberStatus = "";
            if (status.disconnected) {
                memberStatus = "disconnected";
            } else if (status.dead) {
                memberStatus = "dead";
            } else if (status.downed) {
                memberStatus = "downed";
            }
            setGameView((v) => {
                const member = v.team[slotIdx];
                member.name = name;
                member.healthWidth = bar.width;
                if (bar.color !== null) member.healthColor = bar.color;
                member.healthDanger = bar.danger;
                if (statusChange) {
                    member.status = memberStatus;
                    member.nameOpacity = status.disconnected || status.dead ? 0.3 : 1;
                }
                member.displayed = true;
            });
            selector.prevStatus = status;
            selector.prevHealth = health;
        }
    }

    /** a teammate's marker at the screen edge; null hides it */
    setTeamIndicator(slot: number, indicator: TeamMemberView["indicator"]) {
        setGameView((v) => {
            const member = v.team[slot];
            if (!indicator || !member.indicator) member.indicator = indicator;
            else Object.assign(member.indicator, indicator);
        });
    }

    clearTeamUI() {
        setGameView((v) => {
            for (const member of v.team) {
                member.displayed = false;
                member.nameOpacity = null;
                member.status = "";
                member.indicator = null;
            }
        });
        this.teamSelectors = [];
    }

    resize(map: Map, camera: Camera) {
        this.screenScaleFactor = device.uiLayout == device.UiLayout.Sm
            ? 0.5626
            : math.min(
                1,
                math.clamp(camera.m_screenWidth / 1280, 0.75, 1)
                    * math.clamp(camera.m_screenHeight / 1024, 0.75, 1),
            );
        this.m_pieTimer.resize(this.touch, this.screenScaleFactor);

        this.gasRenderer.resize();

        this.mapSprite.texture = map.getMapTexture()!;

        const roleMenuScale = math.min(
            1,
            math.min(camera.m_screenWidth / 1200, camera.m_screenHeight / 900),
        );

        setGameView((v) => {
            v.role.scale = roleMenuScale;
        });

        this.redraw(camera);
    }

    redraw(camera: Camera) {
        const screenWidth = camera.m_screenWidth;
        const screenHeight = camera.m_screenHeight;

        const thisMinimapMargin = this.getMinimapMargin();

        let thisMinimapMarginXAdjust = 0;
        let thisMinimapMarginYAdjust = 0;

        // Squeeze in thisMinimapMarginXAdjust on iPhoneX+
        if (device.model == "iphonex") {
            if (device.isLandscape) {
                thisMinimapMarginXAdjust += 28;
            } else {
                thisMinimapMarginYAdjust += 32;
            }
        }
        const thisMinimapSize = this.getMinimapSize();
        const thisMinimapBorderWidth = this.getMinimapBorderWidth();
        const layoutSm = device.uiLayout == device.UiLayout.Sm;

        this.display.border.clear();
        this.container.mask?.clear();

        if (this.bigmapDisplayed) {
            const smallestDim = math.min(screenWidth, screenHeight);
            this.mapSprite.width = smallestDim;
            this.mapSprite.height = smallestDim;
            this.mapSprite.x = screenWidth / 2;
            this.mapSprite.y = screenHeight / 2;
            this.mapSprite.alpha = 1;
            this.container.mask.beginFill(0xffffff, 1);
            this.container.mask.drawRect(
                this.mapSprite.x - this.mapSprite.width / 2,
                this.mapSprite.y - this.mapSprite.height / 2,
                this.mapSprite.width,
                this.mapSprite.height,
            );
            this.container.mask.endFill();
            if (device.touch) {
                setGameView((v) => {
                    v.map.collisionWidth = screenHeight;
                    v.map.collisionHeight = screenWidth;
                });
            }
        } else {
            const minimapScale = (this.screenScaleFactor * 1600) / 1.2;
            const minimapSize = thisMinimapSize * this.screenScaleFactor;

            this.mapSprite.width = minimapScale;
            this.mapSprite.height = minimapScale;
            this.mapSprite.alpha = 0.8;

            setGameView((v) => {
                v.map.scale = this.screenScaleFactor;
                v.map.bottom = this.mapContainerBottom * this.screenScaleFactor;
            });
            const minimapPosY = layoutSm
                ? minimapSize / 2 + thisMinimapMargin
                : screenHeight - minimapSize / 2 - thisMinimapMargin;
            this.minimapPos.x = thisMinimapMargin + minimapSize / 2 + thisMinimapMarginXAdjust;
            this.minimapPos.y = minimapPosY + thisMinimapMarginYAdjust;
            this.display.border.lineStyle(thisMinimapBorderWidth, 0);
            this.display.border.beginFill(0, 0);
            const u = layoutSm
                ? thisMinimapMargin + thisMinimapBorderWidth / 2
                : screenHeight
                    - minimapSize
                    - thisMinimapMargin
                    + thisMinimapBorderWidth / 2;
            this.display.border.drawRect(
                thisMinimapMargin + thisMinimapBorderWidth / 2 + thisMinimapMarginXAdjust,
                u + thisMinimapMarginYAdjust,
                minimapSize - thisMinimapBorderWidth,
                minimapSize - thisMinimapBorderWidth,
            );
            this.display.border.endFill();

            const minimapMaskAnchorY = layoutSm
                ? thisMinimapMargin
                : screenHeight - minimapSize - thisMinimapMargin;
            this.container.mask.beginFill(0xffffff, 1);
            this.container.mask.drawRect(
                thisMinimapMargin + thisMinimapMarginXAdjust,
                minimapMaskAnchorY - 0.5 + thisMinimapMarginYAdjust,
                minimapSize,
                minimapSize,
            );
            this.container.mask.endFill();
        }
    }

    toggleEscMenu(clear = false) {
        if (!this.displayingStats) {
            if (this.escMenuDisplayed || clear) {
                this.escMenuDisplayed = false;
                setGameView((v) => {
                    v.menu.open = false;
                });
                this.setCurrentGameTab("settings");
                this.inputBinds.menuHovered = false;
                if (this.roleMenuActive) {
                    this.displayRoleMenu();
                }
            } else if (this.bigmapDisplayed) {
                this.displayMapLarge(true);
            } else {
                if (this.visibilityMode == 2) {
                    this.cycleVisibilityMode();
                }
                this.escMenuDisplayed = true;
                setGameView((v) => {
                    v.menu.open = true;
                });
                this.inputBinds.menuHovered = false;
                if (this.roleMenuActive) {
                    this.hideRoleMenu();
                }
            }
        }
    }

    setCurrentGameTab(tab: GameTab) {
        this.currentGameTab = tab;
        setGameView((v) => {
            v.menu.tab = tab;
        });
        if (this.currentGameTab != "keybinds") {
            this.inputBindUi.cancelBind();
        }
    }

    setRoleMenuActive(active: boolean) {
        this.roleMenuActive = active;
        if (this.roleMenuActive) {
            this.roleMenuTicker = GameConfig.player.perkModeRoleSelectDuration;
            this.displayRoleMenu();
        } else {
            if (this.roleMenuInst) {
                this.audioManager.stopSound(this.roleMenuInst);
                this.roleMenuInst = null;
            }
            this.hideRoleMenu();
        }
    }

    displayRoleMenu() {
        setGameView((v) => {
            v.role.open = true;
        });
    }

    hideRoleMenu() {
        setGameView((v) => {
            v.role.open = false;
        });
    }

    /** the role menu's "enter game" button, or its countdown running out */
    confirmRole() {
        this.roleSelected = this.roleDisplayed;
        this.setRoleMenuActive(false);
    }

    setRoleMenuOptions(role: string, roles: string[]) {
        const options = roles.map((type) => ({ type, img: GameObjectDefs.typeToDef(type, "role").guiImg ?? "" }));
        setGameView((v) => {
            reconcile(options, "type")(v.role.roles);
        });

        let selectedRole = roles[0];
        if (roles.includes(role)) {
            selectedRole = role;
        }
        this.setRoleMenuInfo(selectedRole);
    }

    setRoleMenuInfo(role: string) {
        const roleDef = GameObjectDefs.typeToDef(role, "role");
        const perks = roleDef.perks!.map((perk) => ({
            l10n: `game-${perk}`,
            img: helpers.getSvgFromGameType(perk instanceof Function ? perk() : perk),
        }));
        setGameView((v) => {
            v.role.selected = role;
            v.role.guiImg = roleDef.guiImg ?? "";
            // (jQuery ignored the invalid "default" of a role without a color)
            if (roleDef.color) v.role.borderColor = helpers.colorToHexString(roleDef.color);
            reconcile(perks)(v.role.perks);
        });
        this.roleDisplayed = role;
    }
}
