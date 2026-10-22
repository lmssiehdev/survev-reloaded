import { For, Show } from "solid-js";
import type { UserStatsRequest } from "@survev/shared/types/stats.ts";
import { ALL_MAPS, STATS_INTERVALS } from "@survev/shared/types/statsFilters.ts";
import { Select } from "../components/Select.tsx";
import { gameModes, intervalLabels, type ModeCard, type Profile } from "../format.ts";
import { t } from "../i18n.ts";

export type PlayerCardsFilters = Pick<UserStatsRequest, "interval" | "mapIdFilter">;

/** the green card at the top: avatar, name, totals, or a message */
export function OverviewCard(props: { profile?: Profile; message?: string }) {
    return (
        <div class={["container mt-3", { "mb-3": !props.profile }]}>
            <div class="card card-player col-lg-8 col-12 p-0">
                <div class="card-body">
                    <div class="row card-row-top">
                        <Show
                            when={props.profile}
                            fallback={
                                <div class="col-lg-10">
                                    <div class="card-player-name mt-3 ml-3">{props.message}</div>
                                </div>
                            }
                        >
                            {(profile) => (
                                <>
                                    <div class="col-md-1 col-sm-2 col-3">
                                        <div
                                            class="player-image"
                                            style={{ "background-image": `url("${profile().avatarTexture}")` }}
                                        >
                                        </div>
                                    </div>
                                    <div class="col-md-5 col-sm-10 col-9">
                                        <div
                                            class={["card-player-name ml-md-5 ml-sm-1 ml-xs-1", {
                                                "mt-3": !profile().banned,
                                            }]}
                                        >
                                            {profile().username}
                                        </div>
                                        <Show when={profile().banned}>
                                            <div class="card-player-banned ml-md-5">{t("stats-banned")}</div>
                                        </Show>
                                    </div>
                                    <div class="col-md-6 col-12">
                                        <table class="player-stats-overview">
                                            <thead>
                                                <tr>
                                                    <th scope="col">{t("stats-wins")}</th>
                                                    <th scope="col">{t("stats-kills")}</th>
                                                    <th scope="col">{t("stats-games")}</th>
                                                    <th scope="col">{t("stats-kg")}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>{profile().wins}</td>
                                                    <td>{profile().kills}</td>
                                                    <td>{profile().games}</td>
                                                    <td>{profile().kpg}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </Show>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** time + map selectors */
export function PlayerFilters(props: {
    filters: PlayerCardsFilters;
    onChange: (filters: Partial<PlayerCardsFilters>) => void;
}) {
    return (
        <div class="container mt-3">
            <div class="row">
                <div class="col-lg-2 col-6">
                    <Select
                        id="player-time"
                        class="player-opt"
                        value={props.filters.interval}
                        values={STATS_INTERVALS}
                        labels={intervalLabels}
                        onChange={(interval) => props.onChange({ interval })}
                    />
                </div>
                <div class="col-lg-2 col-6 pl-0">
                    <select
                        id="player-map-id"
                        class="player-opt custom-select"
                        value={props.filters.mapIdFilter}
                        onChange={(e) => props.onChange({ mapIdFilter: e.currentTarget.value })}
                    >
                        <option value={ALL_MAPS}>{t("all")}</option>
                        <For each={gameModes}>
                            {(mode) => <option value={mode.mapId}>{mode.desc.name}</option>}
                        </For>
                    </select>
                </div>
                <div class="offset-6 col-2 col-rating-help">
                    <div class="rating-help">
                        {t("stats-rating-help")}
                        <div class="rating-help-desc">
                            <span class="highlight">{t("stats-coming-soon")}</span>
                            <br />
                            {t("stats-rating-desc")}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ModeCards(props: { cards: ModeCard[] }) {
    return (
        <div class="container mt-3">
            <div class="row">
                <For each={props.cards}>
                    {(card, i) => (
                        <div class={["col-lg-4 col-12", { "pr-lg-0": i() < props.cards.length - 1 }]}>
                            <div class={`card card-mode card-mode-bg-${i()}`}>
                                <div class="card-body p-1">
                                    <div class="row card-mode-row-top">
                                        <div class="col-2 p-0">
                                            <div class={`mode-image mode-image-${card.name}`}></div>
                                        </div>
                                        <div class="col-5 p-0">
                                            <div class={`mode-name mode-name-${card.name}`}>
                                                {t(`stats-${card.name}`)}
                                            </div>
                                        </div>
                                        <div class="col-5 mt-2">
                                            <Show when={card.games > 0}>
                                                <div class="mode-games">
                                                    <span>{card.games}</span> <span>{t("stats-games")}</span>
                                                </div>
                                            </Show>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Show
                                when={card.games > 0}
                                fallback={
                                    <div class="card card-mode card-mode-no-games">
                                        <div class="col-12">{t("stats-no-games")}</div>
                                    </div>
                                }
                            >
                                <div class="card card-mode card-mode-bg-mid">
                                    <div class="card-body p-1">
                                        <div class="row m-1">
                                            <For each={card.midStats}>
                                                {(stat) => (
                                                    <div class="col-6 mt-1 mb-1">
                                                        <div class="card-mode-stat-mid">
                                                            <div class="card-mode-stat-name">
                                                                {t(stat.key)}
                                                            </div>
                                                            <div class="card-mode-stat-value">{stat.val}</div>
                                                        </div>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </div>
                                </div>
                                <div class="card card-mode card-mode-bg-bot">
                                    <div class="card-body p-1">
                                        <div class="row m-1">
                                            <For each={card.botStats}>
                                                {(stat) => (
                                                    <div class="col-6 mt-1 mb-1">
                                                        <div class="card-mode-stat-bot">
                                                            <div class="card-mode-stat-name">
                                                                {t(stat.key)}
                                                            </div>
                                                            <div class="card-mode-stat-value">{stat.val}</div>
                                                        </div>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </div>
                                </div>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
}
