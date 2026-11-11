import { createStore } from "solid-js";
import { controller } from "./controller.ts";
import type { UiManager } from "./ui.ts";

/** the in-game menu's tabs: `#btn-game-<tab>` selects `#ui-game-tab-<tab>` */
export const gameTabs = ["settings", "keybinds"] as const;
export type GameTab = (typeof gameTabs)[number];

export type TeamMemberStatus = "" | "disconnected" | "dead" | "downed";

/** a teammate's row in #ui-team */
export interface TeamMemberView {
    displayed: boolean;
    name: string;
    /** off-screen marker at the screen edge (#ui-team-indicators); null: hidden */
    indicator: { left: number; top: number; transform: string } | null;
    /** health bar fill, 0..1 of the bar (at least a sliver while alive) */
    health: number;
    /** a dead teammate's bar is empty */
    healthEmpty: boolean;
    /** health bar color; "" for the stylesheet's */
    healthColor: string;
    healthDanger: boolean;
    status: TeamMemberStatus;
}

/** a column of the death / victory screen */
export interface StatsPlayerView {
    playerId: number;
    name: string;
    dead: boolean;
    kills: number;
    damageDealt: number;
    damageTaken: number;
    timeAlive: number;
    /** faction mode leader / ribbon badge class, "" for none */
    badge: string;
}

/** the death / victory screen's header line */
export type StatsOverview =
    | { kind: "faction"; red: number; blue: number }
    | { kind: "solo" | "team"; /** translation key of the rank label */ rankL10n: string; rank: number; kills: number }
    | { kind: "kills"; kills: number };

/**
 * The death / victory screen, a new object every time it opens (its fade-ins start over).
 * `teamAd`: the "you died" screen of a team game whose team is still alive (no player columns).
 */
export interface StatsScreen {
    teamAd: boolean;
    /** ms before the screen fades in */
    delay: number;
    title: string;
    overview: StatsOverview;
    players: StatsPlayerView[];
    spectateButton: boolean;
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
    indicator: null,
    health: 1,
    healthEmpty: false,
    healthColor: "",
    healthDanger: false,
    status: "",
});

/** the in-game UI that UiManager owns (components/GameHud.tsx, GameMenu.tsx, DeathScreen.tsx); UiManager writes it */
export const [gameView, setGameView] = createStore({
    /** a game's UiManager exists: the minimap and team panels show */
    active: false,
    /** the whole in-game UI is hidden (the HUD visibility toggle) */
    hidden: false,
    /** the faction patch on the health bar */
    flair: "" as "" | "red" | "blue",
    /** #ui-killfeed-wrapper top; "" for the stylesheet's */
    killfeedTop: "",
    /** scopes highlight on hover; set once spectating ends */
    zoomHover: false,
    /** a weapon slot (1 or 2, 0 for none) being dragged onto the other one */
    weaponDrag: { slot: 0, dragging: false, moved: false, left: 0, top: 0 },

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
    },

    map: {
        /** the big map is open: `.js-ui-map-hidden` elements hide, `.js-ui-map-show` ones show */
        bigmap: false,
        /** the minimap shows (it hides with the HUD and the visibility toggle) */
        minimap: true,
        /** the minimap's scale with the screen */
        scale: 1,
        gasMoving: false,
        gasTime: "",
        spectators: 0,
    },

    alive: {
        /** which counters show: players, or red / blue teams; null until the first count arrives */
        kind: null as "players" | "faction" | null,
        count: 0,
        red: 0,
        blue: 0,
    },
    kills: 0,

    /** null while there is no leader */
    killLeader: null as null | { name: string; kills: number },
    /** sniper (hunted) mode's waiting text */
    killLeaderHunted: false,
    /** the map has a kill leader */
    killLeaderEnabled: true,
    /** the debug editor hides the kill leader */
    editor: false,

    /** waiting for players before the game starts */
    waiting: false,

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

    /** the latest announcement, a new object each time (the view fades it in, then out) */
    announcement: null as { text: string } | null,

    team: [teamMember(), teamMember(), teamMember(), teamMember()],

    /** the death / victory screen; null while closed */
    stats: null as StatsScreen | null,
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
