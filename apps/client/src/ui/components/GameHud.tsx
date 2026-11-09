import { For, Show } from "solid-js";
import { layout } from "../../device.ts";
import { gameUi, gameView, humanizeTime, type LocalStatsView, px } from "../gameView.ts";
import { type MessageKey, t, translate } from "../i18n.ts";
import { DeathScreen, EditorOverlay } from "./DeathScreen.tsx";
import { GameMenu } from "./GameMenu.tsx";

/** the game reads mouse buttons on window: clicks on the HUD must not shoot */
const stop = (e: Event) => e.stopPropagation();

const shown = (value: boolean, display = "block") => (value ? display : "none");

export function RoleMenu() {
    return (
        <div id="ui-role-menu-wrapper" style={{ display: gameView.role.open ? "block" : "none" }}>
            <div
                id="ui-role-menu"
                style={{
                    // fits the screen, never larger than 1200x900
                    transform: `translateX(-50%) translateY(-50%) scale(${
                        Math.min(1, layout.width / 1200, layout.height / 900)
                    })`,
                    "border-color": gameView.role.borderColor || undefined,
                }}
            >
                <div id="ui-role-header">
                    <For each={gameView.role.roles}>
                        {(role) => (
                            <div
                                class="ui-role-option"
                                style={{
                                    "background-image": `url('${role.img}')`,
                                    "background-size": gameView.role.selected === role.type ? "164px" : "132px",
                                    opacity: gameView.role.selected === role.type ? 1 : 0.5,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    gameUi()?.setRoleMenuInfo(role.type);
                                }}
                            >
                            </div>
                        )}
                    </For>
                </div>
                <div id="ui-role-body">
                    <Show when={gameView.role.selected}>
                        <div class="ui-role-body-left">
                            <div class="ui-role-body-name">{translate(`game-${gameView.role.selected}`)}</div>
                            <div
                                class="ui-role-body-image"
                                style={{ "background-image": `url('${gameView.role.guiImg}')` }}
                            >
                            </div>
                        </div>
                        <div class="ui-role-body-right">
                            <For each={gameView.role.perks}>
                                {(perk) => (
                                    <div class="ui-role-body-perk">
                                        <div class="ui-role-body-perk-image-wrapper">
                                            <div
                                                class="ui-role-body-perk-image-icon"
                                                style={{ "background-image": `url('${perk.img}')` }}
                                            >
                                            </div>
                                        </div>
                                        <div class="ui-role-body-perk-name">{translate(perk.l10n)}</div>
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
                <div id="ui-role-footer">
                    <div id="ui-role-footer-desc">{t("game-select-class")}</div>{" "}
                    <div
                        id="ui-role-footer-enter"
                        onClick={(e) => {
                            e.stopPropagation();
                            gameUi()?.confirmRole();
                        }}
                    >
                        {gameView.role.seconds === null
                            ? "ENTER GAME (20)"
                            : `${t("game-enter-game")} (${gameView.role.seconds})`}
                    </div>
                </div>
            </div>
        </div>
    );
}

const teamColors = ["yellow", "purple", "cyan", "orange"];

export function TeamPanel() {
    return (
        <div id="ui-top-left" class="js-ui-hud-show click-through">
            <div
                id="ui-team"
                class="js-ui-mobile-map-hidden"
                style={{ display: gameView.active ? "block" : undefined }}
            >
                <For each={gameView.team}>
                    {(member, i) => (
                        <div
                            class="ui-team-member ui-bg-standard"
                            style={{ display: member.displayed ? "block" : "none" }}
                        >
                            <div
                                class="ui-team-member-name"
                                style={{
                                    opacity: member.status == "dead" || member.status == "disconnected"
                                        ? 0.3
                                        : undefined,
                                }}
                            >
                                {member.name}
                            </div>
                            <div class={`ui-team-member-color ui-background-${teamColors[i()]}`}></div>
                            <div
                                class={[
                                    "ui-team-member-status",
                                    {
                                        "ui-team-member-status-disconnected": member.status === "disconnected",
                                        "ui-team-member-status-dead": member.status === "dead",
                                        "ui-team-member-status-downed": member.status === "downed",
                                        "icon-pulse": member.status === "downed",
                                    },
                                ]}
                            >
                            </div>
                            <div class="ui-team-member-health">
                                <div
                                    class={["ui-bar-inner ui-health-actual", { "ui-bar-danger": member.healthDanger }]}
                                    style={{
                                        width: px(member.healthWidth),
                                        "background-color": member.healthColor || undefined,
                                    }}
                                >
                                </div>
                            </div>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
}

export function MapPanel() {
    const expand = () => gameUi()?.onMapExpand();
    return (
        <>
            <div
                id="ui-map-wrapper"
                class="ui-map-wrapper-desktop click-through"
                style={{ display: gameView.active ? "block" : undefined }}
            >
                <div
                    id="ui-map-container"
                    style={{ "--map-scale": gameView.map.scale }}
                >
                    <div
                        id="ui-map-info"
                        class={["js-ui-map-hidden js-ui-hud-show", { "icon-pulse": gameView.map.gasMoving }]}
                    >
                        <div id="ui-gas-icon" class={gameView.map.gasMoving ? "danger-icon" : "gas-icon"}></div>{" "}
                        <div id="ui-gas-timer">{gameView.map.gasTime}</div>
                    </div>
                    <div
                        id="ui-spec-counter"
                        class="js-ui-map-hidden js-ui-hud-show"
                        style={{ display: shown(gameView.map.spectators > 0) }}
                    >
                        <div id="ui-spec-counter-icon"></div>{" "}
                        <div id="ui-spec-counter-number">{gameView.map.spectators}</div>
                    </div>
                    <div id="ui-settings-container-desktop" class="js-ui-desktop-map-hidden">
                        <div
                            id="ui-map-expand-desktop"
                            class="ui-map-expand ui-settings-button"
                            onMouseDown={stop}
                            onClick={expand}
                        >
                            <img id="mag-glass-white" src="img/gui/mag-glass.svg" />
                        </div>
                        <div
                            id="ui-map-minimize"
                            class="ui-settings-button js-ui-map-hidden"
                            onMouseDown={stop}
                            onClick={(e) => {
                                e.stopPropagation();
                                gameUi()?.toggleMiniMap();
                            }}
                        >
                            <img id="ui-minimize-img" src="img/gui/minimize.svg" />
                        </div>
                    </div>
                    <div
                        id="ui-settings-container-mobile"
                        class="js-ui-mobile-map-hidden"
                    >
                        <div id="ui-alive-info">
                            <div id="ui-alive-icon" class="ui-map-icon alive-icon"></div>{" "}
                            <div
                                id="ui-map-counter-default"
                                class="js-ui-players-alive"
                                style={{ display: gameView.alive.kind == "faction" ? "none" : undefined }}
                            >
                                {gameView.alive.count}
                            </div>{" "}
                            <div
                                id="ui-map-counter-faction"
                                style={{ display: shown(gameView.alive.kind == "faction", "inline-block") }}
                            >
                                <span class="ui-players-alive-red js-ui-players-alive-red">{gameView.alive.red}
                                </span>:<span class="ui-players-alive-blue js-ui-players-alive-blue">
                                    {gameView.alive.blue}
                                </span>
                            </div>
                        </div>{" "}
                        <div
                            id="ui-map-expand-mobile"
                            class="ui-map-expand ui-settings-button"
                            onMouseDown={stop}
                            onClick={expand}
                        >
                        </div>{" "}
                        <div
                            id="ui-menu-display"
                            class="ui-settings-button prop-event"
                            onClick={(e) => {
                                e.stopPropagation();
                                gameUi()?.toggleEscMenu();
                            }}
                        >
                        </div>
                    </div>
                </div>
            </div>
            <div
                id="ui-kill-leader-container"
                style={{ display: shown(gameView.killLeaderEnabled && !gameView.editor) }}
            >
                <div
                    id="ui-kill-leader-wrapper"
                    class="js-ui-map-hidden js-ui-hud-show hide-on-mobile"
                >
                    <div id="ui-kill-leader-name">
                        {gameView.killLeader.playerId === null
                            ? "Waiting for new leader"
                            : gameView.killLeader.playerId
                            ? gameView.killLeader.name
                            : t(gameView.killLeader.hunted ? "game-waiting-for-hunted" : "game-waiting-for-new-leader")}
                    </div>{" "}
                    <div id="ui-kill-leader-icon"></div>{" "}
                    <div id="ui-kill-leader-count">{gameView.killLeader.playerId ? gameView.killLeader.kills : 0}</div>
                </div>
            </div>
        </>
    );
}

export function Leaderboard() {
    return (
        <div id="ui-leaderboard-wrapper">
            <div id="ui-leaderboard" class="js-ui-hud-show">
                <div
                    id="ui-leaderboard-alive"
                    style={{ display: shown(gameView.alive.kind == "players") }}
                >
                    <span class="ui-players-alive js-ui-players-alive">{gameView.alive.count}</span>
                </div>
                <div id="ui-leaderboard-alive-faction" style={{ display: shown(gameView.alive.kind == "faction") }}>
                    <span class="ui-players-alive-red js-ui-players-alive-red">{gameView.alive.red}</span>{" "}
                    <span class="ui-players-alive-blue js-ui-players-alive-blue">{gameView.alive.blue}</span>
                </div>
                <div class="ui-leaderboard-header">{t("game-alive")}</div>
            </div>
            <div id="ui-kill-counter-wrapper" class="js-ui-map-show">
                <div id="ui-kill-counter">
                    <span class="ui-player-kills js-ui-player-kills">{gameView.kills}</span>
                </div>
                <div class="ui-kill-counter-header">{t("game-kills")}</div>
            </div>
        </div>
    );
}

export function TopCenter() {
    return (
        <>
            <div
                id="ui-top-center"
                class="js-ui-map-hidden js-ui-hud-show click-through"
            >
                <div id="ui-waiting-text" class="top-center-text" style={{ display: shown(gameView.waiting) }}>
                    <span>{t("game-waiting-for-players")}</span>...
                </div>
                <div
                    id="ui-spectate-text"
                    class="top-center-text ui-spectate-mode"
                    style={{ display: gameView.spectate.active ? "block" : "none" }}
                >
                    <div class="spectate-text spectate-desc">{t("game-spectating")}</div>{" "}
                    <div id="spectate-player" class="spectate-text">{gameView.spectate.name}</div>
                </div>
            </div>
            <div id="ui-upper-center" class="click-through">
                {/* remounts on every announcement, which restarts its fade in, hold and fade out */}
                <Show when={gameView.announcement} keyed>
                    {(announcement) => <div id="ui-announcement" class="announce">{announcement.text}</div>}
                </Show>
            </div>
        </>
    );
}

const localStatRows: { key: keyof LocalStatsView; label: MessageKey }[] = [
    { key: "kills", label: "game-kills" },
    { key: "damageDealt", label: "game-damage-dealt" },
    { key: "damageTaken", label: "game-damage-taken" },
    { key: "timeAlive", label: "game-survived" },
];

export function SpectateOptions() {
    return (
        <div id="ui-spectate-options-wrapper" style={{ top: px(gameView.spectate.optionsTop) }}>
            <div
                id="ui-spectate-options"
                class="ui-spectate-mode js-ui-hud-show click-through"
                style={{ display: gameView.spectate.active ? "block" : "none" }}
            >
                <div id="ui-spectate-buttons" class="ui-bg-standard">
                    <a
                        class="menu-option btn-darken"
                        id="btn-spectate-next-player"
                        style={{ display: gameView.spectate.teamButtons ? "block" : "none" }}
                        onClick={() => gameUi()?.spectateNext()}
                    >
                        {t("game-next-teammate")}
                    </a>
                    <a
                        class="menu-option btn-darken"
                        id="btn-spectate-prev-player"
                        style={{ display: gameView.spectate.teamButtons ? "block" : "none" }}
                        onClick={() => gameUi()?.spectatePrev()}
                    >
                        {t("game-previous-teammate")}
                    </a>
                    <a
                        class="menu-option btn-darken"
                        id="btn-spectate-view-stats"
                        onClick={() => gameUi()?.toggleLocalStats()}
                    >
                        {t(gameView.spectate.statsShown ? "game-hide-match-stats" : "game-view-match-stats")}
                    </a>
                    <a
                        class="menu-option btn-darken btn-quit"
                        id="btn-spectate-quit"
                        onClick={() => gameUi()?.quitGame()}
                    >
                        {t("game-leave-game")}
                    </a>
                </div>{" "}
                <div
                    id="ui-spectate-stats"
                    class="ui-bg-standard"
                    style={{ display: gameView.spectate.statsShown ? "inline-block" : "none" }}
                >
                    <div id="ui-spectate-stats-header">{t("game-your-results")}</div>
                    <table id="ui-spectate-stats-table">
                        <tbody id="ui-spectate-stats-data">
                            <Show when={gameView.spectate.hasStats}>
                                <For each={localStatRows}>
                                    {(row) => (
                                        <tr>
                                            <td class="ui-spectate-stats-category">{t(row.label)}</td>
                                            <td class="ui-spectate-stats-value">
                                                {row.key === "timeAlive"
                                                    ? humanizeTime(gameView.spectate.stats.timeAlive)
                                                    : gameView.spectate.stats[row.key]}
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </Show>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
