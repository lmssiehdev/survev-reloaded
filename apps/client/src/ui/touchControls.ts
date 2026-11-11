import { controller } from "./controller.ts";
import type { Touch } from "./touch.ts";

/** the current game's Touch, for the in-game menu's touch toggles (they only show in a game) */
export const [touchRef, setTouchRef] = controller<Touch>();
