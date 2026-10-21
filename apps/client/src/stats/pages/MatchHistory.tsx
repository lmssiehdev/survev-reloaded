import { ToggleGroup } from "@kobalte/core/toggle-group";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, Errored, For, Loading, onSettled, Repeat, Show } from "solid-js";
import type { TeamMode } from "@survev/shared/gameConfig.ts";
import type { MatchData, MatchHistory } from "@survev/shared/types/stats.ts";
import { ALL_TEAM_MODES } from "@survev/shared/types/statsFilters.ts";
import { getMatchData, getMatchHistory } from "../api.ts";
import { Spinner } from "../components/Spinner.tsx";
import { formatTime, gameModes, teamModeNames, timeAgo } from "../format.ts";
import { type StatsKey, t } from "../i18n.ts";

export type TeamModeFilter = TeamMode | typeof ALL_TEAM_MODES;

export const PAGE_SIZE = 10;

const filters = [
    [ALL_TEAM_MODES, "stats-all"],
    [1, "stats-solo"],
    [2, "stats-duo"],
    [4, "stats-squad"],
] satisfies [TeamModeFilter, StatsKey][];

interface MatchListProps {
    slug: string;
    /** the open match, from ?gameId= */
    expandedId?: string;
    /** the match linked when the page opened; it's scrolled into view once */
    scrollToId?: string;
    onToggle: (gameId: string) => void;
}

/** team mode filter, "Matches" tab and the match list */
export function MatchHistorySection(props: MatchListProps) {
    const [filter, setFilter] = createSignal<TeamModeFilter>(ALL_TEAM_MODES);

    return (
        <>
            <ToggleGroup
                class="container mt-3"
                value={String(filter())}
                onChange={(value) => {
                    if (value) setFilter(Number(value) as TeamModeFilter);
                }}
            >
                <div class="row m-0">
                    <For each={filters}>
                        {([value, label], i) => (
                            <div class={["col-3 col-md-1 p-0", { "offset-0 offset-md-8": i() === 0 }]}>
                                <ToggleGroup.Item class="extra-team-mode-filter btn-darken" value={String(value)}>
                                    {t(label)}
                                </ToggleGroup.Item>
                            </div>
                        )}
                    </For>
                </div>
            </ToggleGroup>
            <div class="container mt-3">
                <div class="row">
                    <div class="col-12 col-md-2">
                        <div class="extra-matches selector-extra col-2 col-md-12 p-0">
                            {t("stats-matches")}
                            <span class="selected-extra"></span>
                        </div>
                    </div>
                    <div id="match-history" class="col-12 col-md-10">
                        {/* a new filter starts over from the first page */}
                        <Show when={filter()} keyed>
                            {(teamModeFilter) => <MatchList {...props} teamModeFilter={teamModeFilter} />}
                        </Show>
                    </div>
                </div>
            </div>
        </>
    );
}

function Message(props: { children: JSX.Element }) {
    return (
        <div class="col-lg-10">
            <div class="m-3">{props.children}</div>
        </div>
    );
}

/** pages of matches; each page fetches itself, "More" adds one */
function MatchList(props: MatchListProps & { teamModeFilter: TeamModeFilter }) {
    const [pageCount, setPageCount] = createSignal(1);

    return (
        <Loading fallback={<Spinner kind="match-history" />}>
            <div class="header-extra">{t("stats-match-history")}</div>
            <Repeat count={pageCount()}>
                {(index) => {
                    const page = (
                        <Errored fallback={<Message>{t("stats-error-loading")}</Message>}>
                            <MatchPage
                                {...props}
                                index={index}
                                last={index === pageCount() - 1}
                                onMore={() => setPageCount((n) => n + 1)}
                            />
                        </Errored>
                    );
                    // the first page shows the list's spinner, later ones show their own under the list
                    return index === 0 ? page : <Loading fallback={<Spinner kind="match-data" />}>{page}</Loading>;
                }}
            </Repeat>
        </Loading>
    );
}

function MatchPage(
    props: MatchListProps & {
        teamModeFilter: TeamModeFilter;
        index: number;
        last: boolean;
        onMore: () => void;
    },
) {
    const games = createMemo(async () =>
        (await getMatchHistory({
            slug: props.slug,
            offset: props.index * PAGE_SIZE,
            count: PAGE_SIZE,
            teamModeFilter: props.teamModeFilter,
        })) ?? []
    );

    return (
        <>
            <Show
                when={games().length > 0 || props.index > 0}
                fallback={<Message>{t("stats-no-recent-games")}</Message>}
            >
                <div class="col-lg-12">
                    <For each={games()}>
                        {(game) => (
                            <MatchRow
                                game={game}
                                slug={props.slug}
                                expanded={game.guid === props.expandedId}
                                scrollIntoView={game.guid === props.scrollToId}
                                onToggle={() => props.onToggle(game.guid)}
                            />
                        )}
                    </For>
                </div>
            </Show>
            <Show when={props.last && games().length >= PAGE_SIZE}>
                <button type="button" class="col-12 match-load-more btn-darken" onClick={() => props.onMore()}>
                    {t("stats-more")}
                </button>
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

function MatchRow(props: {
    game: MatchHistory;
    slug: string;
    expanded: boolean;
    scrollIntoView: boolean;
    onToggle: () => void;
}) {
    const mode = () => teamModeNames[props.game.team_mode as TeamMode];
    const icon = () => gameModes.find((m) => m.mapId == props.game.map_id)?.desc.icon;

    let el!: HTMLDivElement;
    onSettled(() => {
        if (props.scrollIntoView) el.scrollIntoView();
    });

    return (
        <div
            ref={(e) => (el = e)}
            class={["row row-match match-link", { "match-link-expanded": props.expanded }]}
            data-game-id={props.game.guid}
            onClick={(e) => {
                // links to other players don't toggle the row
                if (!(e.target as Element).closest("a")) props.onToggle();
            }}
        >
            <div class={`match-link-mode-color match-link-mode-${mode()}`}></div>
            <div class="hide-xs col-2">
                <div class="match-link-player-icons">
                    {/* inline-block icons: the spaces between them are part of the layout */}
                    <Repeat count={props.game.team_count}>
                        {() => (
                            <>
                                <div class="match-link-player-icon"></div>
                                {" "}
                            </>
                        )}
                    </Repeat>
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
                <button
                    type="button"
                    class={["match-link-expand", props.expanded ? "match-link-expand-up" : "match-link-expand-down"]}
                    aria-expanded={props.expanded ? "true" : "false"}
                    aria-label={t("stats-match-details")}
                >
                </button>
            </div>

            <Show when={props.expanded}>
                <div class="match-data col-lg-12">
                    <MatchDetails gameId={props.game.guid} slug={props.slug} />
                </div>
            </Show>
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
        <Errored fallback={<Message>{t("stats-error-loading")}</Message>}>
            <Loading fallback={<Spinner kind="match-data" />}>
                <MatchTable players={players()} slug={props.slug} />
            </Loading>
        </Errored>
    );
}

const columns: { class: string; label?: StatsKey }[] = [
    { class: "match-header-rank", label: "stats-rank" },
    { class: "match-header-icon hide-xs" },
    { class: "match-header-player", label: "stats-player" },
    { class: "match-header-stat", label: "stats-kills" },
    { class: "match-header-stat hide-xs", label: "stats-damage" },
    { class: "match-header-stat", label: "stats-survived" },
];

/**
 * the header sits above the scrolling body in its own table; the body repeats it
 * without labels so both tables get the same column widths
 */
function MatchHeaders(props: { labels: boolean }) {
    return (
        <thead>
            <tr class="match-headers">
                <For each={columns}>
                    {(column) => (
                        <th class={column.class} scope="col">
                            {props.labels && column.label ? t(column.label) : ""}
                        </th>
                    )}
                </For>
            </tr>
        </thead>
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

    return (
        <>
            <div class="match-header-wrapper">
                <table class="match-table">
                    <MatchHeaders labels />
                </table>
            </div>
            <div class="match-table-wrapper">
                <table class="match-table">
                    <MatchHeaders labels={false} />
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
