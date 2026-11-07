import { activePassType } from "@survev/shared/defs/gameObjects/passDefs.ts";
import { createStore } from "solid-js";

/** an opacity the view transitions to over `ms` (jQuery .animate replacement) */
export interface Fade {
    opacity: number;
    ms: number;
}

/** a fresh fully opaque Fade (store objects must not be shared) */
export const opaque = (): Fade => ({ opacity: 1, ms: 0 });

/**
 * Writes `patch` into a store draft leaf by leaf: nested objects (the Fades) are merged rather
 * than replaced, so only the views reading a changed leaf update.
 */
export function assignLeaves<T extends object>(target: T, patch: Partial<T>) {
    for (const key in patch) {
        const value = patch[key];
        const current = target[key];
        if (value && typeof value === "object" && current && typeof current === "object") {
            Object.assign(current, value);
        } else {
            target[key] = value as T[typeof key];
        }
    }
}

export interface QuestView {
    type: string;
    xp: number;
    /** formatted progress, e.g. "3" or "1h 5m" */
    current: string;
    target: string;
    barPct: number;
    hasIcon: boolean;
    iconRot: number;
    iconScale: number;
    /** the two icon layers cross-fade (see .pass-quest-icon::before/::after) */
    iconUrl1: string;
    iconUrl2: string;
    iconAlpha1: number;
    iconAlpha2: number;
    refreshEnabled: boolean;
    promptOpen: boolean;
    loading: boolean;
    showTimer: boolean;
    timerText: string;
    /** desc shows "QUEST COMPLETE!" */
    completeText: boolean;
    pulse: boolean;
    main: Fade;
    refresh: Fade;
    counter: Fade;
}

export interface PassView {
    type: string;
    level: number;
    xpCurrent: number;
    xpTarget: number;
    barPct: number;
    /** game type of the next unlock; "" for none */
    unlockItem: string;
    unlockPulse: boolean;
    unlockImages: Fade;
    loadingVisible: boolean;
    lockedVisible: boolean;
    /** raises #pass-block above the loading spinner */
    blockRaised: boolean;
    /** keyed by quest slot (data.idx) */
    quests: Record<number, QuestView>;
}

/** written by the Pass class (ui/pass.ts), read by components/PassPanel.tsx */
export const [passView, setPassView] = createStore<PassView>({
    type: activePassType,
    level: 1,
    xpCurrent: 0,
    xpTarget: 0,
    barPct: 0,
    unlockItem: "",
    unlockPulse: false,
    unlockImages: opaque(),
    loadingVisible: true,
    lockedVisible: false,
    blockRaised: false,
    quests: {},
});
