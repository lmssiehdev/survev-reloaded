import { createStore } from "solid-js";
import { controller } from "./controller.ts";
import type { UiManager } from "./ui.ts";

/** the in-game menu's tabs: `#btn-game-<tab>` selects `#ui-game-tab-<tab>` */
export const gameTabs = ["settings", "keybinds"] as const;
export type GameTab = (typeof gameTabs)[number];

/** an inline `display` written by UiManager; "" until it writes one (the stylesheet decides) */
export type Display = "" | "block" | "none";

export type TeamMemberStatus = "" | "disconnected" | "dead" | "downed";

/** a teammate's row in #ui-team */
export interface TeamMemberView {
    displayed: boolean;
    name: string;
    /** health bar width in px; null: the stylesheet's */
    healthWidth: number | null;
    /** health bar color; "" for the stylesheet's */
    healthColor: string;
    healthDanger: boolean;
    status: TeamMemberStatus;
    /** name opacity after a status change; null: the stylesheet's */
    nameOpacity: number | null;
}

/** a column of the death / victory screen */
export interface StatsPlayerView {
    playerId: number;
    name: string;
    dead: boolean;
    left: number;
    kills: number;
    damageDealt: number;
    damageTaken: number;
    timeAlive: number;
    /** faction mode leader / ribbon badge class, "" for none */
    badge: string;
}

export interface LocalStatsView {
    kills: number;
    damageDealt: number;
    damageTaken: number;
    timeAlive: number;
}

export interface RolePerkView {
    /** translation key, `game-<perk>` */
    l10n: string;
    img: string;
}

const teamMember = (): TeamMemberView => ({
    displayed: false,
    name: "",
    healthWidth: null,
    healthColor: "",
    healthDanger: false,
    status: "",
    nameOpacity: null,
});

/** the in-game UI that UiManager owns (components/GameHud.tsx, GameMenu.tsx, DeathScreen.tsx); UiManager writes it */
export const [gameView, setGameView] = createStore({
    /** a game's UiManager exists: the minimap and team panels show */
    active: false,

    menu: {
        open: false,
        tab: "settings" as GameTab,
    },

    role: {
        open: false,
        roles: [] as { type: string; img: string }[],
        /** the role whose details the menu shows */
        selected: "",
        /** perks of the selected role */
        perks: [] as RolePerkView[],
        guiImg: "",
        borderColor: "",
        /** "ENTER GAME (n)" countdown; null before the first tick */
        seconds: null as number | null,
        /** set by UiManager.resize; null before */
        scale: null as number | null,
    },

    map: {
        bigmap: false,
        /** inline display of my `.js-ui-map-hidden` elements */
        hidden: "" as Display,
        /** inline display of my `.js-ui-map-show` elements */
        show: "" as Display,
        /** inline display of my `.js-ui-mobile-map-hidden` elements (small layout only) */
        mobileHidden: "" as Display,
        /** #ui-map-container scale and bottom; null until the first redraw */
        scale: null as number | null,
        bottom: null as number | null,
        /** #ui-map-info bottom, "auto" when the minimap is hidden */
        infoBottom: "",
        gasMoving: false,
        gasTime: "",
        spectators: {
            /** null until UiManager decides */
            displayed: null as boolean | null,
            text: "",
            bottom: null as number | null,
            left: null as number | null,
        },
        /** #big-map-collision size on touch devices; null until the big map opens there */
        collisionWidth: null as number | null,
        collisionHeight: null as number | null,
    },

    alive: {
        count: 0,
        red: 0,
        blue: 0,
        /** the leaderboard shows the red / blue counters; null until a count arrives */
        leaderboardFaction: null as boolean | null,
        /** the mobile map counter shows red / blue */
        mapFaction: null as boolean | null,
    },
    kills: 0,

    killLeader: {
        /** null before the first update: the markup's untranslated placeholder */
        playerId: null as number | null,
        name: "",
        kills: 0,
        /** waiting text for sniper (hunted) mode */
        hunted: false,
    },
    /** the map has a kill leader; null until a map loads */
    killLeaderEnabled: null as boolean | null,
    /** the debug editor hides the kill leader */
    editor: false,

    /** null until UiManager decides */
    waiting: null as boolean | null,

    spectate: {
        active: false,
        /** next / previous teammate buttons (not in solo) */
        teamButtons: false,
        name: "",
        optionsTop: null as number | null,
        statsShown: false,
        /** the "your results" table fills once the stats arrive */
        hasStats: false,
        stats: { kills: 0, damageDealt: 0, damageTaken: 0, timeAlive: 0 } as LocalStatsView,
    },

    announcement: {
        text: "",
        /** bumps on every announcement: the view fades it in, then out */
        seq: 0,
    },

    team: [teamMember(), teamMember(), teamMember(), teamMember()],

    stats: {
        /** #ui-stats shows */
        open: false,
        /** the background and contents show (fading in) */
        contents: false,
        /** bumps every time the screen (re)opens: the view restarts its fade-ins */
        seq: 0,
        /** ms before the screen fades in */
        delay: 0,
        /** the "you died" screen of a team game whose team is still alive */
        teamAd: false,
        title: "",
        overview: {
            kind: "solo" as "solo" | "team" | "faction" | "kills",
            /** translation key of the rank label */
            rankL10n: "",
            rank: 0,
            kills: 0,
            red: 0,
            blue: 0,
        },
        /** header and buttons exist (emptied when the screen is cleared) */
        filled: false,
        players: [] as StatsPlayerView[],
        /** restart button width / left offset in px */
        restartWidth: null as number | null,
        restartLeft: null as number | null,
        spectateButton: false,
    },
});

/** the current game's UiManager, for event handlers */
export const [gameUi, setGameUi] = controller<UiManager>();

/** a px style value; null / undefined leaves the property unset */
export const px = (n: number | null | undefined) => (n == null ? undefined : `${n}px`);

/** "1h 2m 3s" */
export function humanizeTime(time: number) {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor(time / 60) % 60;
    const seconds = Math.floor(time) % 60;
    let timeText = "";
    if (hours > 0) {
        timeText += `${hours}h `;
    }
    if (hours > 0 || minutes > 0) {
        timeText += `${minutes}m `;
    }
    return (timeText += `${seconds}s`);
}
