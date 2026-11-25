import { useNavigate } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/solid/collapsible";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/solid/menu";
import slugify from "slugify";
import { createSignal, For, onCleanup } from "solid-js";
import { config } from "../config.ts";
import { locale, setLocale, type StatsLocale, statsLocales, t } from "../i18n.ts";

function LanguageSelect() {
    return (
        <li id="language-select" class="nav-item dropdown">
            <Menu modal={false}>
                <MenuTrigger id="selected-language" class="nav-link dropdown-toggle">
                    {locale().toUpperCase()}
                </MenuTrigger>
                <MenuContent class="dropdown-menu" align="start">
                    <For each={Object.keys(statsLocales) as StatsLocale[]}>
                        {(code) => (
                            <MenuItem
                                class="dropdown-item dropdown-language"
                                onSelect={() => void setLocale(code)}
                            >
                                {statsLocales[code]}
                            </MenuItem>
                        )}
                    </For>
                </MenuContent>
            </Menu>
        </li>
    );
}

/** Bootstrap's `navbar-expand-md`: from this width up, the menu is always shown and the toggler hidden */
function createWideScreen() {
    const query = window.matchMedia("(min-width: 768px)");
    const [wide, setWide] = createSignal(query.matches);
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    onCleanup(() => query.removeEventListener("change", onChange));
    return wide;
}

function Navbar() {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = createSignal(false);
    const wide = createWideScreen();
    const mySlug = config.get("profile")?.slug;

    return (
        <nav class="navbar navbar-expand-md navbar-dark bg-dark">
            <Collapsible class="container" open={wide() || menuOpen()} onOpenChange={setMenuOpen}>
                <a class="btn btn-outline-success btn-play my-2 my-sm-0" href="/">{t("index-play-survevio")}</a>
                <CollapsibleTrigger class="navbar-toggler" aria-label="Toggle navigation">
                    <span class="navbar-toggler-icon"></span>
                </CollapsibleTrigger>

                <CollapsiblePanel id="navbarSupportedContent" class="collapse show navbar-collapse ml-lg-2">
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
                </CollapsiblePanel>
            </Collapsible>
        </nav>
    );
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
    return (
        <>
            <Navbar />
            <div id="contentMain">
                <div id="leaderboard-bg" class="stats-bg"></div>
                <div id="content">{props.children}</div>
            </div>
            <Footer />
        </>
    );
}
