import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import type { RoomData } from "@survev/shared/types/team.ts";
import { createStore } from "solid-js";
import type { Application } from "../main.ts";
import { controller } from "./controller.ts";
import type { TeamMenu } from "./teamMenu.ts";

/** a play button's look, from site_info's modes */
export interface ModeView {
    /** "solo", "duo", "squad" or a map's own label; `index-play-${buttonText}` is the button text */
    buttonText: string;
    icon: string;
    buttonCss: string;
    enabled: boolean;
}

export interface RegionView {
    id: string;
    /** translation key of the region's name */
    l10n: string;
    playerCount: number;
}

const defaultModes = (): ModeView[] =>
    ["solo", "duo", "squad"].map((buttonText) => ({ buttonText, icon: "", buttonCss: "", enabled: true }));

/** what the start menu (components/StartMenu.tsx) shows; Application, SiteInfo and TeamMenu write it */
export const [startMenu, setStartMenu] = createStore({
    // from site_info
    regions: [] as RegionView[],
    modes: defaultModes(),
    supportsTeam: true,
    streamers: [] as SiteInfoRes["twitch"],
    youtube: null as SiteInfoRes["youtube"] | null,

    /** the start menu is showing (not in a game) */
    active: true,
    errorMessage: "",
    /** the quick play button showing a spinner, -1 for none */
    pendingModeIdx: -1,
    /** a game is being joined: play buttons dim, the spinner shows */
    playLocked: false,
    playerName: "",
    region: "",
    helpOpen: false,
    /** the "paste a team link" panel */
    teamLinkOpen: false,
    teamLink: "",
    teamLinkWarning: false,
    landscape: true,
    /** the right column shows news instead of the pass */
    newsDisplayed: false,
    newsUnread: false,
});

/** the team room as the team menu shows it; TeamMenu writes it */
export const [team, setTeam] = createStore({
    active: false,
    joined: false,
    /** creating a room rather than joining one */
    create: false,
    joiningGame: false,
    isLeader: true,
    localPlayerId: 0,
    editingName: false,
    error: "",
    room: {
        roomUrl: "",
        region: "",
        gameModeIdx: 0,
        enabledGameModeIdxs: [] as number[],
        autoFill: true,
        findingGame: false,
        maxPlayers: 0,
    } satisfies Partial<RoomData>,
    players: [] as { playerId: number; name: string; isLeader: boolean; inGame: boolean }[],
    /** the invite link's text is hidden (desktop "eye" button) */
    hideUrl: false,
});

/** set once Application has created them */
export const [app, setApp] = controller<Application>();
export const [teamMenu, setTeamMenu] = controller<TeamMenu>();
