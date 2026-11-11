import { render } from "@solidjs/web";
import { For, Show } from "solid-js";
import { config } from "../../appConfig.ts";
import { layout } from "../../device.ts";
import { gameUi, gameView, px } from "../gameView.ts";
import { iosBrowserTop, iosGameStyle, small, tabletClass } from "../hudLayout.ts";
import { loadoutMenu, loadoutView } from "../loadoutView.ts";
import { startMenu } from "../startMenu.ts";
import { removeToast, toasts } from "../toast.ts";
import { DeleteAccountModal, MobileAccountModal, ResetStatsModal, SetNameModal, StartTopRight } from "./Account.tsx";
import { AppModals } from "./AppModals.tsx";
import { DeathScreen, EditorOverlay } from "./DeathScreen.tsx";
import { EmoteButton, EmoteWheels } from "./EmoteWheel.tsx";
import { Leaderboard, MapPanel, RoleMenu, SpectateOptions, TeamPanel, TopCenter } from "./GameHud.tsx";
import { GameMenu } from "./GameMenu.tsx";
import {
    EquippedAmmo,
    Gear,
    HealthAndBoost,
    Interaction,
    Inventory,
    KillFeed,
    KillMessage,
    Messages,
    Perks,
    Scopes,
    Weapons,
} from "./Hud.tsx";
import { CustomizeModal, ItemConfirmModal } from "./Loadout.tsx";
import { StartBottom, StartMainCenter, StartTopLeft } from "./StartMenu.tsx";

const TEAM_INDICATOR_COLORS = ["yellow", "purple", "cyan", "orange"];

/** teammates' markers at the screen edge while they're off screen */
function TeamIndicators() {
    return (
        <div id="ui-team-indicators" class="js-ui-map-hidden js-desktop-ui-hud-show">
            <For each={TEAM_INDICATOR_COLORS}>
                {(color, idx) => {
                    const indicator = () => gameView.team[idx()].indicator;
                    return (
                        <div
                            class="ui-team-indicator ui-indicator-main"
                            data-id={idx()}
                            style={{
                                display: indicator() ? "block" : undefined,
                                left: px(indicator()?.left),
                                top: px(indicator()?.top),
                                transform: indicator()?.transform,
                            }}
                        >
                            <div class={`ui-team-indicator-pos ui-background-${color}`}></div>
                        </div>
                    );
                }}
            </For>
        </div>
    );
}

/** the game: everything over the canvas while playing or spectating */
function GameArea() {
    return (
        <div
            id="game-area-wrapper"
            style={{ display: startMenu.active ? "none" : "block" }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div id="game-touch-area"></div>
            <RoleMenu />
            {/* app.css hides and shows the `.js-ui-map-*` elements and moves the map info with these */}
            <div
                id="ui-game"
                class="click-through"
                data-bigmap={gameView.map.bigmap || undefined}
                data-small={layout.small || undefined}
                data-minimap-hidden={!gameView.map.minimap || undefined}
                style={{
                    ...iosGameStyle(),
                    display: gameView.hidden ? "none" : undefined,
                    // a dragged weapon slot follows the mouse anywhere
                    "pointer-events": gameView.weaponDrag.dragging ? "initial" : undefined,
                }}
                onMouseMove={(e) => gameUi()?.onWeapMouseMove(e)}
                onMouseUp={(e) => gameUi()?.onWeapMouseUp(e, e.currentTarget.matches(":hover"))}
            >
                <GameMenu />
                <EmoteWheels />
                <TeamIndicators />
                <div
                    id="ui-right-center"
                    class={[
                        "js-ui-map-hidden",
                        small() ? "ui-right-center-mobile" : "ui-right-center-desktop",
                        tabletClass("ui-right-center", true),
                    ]}
                    style={iosBrowserTop}
                >
                    <Inventory />
                    <EmoteButton />
                </div>
                <TeamPanel />
                <MapPanel />
                <div
                    id="ui-killfeed-wrapper"
                    class={tabletClass("ui-killfeed-wrapper")}
                    style={{ top: gameView.killfeedTop || undefined }}
                >
                    <div id="ui-killfeed" class="js-ui-map-hidden js-ui-hud-show">
                        <KillFeed />
                    </div>
                </div>
                <Leaderboard />
                <div id="ui-top-center-scopes-wrapper" style={iosBrowserTop}>
                    <Scopes />
                </div>
                <TopCenter />
                <div
                    id="ui-lower-center"
                    class="js-ui-map-hidden js-ui-hud-show click-through"
                >
                    <Interaction />
                </div>
                <div id="ui-bottom-center-2" class="click-through">
                    <Messages />
                </div>
                <div
                    id="ui-equipped-ammo-wrapper"
                    class="js-ui-map-hidden js-ui-hud-show"
                >
                    <EquippedAmmo />
                </div>
                <div
                    id="ui-bottom-center-0"
                    class="click-through js-ui-map-hidden js-ui-hud-show"
                >
                    <HealthAndBoost />
                </div>
                <div id="ui-bottom-center-left" class={["js-ui-map-hidden", tabletClass("ui-bottom-center-left")]}>
                    <Perks />
                </div>
                <div id="ui-bottom-center-right" class={["js-ui-map-hidden", tabletClass("ui-bottom-center-right")]}>
                    <Gear />
                </div>
                <div id="ui-bottom-right" class={["js-ui-map-hidden", tabletClass("ui-bottom-right", true)]}>
                    <Weapons />
                </div>
                <SpectateOptions />
                <div id="ui-bottom-center-1" class="click-through">
                    <KillMessage />
                </div>
            </div>
            <DeathScreen />
            <EditorOverlay />
        </div>
    );
}

/** the main menu, and the modals opened from it */
function StartScreen() {
    return (
        <div id="start-menu-wrapper" style={{ display: startMenu.active ? undefined : "none" }}>
            <div id="safari-margin"></div>
            <div
                id="background"
                style={{
                    display: loadoutView.open ? "none" : undefined,
                    "background-image": `url(${config.state.cachedBgImg})`,
                }}
            >
                <div id="start-overlay"></div>
            </div>
            <div id="start-main" class={["fade", { faded: loadoutView.open }]}>
                <StartTopLeft />
                <SetNameModal />
                <ResetStatsModal />
                <DeleteAccountModal />
                <MobileAccountModal />
                <StartTopRight />
                <StartMainCenter />
                <StartBottom />
            </div>
            <Show when={loadoutMenu()} keyed>{(menu) => <CustomizeModal menu={menu} />}</Show>
            <AppModals />
            <Show when={loadoutMenu()} keyed>{(menu) => <ItemConfirmModal menu={menu} />}</Show>
        </div>
    );
}

function Toasts() {
    return (
        <For each={toasts()}>
            {(toast) => (
                <div
                    class="copy-toast toast"
                    style={{ left: px(toast.left), top: px(toast.top), "--rise": px(toast.rise) }}
                    onAnimationEnd={(e) => e.animationName == "toast-fade" && removeToast(toast)}
                >
                    {toast.text}
                </div>
            )}
        </For>
    );
}

export function App() {
    return (
        <>
            <GameArea />
            <StartScreen />
            <Toasts />
        </>
    );
}

export function mountApp() {
    render(() => <App />, document.getElementById("app")!);
}
