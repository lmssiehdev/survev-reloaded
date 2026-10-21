import { Collapsible } from "@kobalte/core/collapsible";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { useNavigate, useSearchParams } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import slugify from "slugify";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import { device } from "../../device.ts";
import { SDK } from "../../sdk/sdk.ts";
import { config } from "../config.ts";
import { locale, setLocale, type StatsLocale, statsLocales, t } from "../i18n.ts";

const phone = device.mobile && !device.tablet;

/** ad slots per page: phones get one box under the content, desktops a top banner */
const adSlots = {
    leaderboard: phone
        ? { top: [], bottom: ["survevio_300x250_leaderboard_bottom"] }
        : { top: ["survevio_728x90_leaderboard_top", "survevio_300x250_leaderboard_top"], bottom: [] },
    player: phone
        ? { top: [], bottom: ["survevio_300x250_playerprofile_bottom"] }
        : { top: ["survevio_728x90_playerprofile_top", "survevio_300x250_playerprofile_top"], bottom: [] },
};
type Page = keyof typeof adSlots;

function LanguageSelect() {
    return (
        <li id="language-select" class="nav-item dropdown">
            <DropdownMenu modal={false}>
                <DropdownMenu.Trigger id="selected-language" class="nav-link dropdown-toggle">
                    {locale().toUpperCase()}
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content class="dropdown-menu">
                        <For each={Object.keys(statsLocales) as StatsLocale[]}>
                            {(code) => (
                                <DropdownMenu.Item
                                    class="dropdown-item dropdown-language"
                                    onSelect={() => void setLocale(code)}
                                >
                                    {statsLocales[code]}
                                </DropdownMenu.Item>
                            )}
                        </For>
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu>
        </li>
    );
}

function Navbar() {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = createSignal(false);
    const mySlug = config.get("profile")?.slug;

    return (
        <nav class="navbar navbar-expand-md navbar-dark bg-dark">
            <Collapsible class="container" open={menuOpen()} onOpenChange={setMenuOpen} forceMount>
                <a class="btn btn-outline-success btn-play my-2 my-sm-0" href="/">{t("index-play-survevio")}</a>
                <Collapsible.Trigger class="navbar-toggler" aria-label="Toggle navigation">
                    <span class="navbar-toggler-icon"></span>
                </Collapsible.Trigger>

                <Collapsible.Content
                    id="navbarSupportedContent"
                    class={["collapse", "navbar-collapse", "ml-lg-2", { show: menuOpen() }]}
                >
                    <ul class="navbar-nav mr-auto">
                        <li class="nav-item m-lg-auto m-1">
                            <a class="nav-link-bright" href="/stats/" link>{t("index-leaderboards")}</a>
                        </li>
                        <li class="nav-item my-profile m-lg-auto m-1">
                            <a
                                id="my-profile"
                                class={["nav-link-bright", { "d-block": !!mySlug }]}
                                href={mySlug ? `/stats/?slug=${mySlug}` : "/stats/"}
                                link
                            >
                                {t("index-my-stats")}
                            </a>
                        </li>
                    </ul>
                    <ul class="navbar-nav ml-auto mr-1">
                        <LanguageSelect />
                    </ul>
                    <form
                        id="search-players"
                        class="form-inline my-2 my-lg-0"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const name = new FormData(e.currentTarget).get("name") as string;
                            navigate(`/stats/?slug=${slugify(name)}`);
                        }}
                    >
                        <input
                            class="form-control mr-sm-2"
                            type="search"
                            name="name"
                            placeholder={t("index-search-players")}
                            aria-label={t("index-search-players")}
                        />
                        <button class="btn btn-outline-success my-2 my-sm-0" type="submit">
                            {t("index-go")}
                        </button>
                    </form>
                </Collapsible.Content>
            </Collapsible>
        </nav>
    );
}

function AdSlot(props: { id: string }) {
    return <div id={props.id} style={{ "text-align": "center" }}></div>;
}

function Footer() {
    return (
        <div id="footer" class="footer">
            <div class="container">
                <div class="row">
                    <div id="footer-copyright" class="col-lg-8 col-12">© 2025 survev.io.</div>
                    <div class="col-lg-4 col-12">
                        <div id="footer-social-links">
                            {/* inline-block icons: the spaces between them are part of the layout */}
                            <a
                                href="https://discord.gg/75RAK3p3K2"
                                target="_blank"
                                class="btn-social btn-darken btn-discord"
                            >
                            </a>{" "}
                            <a href="https://ko-fi.com/survev" target="_blank" class="btn-social btn-darken btn-kofi">
                            </a>{" "}
                            <a href="https://survev.wiki.gg/" target="_blank" class="btn-social btn-darken btn-wiki">
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Layout(props: { children?: JSX.Element }) {
    const [search] = useSearchParams();
    const page = createMemo<Page>(() => (search.slug ? "player" : "leaderboard"));
    const shown = (p: Page, where: "top" | "bottom") => page() === p && adSlots[p][where].length > 0;

    let activeSlots: string[] = [];
    createEffect(page, (p) => {
        const next = [...adSlots[p].top, ...adSlots[p].bottom];
        void SDK.ensureNitroReady()
            .catch(() => {})
            .finally(() => {
                SDK.hideNitroPlacementsById(activeSlots);
                SDK.showNitroPlacements(next);
                activeSlots = next;
            });
    });

    return (
        <>
            <Navbar />
            <div id="contentMain">
                <div id="leaderboard-bg" class="stats-bg"></div>

                <div id="adsLeaderBoardTop" style={{ display: shown("leaderboard", "top") ? "block" : "none" }}>
                    <div class="ad-block-top container mt-3">
                        <div class="ad-block-top-leaderboard">
                            <AdSlot id="survevio_728x90_leaderboard_top" />
                        </div>
                        <div class="ad-block-top-med-rect">
                            <AdSlot id="survevio_300x250_leaderboard_top" />
                        </div>
                    </div>
                </div>

                <div id="adsPlayerTop" style={{ display: shown("player", "top") ? "block" : "none" }}>
                    <div class="ad-block-top container mt-3">
                        <div class="ad-block-top-leaderboard">
                            <AdSlot id="survevio_728x90_playerprofile_top" />
                        </div>
                        <div class="ad-block-top-med-rect">
                            <AdSlot id="survevio_300x250_playerprofile_top" />
                        </div>
                    </div>
                </div>

                <div id="content">{props.children}</div>

                <div
                    id="adsLeaderBoardBottom"
                    class="col-12"
                    style={{ display: shown("leaderboard", "bottom") ? "block" : "none" }}
                >
                    <div class="ad-block-bot-med-rect">
                        <AdSlot id="survevio_300x250_leaderboard_bottom" />
                    </div>
                </div>

                <div
                    id="adsPlayerBottom"
                    class="col-12"
                    style={{ display: shown("player", "bottom") ? "block" : "none" }}
                >
                    <div class="ad-block-bot-med-rect">
                        <AdSlot id="survevio_300x250_playerprofile_bottom" />
                    </div>
                </div>
            </div>
            <Footer />
        </>
    );
}
