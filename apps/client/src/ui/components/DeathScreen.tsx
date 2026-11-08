import { For, Match, Show, Switch } from "solid-js";
import { gameUi, gameView, humanizeTime, px, type StatsPlayerView } from "../gameView.ts";
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

function Overview() {
    const overview = () => gameView.stats.overview;
    return (
        <Switch>
            <Match when={overview().kind === "faction"}>
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
            </Match>
            <Match when={overview().kind === "solo"}>
                <HeaderStat label={translate(overview().rankL10n)} value={`#${overview().rank}`} />
            </Match>
            <Match when={overview().kind === "team"}>
                <HeaderStat
                    class="ui-stats-header-right"
                    label={translate(overview().rankL10n)}
                    value={`#${overview().rank}`}
                />
                <HeaderStat class="ui-stats-header-left" label={t("game-team-kills")} value={overview().kills} />
            </Match>
            <Match when={overview().kind === "kills"}>
                <HeaderStat label={t("game-kills")} value={overview().kills} />
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

/** one "label / value" row of a player column */
function StatsInfo(props: { label: MessageKey; value: string | number; delay: number }) {
    return (
        <div class="ui-stats-info fade-in" style={fadeIn(props.delay)}>
            <div>{t(props.label)}</div>
            <div>{props.value}</div>
        </div>
    );
}

function PlayerColumn(props: { player: StatsPlayerView; start: number; step: number }) {
    const row = (idx: number) => props.start + ROW_FADE_MS + idx * props.step;
    return (
        <div
            class={["ui-stats-info-player fade-in", { "ui-stats-info-status": props.player.dead }]}
            style={{ left: px(props.player.left), ...fadeIn(props.start) }}
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

/** #ui-stats: the death / victory screen */
export function DeathScreen() {
    const players = () => Math.max(1, gameView.stats.players.length);
    const step = () => 250 / players();
    const base = () => gameView.stats.delay + 750 / players();
    /** each column's start: columns and their rows fade in one after another */
    const columnStarts = () => {
        let elemIdx = 0;
        return gameView.stats.players.map((player, idx) => {
            const start = base() + (elemIdx + idx) * step();
            elemIdx += rowCount(player) + 1;
            return start;
        });
    };
    const rowsBefore = () => gameView.stats.players.reduce((sum, player) => sum + rowCount(player) + 1, 0);
    /** the play-again / spectate buttons, after the columns (or late on a team game's ad screen) */
    const button = (idx: number) =>
        gameView.stats.teamAd
            ? fadeIn(4100 + idx * 600 + 300, 750)
            : fadeIn(base() + (rowsBefore() + idx * 2) * step() + 500);

    return (
        <div id="ui-stats" style={{ display: gameView.stats.open ? "block" : "none" }}>
            {/* remounts each time the screen opens, which restarts the fade-ins */}
            <Show when={gameView.stats.seq} keyed>
                {(_seq) => (
                    <>
                        <div
                            id="ui-stats-bg"
                            class="fade-in"
                            style={{
                                display: gameView.stats.contents ? "block" : "none",
                                opacity: gameView.stats.contents ? 1 : 0,
                                ...fadeIn(gameView.stats.delay, 1000),
                            }}
                        >
                        </div>
                        <div id="ui-stats-contents" style={{ top: gameView.stats.teamAd ? "10%" : undefined }}>
                            <div
                                id="ui-stats-contents-inner"
                                class="fade-in"
                                style={{
                                    display: gameView.stats.contents ? "block" : "none",
                                    opacity: gameView.stats.contents ? 1 : 0,
                                    ...fadeIn(gameView.stats.delay, 1000),
                                }}
                            >
                                <div id="ui-stats-header">
                                    <Show when={gameView.stats.filled}>
                                        <div>
                                            <div class="ui-stats-header-title">{gameView.stats.title}</div>
                                            <div class="ui-stats-header-overview">
                                                <Overview />
                                            </div>
                                        </div>
                                    </Show>
                                </div>
                                <div
                                    id="ui-stats-info-box"
                                    style={{ height: gameView.stats.teamAd ? "0px" : undefined }}
                                >
                                    <For each={gameView.stats.players}>
                                        {(player, idx) => (
                                            <PlayerColumn player={player} start={columnStarts()[idx()]} step={step()} />
                                        )}
                                    </For>
                                </div>
                                <div id="ui-stats-options">
                                    <Show when={gameView.stats.filled}>
                                        <a
                                            class="ui-stats-restart btn-green btn-darken menu-option fade-in"
                                            style={{
                                                width: px(gameView.stats.restartWidth),
                                                left: px(gameView.stats.restartLeft),
                                                ...button(0),
                                            }}
                                            onClick={() => gameUi()?.quitGame()}
                                        >
                                            {t("game-play-new-game")}
                                        </a>
                                        <Show when={gameView.stats.spectateButton}>
                                            <a
                                                class="btn-green btn-darken menu-option ui-stats-spectate fade-in"
                                                style={button(1)}
                                                onClick={() => gameUi()?.beginSpectating()}
                                            >
                                                {t("game-spectate")}
                                            </a>
                                        </Show>
                                    </Show>
                                </div>
                                <div id="ui-stats-logo" style={{ display: gameView.stats.teamAd ? "none" : "block" }}>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </Show>
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
