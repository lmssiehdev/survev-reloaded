import type { LeaderboardParams, LeaderboardResponse } from "@survev/shared/types/stats.ts";
import { LEADERBOARD_TYPES, STATS_INTERVALS, TEAM_MODE_NAMES } from "@survev/shared/types/statsFilters.ts";
import { createMemo, Errored, For, Loading, Show } from "solid-js";
import { getLeaderboard } from "../api.ts";
import { Select } from "../components/Select.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { gameModes, intervalLabels, leaderboardStatLabels, leaderboardTypeLabels, teamModeLabels } from "../format.ts";
import { t } from "../i18n.ts";
import { oneOf, text, useSearchState } from "../searchState.ts";

export function Leaderboard() {
    // ?type=&team=&t=&mapId=
    const [params, update] = useSearchState<LeaderboardParams>({
        type: oneOf("type", LEADERBOARD_TYPES, "most_kills"),
        teamMode: oneOf("team", TEAM_MODE_NAMES, "solo"),
        interval: oneOf("t", STATS_INTERVALS, "daily"),
        mapId: text("mapId", "0"),
    });

    const rows = createMemo(() => getLeaderboard({ ...params }));

    return (
        <>
            <div class="container mt-3">
                <div class="card card-leaderboard col-lg-8 col-12 p-0">
                    <div class="card-body">
                        <div class="row card-row-top">
                            <div class="col-12">
                                <div class="leaderboard-title ml-sm-3 ml-0 mr-0 mt-3">
                                    {t("index-leaderboards")}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="container mt-3">
                <div class="row">
                    <div class="col-lg-2 col-3 pr-lg-3 pr-1">
                        <Select
                            id="leaderboard-team-mode"
                            class="leaderboard-opt"
                            value={params.teamMode}
                            values={TEAM_MODE_NAMES}
                            labels={teamModeLabels}
                            onChange={(teamMode) => update({ teamMode })}
                        />
                    </div>
                    <div class="col-lg-2 col-3 pl-lg-0 pr-lg-3 pl-0 pr-1">
                        <Select
                            id="leaderboard-type"
                            class="leaderboard-opt"
                            value={params.type}
                            values={LEADERBOARD_TYPES}
                            labels={leaderboardTypeLabels}
                            onChange={(type) => update({ type })}
                        />
                    </div>
                    <div class="col-lg-2 col-3 pl-lg-0 pr-lg-3 pl-0 pr-1">
                        <Select
                            id="leaderboard-time"
                            class="leaderboard-opt"
                            value={params.interval}
                            values={STATS_INTERVALS}
                            labels={intervalLabels}
                            onChange={(interval) => update({ interval })}
                        />
                    </div>
                    <div class="col-lg-2 col-3 pl-0">
                        <select
                            id="leaderboard-map-id"
                            class="leaderboard-opt custom-select"
                            value={params.mapId}
                            onChange={(e) => update({ mapId: e.currentTarget.value })}
                        >
                            <For each={gameModes}>
                                {(mode) => <option value={mode.mapId}>{mode.desc.name}</option>}
                            </For>
                        </select>
                    </div>
                </div>
            </div>

            <div class="container mt-2 mb-4 p-sm-3 p-0">
                <div class="row justify-content-center">
                    <div class="col-md-12">
                        <div class="content">
                            <Errored fallback={<LeaderboardError />}>
                                <Loading fallback={<Spinner kind="leaderboard" />} on={{ ...params }}>
                                    {/* the API answers null when it has no data */}
                                    <Show when={rows()} fallback={<LeaderboardError />}>
                                        {(rows) => <LeaderboardTable type={params.type} rows={rows()} />}
                                    </Show>
                                </Loading>
                            </Errored>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

function LeaderboardError() {
    return (
        <div class="leaderboard-error">
            <h2>{t("stats-leaderboard-error")}</h2>
        </div>
    );
}

function PlayerName(props: { slug: string | null; username: string }) {
    return (
        <span class="player-name">
            <Show when={props.slug} fallback={props.username}>
                {(slug) => <a href={`/stats/?slug=${slug()}`} link>{props.username}</a>}
            </Show>
        </span>
    );
}

function LeaderboardTable(props: { type: LeaderboardParams["type"]; rows: LeaderboardResponse[] }) {
    const showGames = () => props.type !== "most_kills";

    return (
        <table id="leaderboard-table">
            <thead>
                <tr class="leaderboard-headers">
                    <th class="header-rank" scope="col">{t("stats-rank")}</th>
                    <th class="header-player" scope="col">{t("stats-player")}</th>
                    <th class="header-stat" scope="col">{t(leaderboardStatLabels[props.type])}</th>
                    <Show when={showGames()}>
                        <th class="header-games" scope="col">{t("stats-games")}</th>
                    </Show>
                    <th class="header-region" scope="col">{t("stats-region")}</th>
                </tr>
            </thead>
            <tbody class="leaderboard-values">
                <For each={props.rows}>
                    {(row, i) => (
                        <tr class={["main", "slugs" in row ? "multiple-players" : "single-player"]}>
                            <td class="data-rank" scope="row">#{i() + 1}</td>
                            <td class="data-player-names">
                                {"slugs" in row
                                    ? (
                                        <For each={row.slugs}>
                                            {(slug, j) => <PlayerName slug={slug} username={row.usernames[j()]} />}
                                        </For>
                                    )
                                    : <PlayerName slug={row.slug} username={row.username} />}
                            </td>
                            <td>{row.val}</td>
                            <Show when={showGames()}>
                                <td>{row.games}</td>
                            </Show>
                            <td class="data-region">{row.region}</td>
                        </tr>
                    )}
                </For>
            </tbody>
        </table>
    );
}
