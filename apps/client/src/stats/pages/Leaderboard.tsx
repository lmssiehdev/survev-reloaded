import { useSearchParams } from "@solidjs/router";
import { createMemo, Errored, For, Loading, Show } from "solid-js";
import type { LeaderboardParams, LeaderboardResponse } from "@survev/shared/types/stats.ts";
import { getLeaderboard } from "../api.ts";
import { Spinner } from "../components/Spinner.tsx";
import { gameModes } from "../format.ts";
import { type StatsKey, t } from "../i18n.ts";

const types = {
    most_kills: "stats-most-kills",
    most_damage_dealt: "stats-most-damage",
    kpg: "stats-kpg-full",
    kills: "stats-total-kills",
    wins: "stats-total-wins",
} satisfies Record<LeaderboardParams["type"], StatsKey>;

/** header of the stat column */
const statNames = {
    most_kills: "stats-most-kills",
    most_damage_dealt: "stats-most-damage",
    kpg: "stats-kpg",
    kills: "stats-total-kills",
    wins: "stats-total-wins",
} satisfies Record<LeaderboardParams["type"], StatsKey>;

const intervals = {
    daily: "stats-today",
    weekly: "stats-this-week",
    alltime: "stats-all-time",
} satisfies Record<LeaderboardParams["interval"], StatsKey>;

const teamModes = {
    solo: "stats-solo",
    duo: "stats-duo",
    squad: "stats-squad",
} satisfies Record<LeaderboardParams["teamMode"], StatsKey>;

function oneOf<T extends string>(value: string | undefined, allowed: Record<T, unknown>, fallback: T): T {
    return value !== undefined && value in allowed ? (value as T) : fallback;
}

/** URL search params: ?type=&team=&t=&mapId= */
type LeaderboardSearch = { type: string; team: string; t: string; mapId: string };

export function Leaderboard() {
    const [search, setSearch] = useSearchParams<LeaderboardSearch>();
    const params = createMemo<LeaderboardParams>(() => ({
        type: oneOf(search.type, types, "most_kills"),
        interval: oneOf(search.t, intervals, "daily"),
        teamMode: oneOf(search.team, teamModes, "solo"),
        mapId: search.mapId || "0",
    }));

    function update(next: Partial<LeaderboardParams>) {
        const p = { ...params(), ...next };
        setSearch({ type: p.type, team: p.teamMode, t: p.interval, mapId: p.mapId });
    }

    const rows = createMemo(async () => {
        const data = await getLeaderboard(params());
        if (!data) throw new Error("no leaderboard data");
        return data;
    });

    return (
        <>
            <div class="container mt-3">
                <div class="card card-leaderboard col-lg-8 col-12 p-0">
                    <div class="card-body">
                        <div class="row card-row-top">
                            <div class="col-12">
                                <div class="leaderboard-title ml-sm-3 ml-0 mr-0 mt-3">
                                    {t("index-leaderboards").toUpperCase()}
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
                            value={params().teamMode}
                            options={teamModes}
                            onChange={(teamMode) => update({ teamMode })}
                        />
                    </div>
                    <div class="col-lg-2 col-3 pl-lg-0 pr-lg-3 pl-0 pr-1">
                        <Select
                            id="leaderboard-type"
                            value={params().type}
                            options={types}
                            onChange={(type) => update({ type })}
                        />
                    </div>
                    <div class="col-lg-2 col-3 pl-lg-0 pr-lg-3 pl-0 pr-1">
                        <Select
                            id="leaderboard-time"
                            value={params().interval}
                            options={intervals}
                            onChange={(interval) => update({ interval })}
                        />
                    </div>
                    <div class="col-lg-2 col-3 pl-0">
                        <select
                            id="leaderboard-map-id"
                            class="leaderboard-opt custom-select"
                            value={params().mapId}
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
                            <Errored
                                fallback={
                                    <div class="leaderboard-error">
                                        <h2>Unable to load, please try again.</h2>
                                    </div>
                                }
                            >
                                <Loading fallback={<Spinner kind="leaderboard" />} on={params()}>
                                    <LeaderboardTable type={params().type} rows={rows()} />
                                </Loading>
                            </Errored>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

function Select<T extends string>(props: {
    id: string;
    value: T;
    options: Record<T, StatsKey>;
    onChange: (value: T) => void;
}) {
    return (
        <select
            id={props.id}
            class="leaderboard-opt custom-select"
            value={props.value}
            onChange={(e) => props.onChange(e.currentTarget.value as T)}
        >
            <For each={Object.entries(props.options) as [T, StatsKey][]}>
                {([value, key]) => <option value={value}>{t(key)}</option>}
            </For>
        </select>
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
                    <th class="header-rank" scope="col">{t("stats-rank").toUpperCase()}</th>
                    <th class="header-player" scope="col">{t("stats-player").toUpperCase()}</th>
                    <th class="header-stat" scope="col">{t(statNames[props.type]).toUpperCase()}</th>
                    <Show when={showGames()}>
                        <th class="header-games" scope="col">{t("stats-games").toUpperCase()}</th>
                    </Show>
                    <th class="header-region" scope="col">{t("stats-region").toUpperCase()}</th>
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
                            <td class="data-region">{row.region ? row.region.toUpperCase() : ""}</td>
                        </tr>
                    )}
                </For>
            </tbody>
        </table>
    );
}
