import { createEffect, For, Match, Show, Switch } from "solid-js";
import { cancelFade, fadeIn } from "../fade.ts";
import { gameUi, gameView, humanizeTime, px, type StatsPlayerView } from "../gameView.ts";
import { type MessageKey, t, translate } from "../i18n.ts";

/** one "label / value" row of a player column */
function StatsInfo(props: { label: MessageKey; value: string | number }) {
    return (
        <div class="ui-stats-info">
            <div>{t(props.label)}</div>
            <div>{props.value}</div>
        </div>
    );
}

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

function PlayerColumn(props: { player: StatsPlayerView }) {
    return (
        <div
            class={["ui-stats-info-player", { "ui-stats-info-status": props.player.dead }]}
            style={{ left: px(props.player.left) }}
        >
            <div class="ui-stats-info-player-name">{props.player.name}</div>
            <StatsInfo label="game-kills" value={props.player.kills} />
            <StatsInfo label="game-damage-dealt" value={props.player.damageDealt} />
            <StatsInfo label="game-damage-taken" value={props.player.damageTaken} />
            <StatsInfo label="game-survived" value={humanizeTime(props.player.timeAlive)} />
            <Show when={props.player.badge}>
                <div class={`ui-stats-info-player-badge ${props.player.badge}`}></div>
            </Show>
        </div>
    );
}

const fadeFrom0 = (el: Element, delay: number, duration: number) =>
    el.animate([{ opacity: 0 }, { opacity: 1 }], { delay, duration, easing: "ease-in-out", fill: "backwards" });

/**
 * #ui-stats: the death / victory screen. It fades in after `stats.delay`: the background and
 * contents, then each player column and its rows, then the buttons (jQuery's timings).
 */
export function DeathScreen() {
    let bg: HTMLElement | undefined;
    let inner: HTMLElement | undefined;
    let infoBox: HTMLElement | undefined;
    let options: HTMLElement | undefined;

    createEffect(
        () => ({
            seq: gameView.stats.seq,
            contents: gameView.stats.contents,
            delay: gameView.stats.delay,
            teamAd: gameView.stats.teamAd,
            playerCount: gameView.stats.players.length,
        }),
        (screen) => {
            if (!screen.contents || !bg || !inner || !infoBox || !options) return;
            const anims = [fadeFrom0(bg, screen.delay, 1000), fadeFrom0(inner, screen.delay, 1000)];
            const timers: ReturnType<typeof setTimeout>[] = [];
            const buttons = [...options.children].filter((el) => el instanceof HTMLElement);
            const showButton = (el: HTMLElement, delay: number, duration: number) => {
                el.style.display = "none";
                timers.push(setTimeout(() => fadeIn(el, duration), delay));
            };

            let elemIdx = 0;
            if (screen.teamAd) {
                buttons.forEach((el, idx) => {
                    showButton(el, 4100 + (elemIdx + idx) * 300 + 300, 750);
                    elemIdx++;
                });
            } else {
                const elemFadeTime = 500;
                const elemDelay = 250 / Math.max(1, screen.playerCount);
                const baseDelay = 750 / Math.max(1, screen.playerCount);
                [...infoBox.children].forEach((column, idx) => {
                    const start = screen.delay + baseDelay + (elemIdx + idx) * elemDelay;
                    anims.push(fadeFrom0(column, start, elemFadeTime));
                    // each row once its column is in
                    [...column.children].forEach((row, rowIdx) => {
                        anims.push(fadeFrom0(row, start + elemFadeTime + rowIdx * elemDelay, elemFadeTime));
                        elemIdx++;
                    });
                    elemIdx++;
                });
                buttons.forEach((el, idx) => {
                    showButton(el, screen.delay + baseDelay + (elemIdx + idx) * elemDelay + 500, elemFadeTime);
                    elemIdx++;
                });
            }

            return () => {
                for (const anim of anims) anim.cancel();
                for (const timer of timers) clearTimeout(timer);
                for (const el of buttons) cancelFade(el);
            };
        },
    );

    return (
        <div id="ui-stats" style={{ display: gameView.stats.open ? "block" : "none" }}>
            <div
                id="ui-stats-bg"
                ref={(el) => (bg = el)}
                style={{
                    display: gameView.stats.contents ? "block" : "none",
                    opacity: gameView.stats.contents ? 1 : 0,
                }}
            >
            </div>
            <div id="ui-stats-contents" style={{ top: gameView.stats.teamAd ? "10%" : undefined }}>
                <div
                    id="ui-stats-contents-inner"
                    ref={(el) => (inner = el)}
                    style={{
                        display: gameView.stats.contents ? "block" : "none",
                        opacity: gameView.stats.contents ? 1 : 0,
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
                        ref={(el) => (infoBox = el)}
                        style={{ height: gameView.stats.teamAd ? "0px" : undefined }}
                    >
                        <For each={gameView.stats.players}>
                            {(player) => <PlayerColumn player={player} />}
                        </For>
                    </div>
                    <div id="ui-stats-options" ref={(el) => (options = el)}>
                        <Show when={gameView.stats.filled}>
                            <a
                                class="ui-stats-restart btn-green btn-darken menu-option"
                                style={{
                                    width: px(gameView.stats.restartWidth),
                                    left: px(gameView.stats.restartLeft),
                                }}
                                onClick={() => gameUi()?.quitGame()}
                            >
                                {t("game-play-new-game")}
                            </a>
                            <Show when={gameView.stats.spectateButton}>
                                <a
                                    class="btn-green btn-darken menu-option ui-stats-spectate"
                                    onClick={() => gameUi()?.beginSpectating()}
                                >
                                    {t("game-spectate")}
                                </a>
                            </Show>
                        </Show>
                    </div>
                    <div id="ui-stats-logo" style={{ display: gameView.stats.teamAd ? "none" : "block" }}></div>
                </div>
            </div>
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
