import { For, Match, Show, Switch } from "solid-js";
import { device, layout } from "../../device.ts";
import {
    gameUi,
    gameView,
    humanizeTime,
    px,
    type StatsOverview,
    type StatsPlayerView,
    type StatsScreen,
} from "../gameView.ts";
import { type MessageKey, t, translate } from "../i18n.ts";

/** "<label> " + value, the header's overview entries */
function HeaderStat(props: { class?: string; label: string; value: string | number }) {
    return (
        <div class={props.class}>
            <span class="ui-stats-header-stat">{props.label}{" "}</span>
            <span class="ui-stats-header-value">{props.value}</span>
        </div>
    );
}

function Overview(props: { overview: StatsOverview }) {
    return (
        <Switch>
            <Match when={props.overview.kind === "faction" && props.overview}>
                {(overview) => (
                    <>
                        <HeaderStat
                            class="ui-stats-header-right ui-stats-header-red-team"
                            label={t("game-red-team")}
                            value={overview().red}
                        />
                        <HeaderStat
                            class="ui-stats-header-left ui-stats-header-blue-team"
                            label={t("game-blue-team")}
                            value={overview().blue}
                        />
                    </>
                )}
            </Match>
            <Match when={props.overview.kind === "solo" && props.overview}>
                {(overview) => <HeaderStat label={translate(overview().rankL10n)} value={`#${overview().rank}`} />}
            </Match>
            <Match when={props.overview.kind === "team" && props.overview}>
                {(overview) => (
                    <>
                        <HeaderStat
                            class="ui-stats-header-right"
                            label={translate(overview().rankL10n)}
                            value={`#${overview().rank}`}
                        />
                        <HeaderStat
                            class="ui-stats-header-left"
                            label={t("game-team-kills")}
                            value={overview().kills}
                        />
                    </>
                )}
            </Match>
            <Match when={props.overview.kind === "kills" && props.overview}>
                {(overview) => <HeaderStat label={t("game-kills")} value={overview().kills} />}
            </Match>
        </Switch>
    );
}

/**
 * The screen fades in (CSS `.fade-in`) after `stats.delay`: the background and contents, then
 * each player column and its rows one after another, then the buttons.
 */
const ROW_FADE_MS = 500;
const fadeIn = (delay: number, ms = ROW_FADE_MS) => ({ "--fade-delay": `${delay}ms`, "--fade": `${ms}ms` });

/** a column's rows: name, 4 stats and maybe a badge */
const rowCount = (player: StatsPlayerView) => 5 + (player.badge ? 1 : 0);

/** the large layout (and tablets) */
const wide = () => !layout.small || device.tablet;

/** one "label / value" row of a player column */
function StatsInfo(props: { label: MessageKey; value: string | number; delay: number }) {
    return (
        <div class="ui-stats-info fade-in" style={fadeIn(props.delay)}>
            <div>{t(props.label)}</div>
            <div>{props.value}</div>
        </div>
    );
}

function PlayerColumn(props: { player: StatsPlayerView; left: number; start: number; step: number }) {
    const row = (idx: number) => props.start + ROW_FADE_MS + idx * props.step;
    return (
        <div
            class={["ui-stats-info-player fade-in", { "ui-stats-info-status": props.player.dead }]}
            style={{ left: px(props.left), ...fadeIn(props.start) }}
        >
            <div class="ui-stats-info-player-name fade-in" style={fadeIn(row(0))}>{props.player.name}</div>
            <StatsInfo label="game-kills" value={props.player.kills} delay={row(1)} />
            <StatsInfo label="game-damage-dealt" value={props.player.damageDealt} delay={row(2)} />
            <StatsInfo label="game-damage-taken" value={props.player.damageTaken} delay={row(3)} />
            <StatsInfo label="game-survived" value={humanizeTime(props.player.timeAlive)} delay={row(4)} />
            <Show when={props.player.badge}>
                <div class={`ui-stats-info-player-badge ${props.player.badge} fade-in`} style={fadeIn(row(5))} />
            </Show>
        </div>
    );
}

function StatsContents(props: { stats: StatsScreen }) {
    const stats = props.stats;
    const players = () => Math.max(1, stats.players.length);
    const step = () => 250 / players();
    const base = () => stats.delay + 750 / players();
    /** each column's start: columns and their rows fade in one after another */
    const columnStarts = () => {
        let elemIdx = 0;
        return stats.players.map((player, idx) => {
            const start = base() + (elemIdx + idx) * step();
            elemIdx += rowCount(player) + 1;
            return start;
        });
    };
    /** the columns are centered, 10px apart */
    const columnLeft = (idx: number) => {
        const gaps = stats.players.length - 1;
        return -(gaps * (wide() ? 250 : 125)) / 2 - gaps * 10 + idx * 10;
    };
    const rowsBefore = () => stats.players.reduce((sum, player) => sum + rowCount(player) + 1, 0);
    /** the play-again / spectate buttons, after the columns (or late on a team game's ad screen) */
    const button = (idx: number) =>
        stats.teamAd
            ? fadeIn(4100 + idx * 600 + 300, 750)
            : fadeIn(base() + (rowsBefore() + idx * 2) * step() + 500);
    /** play-again sits left of spectate when both show, or is wide alone */
    const restart = () =>
        stats.spectateButton
            ? { left: px(wide() ? -72 : -46) }
            : { width: px(wide() ? 225 : 130) };

    return (
        <>
            <div
                id="ui-stats-bg"
                class="fade-in"
                style={{ display: "block", opacity: 1, ...fadeIn(stats.delay, 1000) }}
            >
            </div>
            <div
                id="ui-stats-contents"
                style={{
                    top: stats.teamAd ? "10%" : undefined,
                    // a bit smaller below the iPhone X notch
                    ...(device.model == "iphonex"
                        ? { transform: "translate(-50%) scale(0.95)", "transform-origin": "top" }
                        : {}),
                }}
            >
                <div
                    id="ui-stats-contents-inner"
                    class="fade-in"
                    style={{ display: "block", opacity: 1, ...fadeIn(stats.delay, 1000) }}
                >
                    <div id="ui-stats-header">
                        <div>
                            <div class="ui-stats-header-title">{stats.title}</div>
                            <div class="ui-stats-header-overview">
                                <Overview overview={stats.overview} />
                            </div>
                        </div>
                    </div>
                    <div id="ui-stats-info-box" style={{ height: stats.teamAd ? "0px" : undefined }}>
                        <For each={stats.players}>
                            {(player, idx) => (
                                <PlayerColumn
                                    player={player}
                                    left={columnLeft(idx())}
                                    start={columnStarts()[idx()]}
                                    step={step()}
                                />
                            )}
                        </For>
                    </div>
                    <div id="ui-stats-options">
                        <a
                            class="ui-stats-restart btn-green btn-darken menu-option fade-in"
                            style={{ ...restart(), ...button(0) }}
                            onClick={() => gameUi()?.quitGame()}
                        >
                            {t("game-play-new-game")}
                        </a>
                        <Show when={stats.spectateButton}>
                            <a
                                class="btn-green btn-darken menu-option ui-stats-spectate fade-in"
                                style={button(1)}
                                onClick={() => gameUi()?.beginSpectating()}
                            >
                                {t("game-spectate")}
                            </a>
                        </Show>
                    </div>
                    <div id="ui-stats-logo" style={{ display: stats.teamAd ? "none" : "block" }}></div>
                </div>
            </div>
        </>
    );
}

/** #ui-stats: the death / victory screen; a new screen remounts, which restarts the fade-ins */
export function DeathScreen() {
    return (
        <div id="ui-stats" style={{ display: gameView.stats ? "block" : "none" }}>
            <Show when={gameView.stats} keyed>{(stats) => <StatsContents stats={stats} />}</Show>
        </div>
    );
}

/** the debug editor's overlay; debug/editor.ts puts its Tweakpane in #ui-editor-top-right */
export function EditorOverlay() {
    return (
        <div id="ui-editor" style={{ display: gameView.editor ? "block" : "none" }}>
            <div id="ui-editor-top-center">
                <div class="ui-editor-header">EDIT MODE</div>
            </div>
            <div id="ui-editor-top-right"></div>
        </div>
    );
}
