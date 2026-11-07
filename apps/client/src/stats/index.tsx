import "bootstrap/dist/css/bootstrap.css";
import "../../css/stats/app.css";
import { createRouter, useSearchParams } from "@solidjs/router";
import { render } from "@solidjs/web";
import { Show } from "solid-js";
import { Layout } from "./components/Layout.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { Player } from "./pages/Player.tsx";

/** /stats/ is the leaderboard, /stats/?slug=name a player's profile */
function StatsPage() {
    const [search] = useSearchParams<{ slug: string }>();
    return (
        <Show when={search.slug} keyed fallback={<Leaderboard />}>
            {(slug) => <Player slug={slug} />}
        </Show>
    );
}

const Router = createRouter({
    routes: [{ path: "/stats", component: StatsPage }],
    // only anchors marked `link` are routed; "/" and external links load normally
    explicitLinks: true,
});

render(
    () => <Router>{(props) => <Layout>{props.children}</Layout>}</Router>,
    document.getElementById("wrapper")!,
);
