import { onCleanup } from "solid-js";
import { controller } from "./controller.ts";
import type { UiManager2 } from "./ui2.ts";

/** something a HUD slot does to its item: "use" on a left click, "drop" on a right click */
export interface ItemAction {
    action: "use" | "drop";
    type: string;
    data: string | number;
}

/** a pressed slot's action, done when the press ends (or, for a touch drop, after a long hold) */
export interface ItemPress extends ItemAction {
    queued: boolean;
    time: number;
}

/** a touch shorter than this uses the item; holding it this long drops it */
export const TOUCH_HOLD_MS = 750;

/** every mounted slot's presses; UiManager2 drops held ones and clears them all on a release elsewhere */
export const itemPresses = new Set<ItemPress>();

/** the game's HUD manager, which turns the actions into input */
export const [hudUi, setHudUi] = controller<UiManager2>();

/** left click uses, right click drops */
const BUTTON_ACTIONS: Partial<Record<number, "use" | "drop">> = { 0: "use", 2: "drop" };
const buttonAction = (e: MouseEvent) => BUTTON_ACTIONS[e.button];

/**
 * Event handlers for a HUD slot (`<div {...itemActions(...)}>`), called in the slot's component.
 * A click on the slot itself doesn't reach the game's own mouse and touch input.
 */
export function itemActions(...actions: ItemAction[]) {
    const presses: ItemPress[] = actions.map((action) => ({ ...action, queued: false, time: 0 }));
    for (const press of presses) itemPresses.add(press);
    onCleanup(() => {
        for (const press of presses) itemPresses.delete(press);
    });
    return {
        onMouseDown(e: MouseEvent) {
            for (const press of presses) {
                if (press.action == buttonAction(e)) {
                    e.stopPropagation();
                    press.queued = true;
                }
            }
        },
        onMouseUp(e: MouseEvent) {
            for (const press of presses) {
                if (press.queued && press.action == buttonAction(e)) {
                    e.stopPropagation();
                    hudUi()?.pushAction(press);
                    press.queued = false;
                }
            }
        },
        onTouchStart(e: TouchEvent) {
            if (presses.length == 0 || e.changedTouches.length == 0) return;
            e.stopPropagation();
            for (const press of presses) {
                press.queued = true;
                press.time = Date.now();
            }
        },
        onTouchEnd() {
            for (const press of presses) {
                if (press.queued && press.action == "use" && Date.now() - press.time < TOUCH_HOLD_MS) {
                    hudUi()?.pushAction(press);
                }
                press.queued = false;
            }
        },
        onTouchCancel() {
            for (const press of presses) press.queued = false;
        },
    };
}
