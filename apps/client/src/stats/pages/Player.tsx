import { useSearchParams } from "@solidjs/router";
import { createMemo, Errored, Loading, Show, untrack } from "solid-js";
import { ALL_MAPS, ALL_TEAM_MODES } from "@survev/shared/types/statsFilters.ts";
import { getMatchHistory, getUserStats } from "../api.ts";
import { Spinner } from "../components/Spinner.tsx";
import { getModeCards, getProfile } from "../format.ts";
import { t } from "../i18n.ts";
import { MatchHistorySection, PAGE_SIZE } from "./MatchHistory.tsx";
import { ModeCards, OverviewCard, type PlayerCardsFilters, PlayerFilters } from "./PlayerCards.tsx";

const intervals = ["daily", "weekly", "alltime"] as const;

/** URL search params: ?slug=&time=&mapId=&gameId= */
type PlayerSearch = { slug: string; time: string; mapId: string; gameId: string };

/** the profile page; remounted when the slug changes */
export function Player(props: { slug: string }) {
    const [search, setSearch] = useSearchParams<PlayerSearch>();

    const filters = createMemo<PlayerCardsFilters>(() => ({
        interval: intervals.find((i) => i === search.time) ?? "alltime",
        mapIdFilter: search.mapId || ALL_MAPS,
    }));
    const stats = createMemo(() => getUserStats({ slug: props.slug, ...filters() }));

    // start the first page of matches alongside the stats; the list picks it up from the query cache
    void getMatchHistory({ slug: props.slug, offset: 0, count: PAGE_SIZE, teamModeFilter: ALL_TEAM_MODES })
        .catch(() => {});
    // only the match linked in the opening URL is scrolled to, not ones opened later
    const scrollToId = untrack(() => search.gameId);

    return (
        <div class="col-12 p-lg-3 p-0">
            <div class="content">
                <Errored fallback={<OverviewCard message={t("stats-error-loading")} />}>
                    <Loading fallback={<Spinner kind="player" />} on={filters()}>
                        <Show when={stats()} fallback={<OverviewCard message={t("stats-player-not-found")} />}>
                            {(stats) => (
                                <>
                                    <OverviewCard profile={getProfile(stats())} />
                                    <PlayerFilters
                                        filters={filters()}
                                        onChange={(f) => setSearch({ time: f.interval, mapId: f.mapIdFilter })}
                                    />
                                    <ModeCards cards={getModeCards(stats())} />
                                    <MatchHistorySection
                                        slug={props.slug}
                                        expandedId={search.gameId}
                                        scrollToId={scrollToId}
                                        onToggle={(gameId) =>
                                            setSearch({ gameId: search.gameId === gameId ? undefined : gameId })}
                                    />
                                </>
                            )}
                        </Show>
                    </Loading>
                </Errored>
            </div>
        </div>
    );
}
