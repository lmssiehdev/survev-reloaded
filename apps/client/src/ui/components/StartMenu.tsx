import type { JSX } from "@solidjs/web";
import * as net from "@survev/shared/net/net.ts";
import { createSignal, flush, For, Show } from "solid-js";
import { config } from "../../appConfig.ts";
import { device, layout } from "../../device.ts";
import { helpers } from "../../helpers.ts";
import { hamburgerModal, keybindModal, settingsModal } from "../appModals.ts";
import { t, translate } from "../i18n.ts";
import newsHtml from "../news.html?raw";
import { passPanel } from "../passView.ts";
import { profile, profileUi } from "../profile.ts";
import { app, type RegionView, setStartMenu, setTeam, startMenu, team, teamMenu } from "../startMenu.ts";
import { showToast } from "../toast.ts";
import { PassPanel } from "./PassPanel.tsx";
import { LanguageSelect } from "./SettingsModal.tsx";

/** the newest news entry's date; newer than the config's lastNewsTimestamp lights the news button */
export const currentNewsTime = new Date(/data-date="([^"]+)"/.exec(newsHtml)?.[1] ?? 0).getTime();

const stop = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
};

/** "Local [42 players]" */
const regionLabel = (region: RegionView) => `${translate(region.l10n)} [${region.playerCount} ${t("index-players")}]`;

function RegionSelect(
    props: {
        id: string;
        optgroupId: string;
        class: string;
        value: string;
        disabled?: boolean;
        onChange: (id: string) => void;
    },
) {
    return (
        <select
            id={props.id}
            class={props.class}
            disabled={props.disabled}
            onChange={(e) => {
                const region = startMenu.regions.find((r) => r.id === e.currentTarget.value);
                if (region) props.onChange(region.id);
            }}
        >
            <optgroup id={props.optgroupId} label={t("index-region")}>
                <For each={startMenu.regions} keyed={(region) => region.id}>
                    {(region) => (
                        <option value={region().id} selected={region().id === props.value}>
                            {regionLabel(region())}
                        </option>
                    )}
                </For>
            </optgroup>
        </select>
    );
}

/** the dimmed play buttons and spinner while a game is being joined (start and team menus) */
function PlayLoading() {
    return (
        <div
            class="play-loading-outer"
            style={{
                opacity: startMenu.playLocked ? 1 : 0,
                "pointer-events": startMenu.playLocked ? "initial" : "none",
                transition: IS_DEV ? undefined : "opacity 250ms",
            }}
        >
            <div class="play-loading-inner">
                <div class="play-loading-spinner"></div>
            </div>
        </div>
    );
}

function PlayButtonContainer(props: { children: JSX.Element }) {
    return (
        <div
            class="play-button-container"
            style={{ opacity: startMenu.playLocked ? 0.5 : 1, transition: IS_DEV ? undefined : "opacity 250ms" }}
        >
            {props.children}
        </div>
    );
}

/** play buttons get a map's icon and colors from site_info */
function modeButtonStyle(idx: number, extraClass: string) {
    const mode = startMenu.modes[idx];
    const custom = !!mode && (!!mode.icon || !!mode.buttonCss);
    return {
        class: ["btn-green btn-darken menu-option", custom && [extraClass, mode.buttonCss]],
        style: {
            "background-image": custom ? `url(${mode.icon})` : undefined,
            display: mode && !mode.enabled ? "none" : undefined,
        },
    };
}

function QuickPlayButton(props: { idx: number }) {
    const look = () =>
        modeButtonStyle(props.idx, props.idx === 0 ? "btn-custom-mode-no-indent" : "btn-custom-mode-main");
    return (
        <a
            id={`btn-start-mode-${props.idx}`}
            class={look().class}
            style={look().style}
            onClick={() => app()?.tryQuickStartGame(props.idx)}
        >
            {startMenu.pendingModeIdx === props.idx
                ? <div class="ui-spinner"></div>
                : translate(`index-play-${startMenu.modes[props.idx]?.buttonText ?? ""}`)}
        </a>
    );
}

const helpLines: { actions: string[]; control: string; desktopOnly?: boolean }[] = [
    { actions: ["index-movement"], control: "index-movement-ctrl" },
    { actions: ["index-aim"], control: "index-aim-ctrl" },
    { actions: ["index-punch", "index-shoot"], control: "index-shoot-ctrl" },
    { actions: ["index-change-weapons"], control: "index-change-weapons-ctrl" },
    { actions: ["index-stow-weapons"], control: "index-stow-weapons-ctrl", desktopOnly: true },
    { actions: ["index-swap-weapons"], control: "index-swap-weapons-ctrl", desktopOnly: true },
    { actions: ["index-swap-weapon-slots"], control: "index-swap-weapon-slots-ctrl", desktopOnly: true },
    { actions: ["index-reload"], control: "index-reload-ctrl" },
    { actions: ["index-scope-zoom"], control: "index-scope-zoom-ctrl" },
    { actions: ["index-pickup", "index-loot", "index-revive"], control: "index-pickup-ctrl" },
    { actions: ["index-use-medical"], control: "index-use-medical-ctrl" },
    { actions: ["index-drop-item"], control: "index-drop-item-ctrl" },
    { actions: ["index-cancel-action"], control: "index-cancel-action-ctrl" },
    { actions: ["index-view-map"], control: "index-view-map-ctrl" },
    { actions: ["index-toggle-minimap"], control: "index-toggle-minimap-ctrl", desktopOnly: true },
    { actions: ["index-use-ping"], control: "index-use-ping-ctrl" },
    { actions: ["index-use-emote"], control: "index-use-emote-ctrl" },
];

const helpTips: [title: string, desc: string][] = [
    ["index-how-to-play", "index-tips-1-desc"],
    ["index-tips-2", "index-tips-2-desc"],
    ["index-tips-3", "index-tips-3-desc"],
    ["index-tips-4", "index-tips-4-desc"],
];

/** "How to Play": controls (touch variants on touch devices) and tips */
function Help() {
    return (
        <div id="start-help" style={{ display: startMenu.helpOpen ? "block" : undefined }}>
            <h1>{t("index-controls")}</h1>
            <For each={helpLines}>
                {(line) => (
                    <p class={line.desktopOnly ? "hide-on-mobile" : undefined}>
                        <For each={line.actions}>
                            {(action, i) => (
                                <>
                                    {i() > 0 && "/"}
                                    <span class="help-action">{translate(action)}</span>
                                </>
                            )}
                        </For>
                        :{" "}
                        <span class="help-control">
                            {translate(device.touch ? `${line.control}-touch` : line.control)}
                        </span>
                    </p>
                )}
            </For>
            <For each={helpTips}>
                {([title, desc]) => (
                    <>
                        <h1>{translate(title)}</h1>
                        <p>{translate(desc)}</p>
                    </>
                )}
            </For>
        </div>
    );
}

function NameInput() {
    return (
        <input
            type="text"
            class="menu-option player-name-input"
            tabindex="0"
            placeholder={t("index-enter-name-here")}
            id="player-name-input-solo"
            maxlength={net.Constants.PlayerNameMaxLen}
            value={startMenu.playerName}
            onInput={(e) => setStartMenu((m) => void (m.playerName = e.currentTarget.value))}
            onBlur={() => {
                app()?.setConfigFromDOM();
                if (device.mobile && device.os != "ios") document.body.scrollTop = 0;
            }}
            onFocus={(e) => {
                // keep the name input in view above the phone keyboard
                if (device.mobile && device.os != "ios" && device.isLandscape) {
                    const offset = device.screenHeight <= 282 ? 18 : 36;
                    document.body.scrollTop = e.currentTarget.getBoundingClientRect().top + window.scrollY - offset;
                }
            }}
            onKeyPress={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
            }}
        />
    );
}

/** the main column: name, region, play buttons, team buttons, how to play */
function StartMenuColumn() {
    let column!: HTMLDivElement;
    const openHelp = stop(() => {
        setStartMenu((m) => void (m.helpOpen = true));
        // the help text has to be in the page before there is anything to scroll to
        flush();
        column.scrollTo({ top: column.clientHeight, behavior: "smooth" });
    });
    return (
        <div
            id="start-menu"
            class={["menu-column menu-block", { "display-help": startMenu.helpOpen }]}
            style={{ display: team.active || startMenu.teamLinkOpen ? "none" : "block" }}
            ref={(el) => (column = el)}
        >
            <PlayLoading />
            <PlayButtonContainer>
                <div id="player-options">
                    <NameInput />{" "}
                    <a
                        class="btn-darken menu-option player-options-btn"
                        id="btn-customize"
                        onClick={stop(() => profileUi()?.openLoadout())}
                    >
                    </a>
                </div>
                <RegionSelect
                    id="server-select-main"
                    optgroupId="server-opts"
                    class="server-select menu-option btn-hollow btn-hollow-selected"
                    value={startMenu.region}
                    onChange={(region) => {
                        setStartMenu((m) => void (m.region = region));
                        config.set("region", region);
                    }}
                />
                <QuickPlayButton idx={0} />
                <div id="btns-quick-start">
                    <QuickPlayButton idx={1} />
                    <QuickPlayButton idx={2} />
                </div>
                <div class="btns-double-row" style={{ display: startMenu.supportsTeam ? undefined : "none" }}>
                    <a
                        class="btn-darken menu-option btn-team-option"
                        id="btn-join-team"
                        onClick={stop(() => app()?.openTeamLink())}
                    >
                        {t("index-join-team")}
                    </a>
                    <a
                        class="btn-darken menu-option btn-team-option"
                        id="btn-create-team"
                        onClick={() => app()?.tryJoinTeam(true)}
                    >
                        {t("index-create-team")}
                    </a>
                </div>
                <div id="btn-help" class="menu-option btn-darken" onClick={openHelp}>
                    {t("index-how-to-play")}
                </div>
                <Help />
            </PlayButtonContainer>
        </div>
    );
}

/** the team menu's buttons are toggles: selected / enabled / disabled looks */
function teamButtonClass(base: string, selected: boolean, enabled: boolean) {
    return [
        base,
        enabled ? "btn-darken" : "btn-disabled",
        { "btn-opaque": !enabled && !selected, "btn-hollow-selected": selected },
    ];
}

function TeamMember(props: { slot: number }) {
    const player = () => team.players[props.slot];
    const self = () => !!player() && player()!.playerId === team.localPlayerId;
    const editing = () => team.editingName && self();
    const [name, setName] = createSignal("");
    return (
        <div class="team-menu-member">
            <div
                class={[
                    "icon",
                    {
                        "icon-leader": !!player()?.isLeader,
                        "icon-kick": !player()?.isLeader && team.isLeader && !!player(),
                    },
                ]}
                onClick={() => {
                    const p = player();
                    if (p && !p.isLeader && team.isLeader) teamMenu()?.kick(p.playerId);
                }}
            />
            <Show
                when={editing()}
                fallback={
                    <div
                        class={["name menu-option name-text", {
                            "name-self": self(),
                            "name-in-game": !!player()?.inGame,
                        }]}
                        onClick={() => self() && teamMenu()?.editName()}
                    >
                        {player()?.name ?? ""}
                    </div>
                }
            >
                <input
                    type="text"
                    tabindex="0"
                    class="name menu-option name-text name-self-input"
                    maxlength={net.Constants.PlayerNameMaxLen}
                    value={name()}
                    ref={(el) => {
                        setName(player()?.name ?? "");
                        queueMicrotask(() => el.focus());
                    }}
                    onInput={(e) => setName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            teamMenu()?.submitName(name());
                        }
                    }}
                    onBlur={() => teamMenu()?.cancelNameEdit()}
                />
            </Show>
            <Show
                when={editing()}
                fallback={<div class={["icon", { "icon-in-game": !!player()?.inGame }]} />}
            >
                <div
                    class="icon icon-submit-name-change"
                    onMouseDown={(e) => {
                        // keep the input focused, or its blur cancels the edit
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onClick={() => teamMenu()?.submitName(name())}
                />
            </Show>
        </div>
    );
}

function TeamPlay() {
    const busy = () => team.room.findingGame || team.joiningGame;
    const playersInGame = () => team.players.some((p) => p.inGame);
    const showWait = () => !team.isLeader || (playersInGame() && !team.joiningGame);
    const waitText = () => {
        if (team.isLeader || !busy()) {
            return t(playersInGame() ? "index-game-in-progress" : "index-waiting-for-leader");
        }
        return t("index-joining-game");
    };
    const look = () => {
        const mode = startMenu.modes[team.room.gameModeIdx];
        return {
            class: ["btn-green btn-darken menu-option", mode && ["btn-custom-mode-no-indent", mode.buttonCss]],
            image: mode ? `url(${mode.icon})` : undefined,
        };
    };
    return (
        <div id="team-menu-options-start">
            <a
                class={look().class}
                id="btn-start-team"
                style={{ "background-image": look().image, display: showWait() ? "none" : "block" }}
                onClick={() => teamMenu()?.tryStartGame()}
            >
                {busy() ? <div class="ui-spinner"></div> : t("index-play")}
            </a>
            <div id="msg-wait-reason" style={{ display: showWait() ? "block" : "none" }}>
                <Show when={!team.isLeader && busy()}>
                    <div class="ui-spinner" style={{ "margin-right": "16px" }}></div>
                </Show>
                {waitText()}
                <span>...</span>
            </div>
        </div>
    );
}

function TeamMenuColumn() {
    const roomCode = () => team.room.roomUrl.substring(1);
    const inIframe = window !== window.top;
    let copyButton: HTMLElement | undefined;
    const copy = (e: MouseEvent) => {
        if (copyButton) showToast("Copied!", copyButton, e, 20);
        const invite = teamMenu()?.inviteToCopy();
        if (invite) helpers.copyTextToClipboard(invite);
    };
    const queueButton = (idx: number) => {
        const mode = startMenu.modes[idx];
        return (
            <a
                class={[
                    teamButtonClass(
                        "btn-hollow team-menu-option btn-team-queue",
                        team.room.gameModeIdx === idx,
                        team.isLeader && team.room.enabledGameModeIdxs.includes(idx),
                    ),
                    { "btn-custom-mode-select": !!mode?.icon },
                ]}
                id={`btn-team-queue-mode-${idx}`}
                style={{ "background-image": mode?.icon ? `url(${mode.icon})` : undefined }}
                aria-disabled={team.isLeader && team.room.enabledGameModeIdxs.includes(idx) ? undefined : "true"}
                onClick={() => teamMenu()?.setRoomProperty("gameModeIdx", idx)}
            >
                {translate(`index-${mode?.buttonText ?? ""}`)}
            </a>
        );
    };
    const fillButton = (autoFill: boolean) => (
        <a
            class={teamButtonClass(
                "btn-hollow team-menu-option btn-team-fill",
                team.room.autoFill === autoFill,
                team.isLeader,
            )}
            id={autoFill ? "btn-team-fill-auto" : "btn-team-fill-none"}
            aria-disabled={team.isLeader ? undefined : "true"}
            onClick={() => teamMenu()?.setRoomProperty("autoFill", autoFill)}
        >
            {t(autoFill ? "index-auto-fill" : "index-no-fill")}
        </a>
    );
    return (
        <div id="team-menu" class="menu-column menu-block" style={{ display: team.active ? "block" : "none" }}>
            <PlayLoading />
            <PlayButtonContainer>
                <a
                    class="btn-darken menu-option"
                    id="btn-team-leave"
                    style={{ display: team.joined ? "block" : "none" }}
                    onClick={() => app()?.leaveTeam()}
                >
                    {t("index-leave-team")}
                </a>
                <div id="team-menu-connecting" style={{ display: team.joined ? "none" : "block" }}>
                    <div class="ui-spinner"></div>
                    <div
                        class="team-menu-connecting-text"
                        id="team-menu-joining-text"
                        style={{ display: team.create ? "none" : "block" }}
                    >
                        <span>{t("index-joining-team")}</span> ...
                    </div>
                    <div
                        class="team-menu-connecting-text"
                        id="team-menu-creating-text"
                        style={{ display: team.create ? "block" : "none" }}
                    >
                        <span>{t("index-creating-team")}</span> ...
                    </div>
                </div>
                <div id="team-menu-contents" style={{ display: team.joined ? "block" : "none" }}>
                    <div id="team-desc">
                        <div
                            id="team-desc-text"
                            style={{ display: inIframe ? "none" : undefined, opacity: team.hideUrl ? 0 : 1 }}
                            onClick={copy}
                        >
                            <span id="invite-link-text">{t("index-invite-link")}</span>:{" "}
                            <span id="team-url">{roomCode() ? `${window.location.origin}/t/${roomCode()}` : ""}</span>
                        </div>
                        <a
                            id="team-copy-url"
                            class="copy-item btn-darken"
                            ref={(el) => (copyButton = el)}
                            onClick={copy}
                        >
                        </a>
                        <a
                            id="team-hide-url"
                            class="hide-item btn-darken"
                            style={{
                                display: device.mobile ? "none" : undefined,
                                "background-image": team.hideUrl ? "url(../img/gui/hide.svg)" : undefined,
                            }}
                            onClick={() => setTeam((t) => void (t.hideUrl = !t.hideUrl))}
                        >
                        </a>
                        <div id="team-code-text" style={{ opacity: team.hideUrl ? 0 : 1 }}>
                            <span id="invite-code-text">{t("index-invite-code")}</span>:{" "}
                            <span id="team-code">{roomCode()}</span>
                        </div>
                    </div>
                    <div id="team-menu-columns">
                        <div id="team-menu-members" class="team-menu-block">
                            <div id="team-menu-member-list">
                                <For each={Array.from({ length: team.room.maxPlayers }, (_, i) => i)}>
                                    {(slot) => <TeamMember slot={slot} />}
                                </For>
                            </div>
                        </div>
                        <div id="team-menu-options" class="team-menu-block">
                            <RegionSelect
                                id="team-server-select"
                                optgroupId="team-server-opts"
                                class="btn-hollow btn-hollow-selected server-select menu-option"
                                value={team.room.region}
                                disabled={!team.isLeader}
                                onChange={(region) => teamMenu()?.setRegion(region)}
                            />
                            <div class="team-menu-options-buttons">
                                {queueButton(1)}
                                {queueButton(2)}
                            </div>
                            <div class="team-menu-options-buttons">
                                {fillButton(true)}
                                {fillButton(false)}
                            </div>
                            <TeamPlay />
                        </div>
                    </div>
                </div>
            </PlayButtonContainer>
        </div>
    );
}

/** "Got a team link or code? Paste it here" */
function TeamLink() {
    const join = () => {
        let code = startMenu.teamLink.trim();
        const hash = code.indexOf("#");
        if (hash >= 0) code = code.slice(hash + 1);
        app()?.joinTeamLink(code);
    };
    return (
        <div
            id="team-mobile-link"
            class="menu-column menu-block"
            style={{ display: startMenu.teamLinkOpen ? "block" : "none" }}
        >
            <div
                id="team-mobile-link-desc"
                class="team-mobile-link-text"
                style={{ display: startMenu.teamLinkWarning ? "none" : "block" }}
            >
                {t("index-join-team-help")}
            </div>
            <div
                id="team-mobile-link-warning"
                class={["team-mobile-link-text fade", { faded: !startMenu.teamLinkWarning }]}
                style={{ "--fade": "100ms" }}
            >
                Invalid link!
            </div>
            <input
                type="text"
                class="menu-option"
                tabindex="0"
                placeholder="Paste team link or enter code here"
                id="team-link-input"
                value={startMenu.teamLink}
                onInput={(e) => setStartMenu((m) => void (m.teamLink = e.currentTarget.value))}
                onKeyPress={(e) => {
                    if (e.key === "Enter") {
                        join();
                        e.currentTarget.blur();
                    }
                }}
            />
            <a class="btn-darken menu-option btn-team-option" id="btn-team-mobile-link-join" onClick={join}>
                {t("index-join-team")}
            </a>
            <a
                class="btn-darken menu-option"
                id="btn-team-mobile-link-leave"
                onClick={stop(() => app()?.closeTeamLink())}
            >
                {t("index-back-to-main")}
            </a>
        </div>
    );
}

/** pass / news switch: the button on the news side (the pass side's is in PassPanel.tsx) */
export function RightColumnToggle(props: { class: string; children?: JSX.Element }) {
    return (
        <div
            class={`right-column-toggle ${props.class}`}
            style={{ display: profile.loginSupported ? undefined : "none" }}
            onClick={() => app()?.toggleNews()}
        >
            {props.children}
        </div>
    );
}

function RightColumn() {
    return (
        <div
            id="right-column"
            class="menu-column"
            style={{ display: team.active || startMenu.teamLinkOpen ? "none" : "block" }}
        >
            <div
                id="pass-wrapper"
                class={["fade", { faded: startMenu.newsDisplayed }]}
                style={{ "--fade": "250ms" }}
            >
                <Show when={passPanel()} keyed>{(panel) => <PassPanel {...panel} />}</Show>
            </div>
            <div
                id="news-wrapper"
                class={["fade", { faded: !startMenu.newsDisplayed }]}
                style={{ "--fade": "250ms" }}
            >
                <RightColumnToggle class="pass-toggle" />
                <div id="news-block" class="menu-block">
                    <div id="news" innerHTML={newsHtml}></div>
                </div>
            </div>
        </div>
    );
}

export function StartMainCenter() {
    const warning = () => (team.active ? team.error : startMenu.errorMessage);
    return (
        <div id="start-main-center">
            <div id="start-row-header" class={{ "lang-ru": config.state.language === "ru" }}>
                <div
                    id="server-warning"
                    style={{
                        display: startMenu.teamLinkOpen ? "none" : "block",
                        opacity: warning() && (team.active || startMenu.active) ? 1 : 0,
                    }}
                >
                    {warning()}
                </div>
            </div>
            <div id="start-turnstile-container"></div>
            <div id="start-row-top">
                <div id="start-rotate-reminder" class="menu-column menu-block">
                    <span>{t("index-rotate-reminder")}</span>
                </div>
                <div id="left-column" class="menu-column">
                    <div id="left-block" style={{ display: !layout.landscape && team.active ? "none" : "block" }}>
                    </div>
                    <div id="social-share-block-wrapper">
                        <div
                            id="social-share-block"
                            class="menu-block"
                            style={{ display: team.active || startMenu.teamLinkOpen ? "none" : "block" }}
                        >
                            <div class="btn-social-wrapper">
                                <a
                                    href="https://discord.gg/75RAK3p3K2"
                                    target="_blank"
                                    class="btn-social btn-darken btn-discord"
                                >
                                </a>{" "}
                                <a
                                    href="https://ko-fi.com/survev"
                                    target="_blank"
                                    style={{ display: "none" }}
                                    class="btn-social btn-darken btn-kofi"
                                >
                                </a>{" "}
                                <a
                                    href="https://survev.wiki.gg/"
                                    target="_blank"
                                    class="btn-social btn-darken btn-wiki"
                                >
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
                <StartMenuColumn />
                <TeamMenuColumn />
                <TeamLink />
                <RightColumn />
            </div>
        </div>
    );
}

export function StartTopLeft() {
    return (
        <div id="start-top-left" class={["fade", { faded: hamburgerModal.isOpen() }]}>
            <div id="btn-hamburger" class="icon-hamburger" onClick={stop(() => hamburgerModal.show())}></div>
            <a
                id="btn-discord-top-right"
                style={{ display: "none" }}
                href="https://discord.gg/75RAK3p3K2"
                target="_blank"
                class="btn-social btn-darken btn-discord"
            >
            </a>
            <div id="start-top-left-desktop">
                <div id="featured-streamers" style={{ visibility: startMenu.streamers.length ? "visible" : "hidden" }}>
                    <div class="streaming-header">
                        <div id="streaming-header-title">{t("index-streaming-live")}</div>
                        <div id="streaming-icon"></div>
                    </div>
                    <div class="streamer-list">
                        <For each={startMenu.streamers} keyed={(streamer) => streamer.name}>
                            {(streamer) => (
                                <div class="featured-streamer streamer-tooltip">
                                    <a
                                        href={streamer().url}
                                        target="_blank"
                                        class="btn-streamer btn-darken"
                                        style={{ "background-image": `url(${streamer().img})` }}
                                    >
                                        {streamer().name}{" "}
                                        <span>
                                            {streamer().viewers}{" "}
                                            {t(streamer().viewers === 1 ? "index-viewer" : "index-viewers")}
                                        </span>
                                    </a>
                                </div>
                            )}
                        </For>
                    </div>
                </div>
                <Show when={!device.tablet}>
                    <div id="featured-youtuber" style={{ display: startMenu.youtube ? "block" : "none" }}>
                        <div class="youtube-header">
                            <div id="youtube-header-title">{t("index-featured-youtuber")}</div>
                        </div>
                        <a href={startMenu.youtube?.link ?? ""} target="_blank" class="btn-youtuber btn-darken">
                            {startMenu.youtube?.name}
                        </a>
                    </div>
                </Show>
            </div>
        </div>
    );
}

export function StartBottom() {
    const optionsOpen = () => settingsModal.isOpen() || keybindModal.isOpen();
    return (
        <>
            <div id="start-bottom-left">
                <div id="mobile-settings-front">
                    <div
                        class="btn-settings menu-option btn-darken btn-start-option"
                        onClick={stop(() => settingsModal.show())}
                    >
                    </div>
                </div>
            </div>
            <div id="start-bottom-middle" class={{ "start-bottom-middle-tablet": device.mobile && device.tablet }}>
                <a href="changelogRec.html" target="_blank">ver {import.meta.env.VITE_GAME_VERSION}</a>
            </div>
            <div id="start-bottom-right-wrapper">
                <div id="start-bottom-right" class={["fade", { faded: optionsOpen() }]}>
                    <LanguageSelect />{" "}
                    <div
                        class="btn-settings menu-option btn-darken btn-start-option"
                        onClick={stop(() => settingsModal.show())}
                    >
                    </div>{" "}
                    <div
                        class="btn-keybind menu-option btn-darken btn-start-option"
                        style={{ display: device.mobile ? "none" : "inline-block" }}
                        onClick={stop(() => keybindModal.show())}
                    >
                    </div>{" "}
                    <div
                        id="btn-start-fullscreen"
                        class="btn-fullscreen-toggle menu-option btn-darken btn-start-option"
                        onClick={() => helpers.toggleFullScreen()}
                    >
                    </div>{" "}
                    <div
                        class={[
                            "btn-start-mute btn-sound-toggle menu-option btn-darken btn-start-option",
                            config.state.muteAudio ? "audio-off-icon" : "audio-on-icon",
                        ]}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => config.set("muteAudio", !config.get("muteAudio"))}
                    >
                    </div>
                    {" "}
                </div>
            </div>
        </>
    );
}
