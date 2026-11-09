import { For } from "solid-js";
import { config } from "../../appConfig.ts";
import { device, layout } from "../../device.ts";
import { gameTabs, gameUi, gameView, px } from "../gameView.ts";
import { small } from "../hudLayout.ts";
import { type MessageKey, t } from "../i18n.ts";
import { GameKeybindsTab } from "./Keybinds.tsx";
import { TouchControls } from "./TouchControls.tsx";

type VolumeKey = "masterVolume" | "soundVolume" | "musicVolume";

const sliders: { key: VolumeKey; label: MessageKey; class: string }[] = [
    { key: "masterVolume", label: "index-master-volume", class: "sl-master-volume" },
    { key: "soundVolume", label: "index-sfx-volume", class: "sl-sound-volume" },
    { key: "musicVolume", label: "index-music-volume", class: "sl-music-volume" },
];

const tabIcons: Record<(typeof gameTabs)[number], string> = {
    settings: "settings-icon",
    keybinds: "keybind-icon",
};

/** the game reads mouse buttons on window: clicks on the menu must not shoot */
const stop = (e: Event) => e.stopPropagation();

/** the escape menu (settings + keybinds tabs) and the big map's close button */
export function GameMenu() {
    return (
        <>
            <div id="tablet-console"></div>
            <div
                id="ui-center"
                onMouseEnter={() => gameUi()?.setMenuHovered(true)}
                onMouseLeave={() => gameUi()?.setMenuHovered(false)}
            >
                <div
                    id="ui-game-menu"
                    class={{ "ui-game-menu-desktop": !small() }}
                    style={{ display: gameView.menu.open ? "block" : "none" }}
                >
                    <div id="btn-game-tabs" class="btns-game-double-row" style={{ display: small() ? "none" : "flex" }}>
                        <For each={gameTabs}>
                            {(tab) => (
                                <div class="btn-game-container">
                                    <a
                                        id={`btn-game-${tab}`}
                                        class={[
                                            "btn-game-tab-select btn-game-menu btn-darken",
                                            { "btn-game-menu-selected": gameView.menu.tab === tab },
                                        ]}
                                        onClick={() => gameUi()?.setCurrentGameTab(tab)}
                                    >
                                    </a>{" "}
                                    <div class={`btn-double-row game-menu-icon-static ${tabIcons[tab]}`}></div>
                                </div>
                            )}
                        </For>
                    </div>
                    <div
                        id="ui-game-tab-settings"
                        class={["ui-game-tab", { "ui-game-tab-settings-desktop": !small() }]}
                        style={{ display: gameView.menu.tab === "settings" ? "block" : "none" }}
                    >
                        <a
                            id="btn-game-fullscreen"
                            class="btn-fullscreen-toggle btn-game-menu btn-darken"
                            onMouseDown={stop}
                            onClick={() => gameUi()?.toggleFullScreen()}
                        >
                            {t("game-full-screen")}
                        </a>
                        <TouchControls />
                        <a
                            id="btn-game-sound"
                            class={[
                                "btn-sound-toggle btn-game-menu btn-darken",
                                config.state.muteAudio ? "audio-off-icon" : "audio-on-icon",
                            ]}
                            onMouseDown={stop}
                            onClick={() => config.set("muteAudio", !config.get("muteAudio"))}
                        >
                            {t("game-sound")}
                        </a>
                        <For each={sliders}>
                            {(slider) => (
                                <div class="slider-container ui-slider-container">
                                    <p class="slider-text">{t(slider.label)}</p>{" "}
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        class={`slider ${slider.class}`}
                                        value={config.state[slider.key] * 100}
                                        onMouseDown={stop}
                                        onInput={(e) => config.set(slider.key, Number(e.currentTarget.value) / 100)}
                                    />
                                </div>
                            )}
                        </For>
                        <a
                            id="btn-game-quit"
                            class="btn-quit btn-game-menu btn-darken"
                            onMouseDown={stop}
                            onClick={() => gameUi()?.quitToMenu()}
                        >
                            {t("game-quit-game")}
                        </a>
                    </div>
                    <div
                        id="ui-game-tab-keybinds"
                        class="ui-game-tab"
                        style={{ display: gameView.menu.tab === "keybinds" ? "block" : "none" }}
                    >
                        <GameKeybindsTab />
                    </div>
                    <a
                        id="btn-game-resume"
                        class="btn-game-menu btn-darken"
                        style={{ display: device.touch ? "none" : undefined }}
                        onMouseDown={stop}
                        onClick={() => gameUi()?.toggleEscMenu()}
                    >
                        {t("game-return-to-game")}
                    </a>
                </div>
            </div>
            <div id="big-map" class="js-ui-map-show">
                {/* on touch screens, the rotated screen */}
                <div
                    id="big-map-collision"
                    style={device.touch ? { width: px(layout.height), height: px(layout.width) } : undefined}
                >
                </div>
                <div
                    id="big-map-close"
                    style={{ display: small() ? "block" : "none" }}
                    onTouchEnd={(e) => {
                        e.stopPropagation();
                        gameUi()?.displayMapLarge(true);
                    }}
                    onMouseDown={stop}
                    onClick={(e) => {
                        e.stopPropagation();
                        gameUi()?.displayMapLarge(true);
                    }}
                >
                </div>
            </div>
        </>
    );
}
