import { createStore } from "solid-js";
import type { EmoteBarn } from "../emote.ts";
import { controller } from "./controller.ts";

/** wedges of the emote wheel (`#ui-emotes`), in DOM order */
export const EMOTE_WEDGES = ["middle", "top", "right", "bottom", "left"] as const;
export type EmoteWedge = (typeof EMOTE_WEDGES)[number];

/** wedges of the team ping wheel (`#ui-team-pings`), in DOM order */
export const PING_WEDGES = ["middle", "top", "right", "bottom", "bottom-left", "top-left"] as const;
export type PingWedge = (typeof PING_WEDGES)[number];

export type WheelName = "emotes" | "pings";

/** what EmoteBarn has set on a wedge; undefined until it first sets it (stylesheet value) */
export interface WedgeView {
    opacity: number | undefined;
    highlight: boolean | undefined;
    /** the `.ui-emote-image` svg */
    image: string | undefined;
}

export interface WheelView<K extends string> {
    /** undefined until first opened or closed (the stylesheet hides it) */
    open: boolean | undefined;
    left: number | undefined;
    top: number | undefined;
    wedges: Record<K, WedgeView>;
}

const wedge = (): WedgeView => ({ opacity: undefined, highlight: undefined, image: undefined });

const wheel = <K extends string>(wedges: Record<K, WedgeView>): WheelView<K> => ({
    open: undefined,
    left: undefined,
    top: undefined,
    wedges,
});

/**
 * The emote and team ping wheels and the touch emote button. EmoteBarn (emote.ts) writes it,
 * components/EmoteWheel.tsx reads it.
 */
export const [emoteWheel, setEmoteWheel] = createStore({
    /** touch devices: the wheels and the emote button take touches (`pointer-events: auto`) */
    touch: false,
    /** both wheels grey out while emotes are on cooldown; undefined until first set */
    opacity: undefined as number | undefined,
    emotes: wheel<EmoteWedge>({
        middle: wedge(),
        top: wedge(),
        right: wedge(),
        bottom: wedge(),
        left: wedge(),
    }),
    pings: wheel<PingWedge>({
        middle: wedge(),
        top: wedge(),
        right: wedge(),
        bottom: wedge(),
        "bottom-left": wedge(),
        "top-left": wedge(),
    }),
});

/** a wedge of either wheel */
export type WedgeRef = { wheel: "emotes"; key: EmoteWedge } | { wheel: "pings"; key: PingWedge };

const wedgeOf = (s: typeof emoteWheel, ref: WedgeRef): WedgeView =>
    ref.wheel === "emotes" ? s.emotes.wedges[ref.key] : s.pings.wedges[ref.key];

export function setWedge(ref: WedgeRef, patch: Partial<WedgeView>) {
    setEmoteWheel((s) => {
        const w = wedgeOf(s, ref);
        if (patch.opacity !== undefined) w.opacity = patch.opacity;
        if (patch.highlight !== undefined) w.highlight = patch.highlight;
        if (patch.image !== undefined) w.image = patch.image;
    });
}

export function setWheelOpen(wheel: WheelName, open: boolean, pos?: { x: number; y: number }) {
    setEmoteWheel((s) => {
        s[wheel].open = open;
        if (pos) {
            s[wheel].left = pos.x;
            s[wheel].top = pos.y;
        }
    });
}

export function setWheelsOpacity(opacity: number) {
    setEmoteWheel((s) => {
        s.opacity = opacity;
    });
}

export function setEmoteTouch(touch: boolean) {
    setEmoteWheel((s) => {
        s.touch = touch;
    });
}

/** the running game's EmoteBarn, for the wheels' touch handlers; null between games */
export const [emoteBarnRef, setEmoteBarnRef] = controller<EmoteBarn | null>();
