import { useSearchParams } from "@solidjs/router";
import { createMemo, createStore, Errored, flush, Loading, Show, untrack } from "solid-js";
import { ALL_MAPS, ALL_TEAM_MODES } from "@survev/shared/types/stats.ts";
import { getMatchHistory, getUserStats } from "../api.ts";
import { Spinner } from "../components/Spinner.tsx";
import { getModeCards, getProfile } from "../format.ts";
import { ExtraStats, type HistoryState, type TeamModeFilter } from "./MatchHistory.tsx";
import { ModeCards, OverviewCard, type PlayerCardsFilters, PlayerFilters } from "./PlayerCards.tsx";

const PAGE_SIZE = 10;
const intervals = ["daily", "weekly", "alltime"] as const;

/** URL search params: ?slug=&time=&mapId=&gameId= */
type PlayerSearch = { slug: string; time: string; mapId: string; gameId: string };

/** error / not found: the message card, plus the empty mode card row that keeps the spacing */
function PlayerMessage(props: { message: string }) {
    return (
        <>
            <OverviewCard message={props.message} />
            <ModeCards cards={[]} />
        </>
    );
}

/** the profile page; remounted when the slug changes */
export function Player(props: { slug: string }) {
    const slug = untrack(() => props.slug);
    const [search, setSearch] = useSearchParams<PlayerSearch>();

    const filters = createMemo<PlayerCardsFilters>(() => ({
        interval: intervals.find((i) => i === search.time) ?? "alltime",
        mapIdFilter: search.mapId || ALL_MAPS,
    }));
    const stats = createMemo(() => getUserStats({ slug, ...filters() }));

    const [history, setHistory] = createStore<HistoryState>({
        games: [],
        loading: true,
        error: false,
        moreAvailable: true,
        teamModeFilter: ALL_TEAM_MODES,
    });

    // only the newest request may write, so a slow page can't land after a filter change
    let requestId = 0;
    /** writes to the store only after the fetch, so it can start during setup */
    async function fetchHistory(offset: number, teamModeFilter: TeamModeFilter) {
        const id = ++requestId;
        try {
            const games = (await getMatchHistory({ slug, offset, count: PAGE_SIZE, teamModeFilter })) ?? [];
            if (id !== requestId) return;
            setHistory((h) => {
                if (offset === 0) h.games = games;
                else h.games.push(...games);
                h.moreAvailable = games.length >= PAGE_SIZE;
                h.loading = false;
            });
        } catch (err) {
            if (id !== requestId) return;
            console.error(err);
            setHistory((h) => {
                h.error = true;
                h.moreAvailable = false;
                h.loading = false;
            });
        }
    }

    function loadHistory(offset: number, teamModeFilter: TeamModeFilter) {
        setHistory((h) => {
            if (offset === 0) h.games = [];
            h.teamModeFilter = teamModeFilter;
            h.loading = true;
            h.error = false;
        });
        void fetchHistory(offset, teamModeFilter);
    }

    void fetchHistory(0, ALL_TEAM_MODES).then(() => {
        // a match linked with ?gameId= opens expanded; bring it into view
        const gameId = untrack(() => search.gameId);
        if (!gameId) return;
        flush();
        document.querySelector(`[data-game-id="${CSS.escape(gameId)}"]`)?.scrollIntoView();
    });

    return (
        <div class="col-12 p-lg-3 p-0">
            <div class="content">
                <Errored fallback={<PlayerMessage message="Error loading content, please try again." />}>
                    <Loading fallback={<Spinner kind="player" />} on={filters()}>
                        <Show when={stats()} fallback={<PlayerMessage message="That player doesn't exist." />}>
                            {(stats) => (
                                <>
                                    <OverviewCard profile={getProfile(stats())} />
                                    <PlayerFilters
                                        filters={filters()}
                                        onChange={(f) => setSearch({ time: f.interval, mapId: f.mapIdFilter })}
                                    />
                                    <ModeCards cards={getModeCards(stats())} />
                                    <ExtraStats
                                        slug={slug}
                                        history={history}
                                        expandedId={search.gameId}
                                        onFilter={(filter) => {
                                            if (!history.loading) loadHistory(0, filter);
                                        }}
                                        onToggle={(gameId) =>
                                            setSearch({ gameId: search.gameId === gameId ? undefined : gameId })}
                                        onMore={() => {
                                            if (!history.loading) {
                                                loadHistory(history.games.length, history.teamModeFilter);
                                            }
                                        }}
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
