import { createStore } from "solid-js";
import type { AimStyle } from "../config.ts";
import { controller } from "./controller.ts";
import type { Touch } from "./touch.ts";

/**
 * The in-game menu's touch toggles (move style, aim style, aim line) and the touch emote button.
 * Touch (ui/touch.ts) writes it, components/TouchControls.tsx and components/EmoteWheel.tsx
 * read it. Every field is undefined until the first game sets it.
 */
export const [touchControls, setTouchControls] = createStore({
    /** a game started on a touch device: the toggles and the emote button are shown */
    touch: false,
    moveStyle: undefined as AimStyle | undefined,
    aimStyle: undefined as AimStyle | undefined,
    aimLine: undefined as boolean | undefined,
});

/** the current game's Touch, for the toggles' handlers (they only show in the in-game menu) */
export const [touchRef, setTouchRef] = controller<Touch>();
