import { activePassType } from "@survev/shared/defs/gameObjects/passDefs.ts";
import { createSignal, createStore } from "solid-js";

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
    /** just completed: shows "QUEST COMPLETE!", then fades out (.pass-quest-completing) */
    completing: boolean;
    pulse: boolean;
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
    /** the unlock images fade out while the next unlock swaps in */
    unlockHidden: boolean;
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
    unlockHidden: false,
    loadingVisible: true,
    lockedVisible: false,
    blockRaised: false,
    quests: {},
});

/** what the pass panel calls back into; the Pass class sets it once it exists */
export interface PassPanelProps {
    getCategory(gameType: string): { loadoutType: string; categoryImage: string } | null;
    onRefresh(idx: number): void;
    onRefreshConfirm(idx: number): void;
    onRefreshCancel(idx: number): void;
}

export const [passPanel, setPassPanel] = createSignal<PassPanelProps>();
