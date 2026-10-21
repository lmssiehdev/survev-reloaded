import type { JSX } from "@solidjs/web";
import { createMemo, Errored, For, Loading, Show } from "solid-js";
import type { TeamMode } from "@survev/shared/gameConfig.ts";
import { ALL_TEAM_MODES, type MatchData, type MatchHistory } from "@survev/shared/types/stats.ts";
import { getMatchData } from "../api.ts";
import { Spinner } from "../components/Spinner.tsx";
import { formatTime, gameModes, teamModeNames, timeAgo } from "../format.ts";
import { t } from "../i18n.ts";

export type TeamModeFilter = TeamMode | typeof ALL_TEAM_MODES;

export interface HistoryState {
    games: MatchHistory[];
    loading: boolean;
    error: boolean;
    moreAvailable: boolean;
    teamModeFilter: TeamModeFilter;
}

const filters: [TeamModeFilter, string][] = [[ALL_TEAM_MODES, "All"], [1, "Solo"], [2, "Duo"], [4, "Squad"]];

/** team mode filter, "Matches" tab and the match list */
export function ExtraStats(props: {
    slug: string;
    history: HistoryState;
    expandedId?: string;
    onFilter: (filter: TeamModeFilter) => void;
    onToggle: (gameId: string) => void;
    onMore: () => void;
}) {
    return (
        <>
            <div class="container mt-3">
                <div class="row m-0">
                    <For each={filters}>
                        {([filter, label], i) => (
                            <div class={i() === 0 ? "offset-0 offset-md-8 col-3 col-md-1 p-0" : "col-3 col-md-1 p-0"}>
                                <div
                                    class={[
                                        "extra-team-mode-filter",
                                        "btn-darken",
                                        { "extra-team-mode-filter-selected": props.history.teamModeFilter === filter },
                                    ]}
                                    data-filter={filter}
                                    onClick={() =>
                                        props.onFilter(filter)}
                                >
                                    {label}
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </div>
            <div class="container mt-3">
                <div class="row">
                    <div class="offset-8 col-4"></div>
                </div>
                <div class="row">
                    <div class="col-12 col-md-2">
                        <div id="selector-extra-matches" class="extra-matches selector-extra col-2 col-md-12 p-0">
                            Matches<span class="selected-extra"></span>
                        </div>
                    </div>
                    <div id="match-history" class="col-12 col-md-10">
                        <Show
                            when={props.history.games.length > 0 || !props.history.loading}
                            fallback={<Spinner kind="match-history" />}
                        >
                            <MatchList {...props} />
                        </Show>
                    </div>
                </div>
            </div>
        </>
    );
}

function MatchList(props: {
    slug: string;
    history: HistoryState;
    expandedId?: string;
    onToggle: (gameId: string) => void;
    onMore: () => void;
}) {
    return (
        <>
            <div class="header-extra">MATCH HISTORY</div>
            <Show
                when={!props.history.error && props.history.games.length > 0}
                fallback={
                    <div class="col-lg-10">
                        <div class="m-3">
                            {props.history.error
                                ? "Error loading content, please try again."
                                : "No recent games played."}
                        </div>
                    </div>
                }
            >
                <div class="col-lg-12">
                    <For each={props.history.games}>
                        {(game) => (
                            <MatchRow
                                game={game}
                                slug={props.slug}
                                expanded={game.guid === props.expandedId}
                                onToggle={() => props.onToggle(game.guid)}
                            />
                        )}
                    </For>
                </div>
                <Show when={props.history.moreAvailable}>
                    <Show
                        when={!props.history.loading}
                        fallback={<Spinner kind="match-data" />}
                    >
                        <div class="col-12 js-match-load-more btn-darken" onClick={() => props.onMore()}>More</div>
                    </Show>
                </Show>
            </Show>
        </>
    );
}

function MatchStat(props: { name: string; size: "md" | "lg"; children: JSX.Element }) {
    return (
        <div class="match-link-stat">
            <div class={`match-link-stat-name match-link-stat-name-${props.size}`}>{props.name}</div>
            <div class={`match-link-stat-value match-link-stat-value-${props.size}`}>{props.children}</div>
        </div>
    );
}

function MatchRow(props: { game: MatchHistory; slug: string; expanded: boolean; onToggle: () => void }) {
    const mode = () => teamModeNames[props.game.team_mode as TeamMode];
    const icon = () => gameModes.find((m) => m.mapId == props.game.map_id)?.desc.icon;

    return (
        <div
            class={["row row-match match-link js-match-data", { "match-link-expanded": props.expanded }]}
            data-game-id={props.game.guid}
            onClick={(e) => {
                // links to other players don't toggle the row
                if (!(e.target as Element).closest("a")) props.onToggle();
            }}
        >
            <div class={`match-link-mode-color match-link-mode-${mode()}`}></div>
            <div class="hide-xs col-2">
                <div class="match-link-player-icons">
                    {/* inline-block icons, separated by spaces like the old template */}
                    <For each={Array.from({ length: props.game.team_count })}>
                        {() => (
                            <>
                                <div class="match-link-player-icon"></div>
                                {" "}
                            </>
                        )}
                    </For>
                </div>
                <div class="match-link-start-time">{timeAgo(props.game.end_time)}</div>
            </div>
            <div class="col-3">
                <MatchStat name={t(`stats-${mode()}-rank`)} size="lg">
                    <span class={`match-link-stat-rank match-link-stat-${props.game.rank}`}>#{props.game.rank}</span>
                    {" "}
                    /{props.game.team_total || 80}
                </MatchStat>
            </div>
            <div class="col-2 col-md-1">
                <MatchStat name={t("stats-kills")} size="md">{props.game.kills}</MatchStat>
            </div>
            <Show when={mode() !== "solo"}>
                <div class="hide-xs col-md-1">
                    <MatchStat name={t("stats-team-kills")} size="md">{props.game.team_kills || 0}</MatchStat>
                </div>
            </Show>
            <div class={["col-2 col-md-1", { "offset-md-1": mode() === "solo" }]}>
                <MatchStat name={t("stats-damage-dealt")} size="md">{props.game.damage_dealt}</MatchStat>
            </div>
            <div class="col-2 col-md-1">
                <MatchStat name={t("stats-damage-taken")} size="md">{props.game.damage_taken}</MatchStat>
            </div>
            <div class="col-2 col-md-1">
                <MatchStat name={t("stats-survived")} size="md">{formatTime(props.game.time_alive)}</MatchStat>
            </div>
            <div class="hide-xs col-md-1">
                <Show when={icon()}>
                    {(icon) => (
                        <div class="match-link-stat">
                            <div class="game-mode-icon" style={{ "background-image": `url(/${icon()})` }}></div>
                        </div>
                    )}
                </Show>
            </div>
            <div class="offset-0 col-1 pl-0 pr-0">
                <div class={["match-link-expand", props.expanded ? "match-link-expand-up" : "match-link-expand-down"]}>
                </div>
            </div>

            <Show when={props.expanded}>
                <div id="match-data" class="col-lg-12">
                    <MatchDetails gameId={props.game.guid} slug={props.slug} />
                </div>
            </Show>
        </div>
    );
}

function MatchDataError() {
    return (
        <div class="col-lg-10">
            <div class="m-3">Error loading content, please try again.</div>
        </div>
    );
}

function MatchDetails(props: { gameId: string; slug: string }) {
    const players = createMemo(async () => {
        const data = await getMatchData({ gameId: props.gameId });
        if (!data?.length) throw new Error("no match data");
        return data;
    });
    return (
        <Errored fallback={<MatchDataError />}>
            <Loading fallback={<Spinner kind="match-data" />}>
                <MatchTable players={players()} slug={props.slug} />
            </Loading>
        </Errored>
    );
}

function MatchTable(props: { players: MatchData[]; slug: string }) {
    /** this player's player_id in the match, 0 if they're not in it */
    const localId = () => props.players.find((p) => p.slug == props.slug)?.player_id || 0;
    /** rank is shown on the first row of each team; teams alternate row colors */
    const rows = createMemo(() => {
        let teamId = 0;
        let teamIdx = 0;
        return props.players.map((player) => {
            const firstOfTeam = player.team_id != teamId;
            if (firstOfTeam) {
                teamId = player.team_id;
                teamIdx++;
            }
            return { player, firstOfTeam, dark: teamIdx % 2 == 0 };
        });
    });
    const headers = (
        <tr class="match-headers">
            <th class="match-header-rank" scope="col">{t("stats-rank").toUpperCase()}</th>
            <th class="match-header-icon hide-xs" scope="col"></th>
            <th class="match-header-player" scope="col">{t("stats-player").toUpperCase()}</th>
            <th class="match-header-stat" scope="col">{t("stats-kills").toUpperCase()}</th>
            <th class="match-header-stat hide-xs" scope="col">{t("stats-damage").toUpperCase()}</th>
            <th class="match-header-stat" scope="col">{t("stats-survived").toUpperCase()}</th>
        </tr>
    );

    return (
        <>
            <div class="match-header-wrapper">
                <table class="match-table">
                    <thead>{headers}</thead>
                </table>
            </div>
            <div class="match-table-wrapper">
                <table class="match-table">
                    <thead>
                        <tr class="match-headers">
                            <th class="match-header-rank"></th>
                            <th class="match-header-icon hide-xs"></th>
                            <th class="match-header-player"></th>
                            <th class="match-header-stat"></th>
                            <th class="match-header-stat hide-xs"></th>
                            <th class="match-header-stat"></th>
                        </tr>
                    </thead>
                    <tbody class="match-values">
                        <For each={rows()}>
                            {(row) => (
                                <tr
                                    class={[
                                        "main single-player",
                                        row.dark ? "match-row-dark" : "match-row-light",
                                        { "match-row-local": row.player.player_id == localId() },
                                    ]}
                                >
                                    <td
                                        class={{ "data-rank": row.firstOfTeam }}
                                        scope={row.firstOfTeam ? "row" : undefined}
                                    >
                                        {row.firstOfTeam ? `#${row.player.rank}` : ""}
                                    </td>
                                    <td class="data-player-status hide-xs">
                                        <Show when={localId() != 0 && row.player.killer_id == localId()}>
                                            <div class="player-icon player-kill"></div>
                                        </Show>
                                        <Show when={localId() != 0 && row.player.killed_ids?.includes(localId())}>
                                            <div class="player-icon player-death"></div>
                                        </Show>
                                    </td>
                                    <td class="data-player-names">
                                        <span class="player-name">
                                            <Show when={row.player.slug} fallback={row.player.username}>
                                                {(slug) => (
                                                    <a class="player-slug" href={`/stats/?slug=${slug()}`} link>
                                                        {row.player.username}
                                                    </a>
                                                )}
                                            </Show>
                                        </span>
                                    </td>
                                    <td>{row.player.kills}</td>
                                    <td class="hide-xs">{row.player.damage_dealt}</td>
                                    <td>{formatTime(row.player.time_alive)}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>
        </>
    );
}
