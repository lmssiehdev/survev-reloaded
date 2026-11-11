import { activePassType, PassDefs } from "@survev/shared/defs/gameObjects/passDefs.ts";
import { QuestDefs } from "@survev/shared/defs/gameObjects/questDefs.ts";
import type { PassState, QuestState } from "@survev/shared/types/user.ts";
import { math } from "@survev/shared/utils/math.ts";
import { passUtil } from "@survev/shared/utils/passUtil.ts";
import { util } from "@survev/shared/utils/util.ts";
import { type Account, accountPass } from "../account.ts";
import { follow } from "./controller.ts";
import type { LoadoutMenu } from "./loadoutMenu.ts";
import { type PassPhase, type QuestView, setPassPanel, setPassView } from "./passView.ts";

function getNextPassUnlockItemId(passType: string, currentLevel: number) {
    const passDef = PassDefs[passType];
    for (let itemIndex = 0; itemIndex < passDef.items.length; itemIndex++) {
        if (passDef.items[itemIndex].level == currentLevel + 1) {
            return passDef.items[itemIndex].item;
        }
    }
    return "";
}
function humanizeTime(time: number, minutesFloor = false) {
    // const minutesFloor =
    //     arguments.length > 1 &&
    //     arguments[1] !== undefined &&
    //     arguments[1];
    const hours = Math.floor(Math.ceil(time / 60) / 60);
    const minutes = minutesFloor ? Math.floor(time / 60) % 60 : Math.ceil(time / 60) % 60;
    Math.floor(time);
    let timeText = "";
    if (hours > 0) {
        timeText += `${hours}h `;
    }
    return (timeText += `${minutes}m`);
}

export class Pass {
    pass = {
        data: {
            type: activePassType,
        },
        currentXp: 0,
        currentLevel: 1,
        levelXp: 0,
        ticker: 0,
        animSteps: [] as Array<{
            startXp: number;
            targetXp: number;
            levelXp: number;
            targetLevel: number;
        }>,
    };

    quests: Array<{
        data: {
            idx: number;
            type: string;
            complete: boolean;
            progress: number;
            target: number;
            rerolled: boolean;
        };
        start: number;
        current: number;
        ticker: number;
        delay: number;
        playCompleteAnim: boolean;
        progressAnimFinished: boolean;
        completeAnimFinished: boolean;
        shouldRequestRefresh: boolean;
        refreshTime: number;
        refreshSet: boolean;
        refreshEnabled: boolean;
        timer: {
            enabled: boolean;
            str: string;
            displayed?: boolean;
        };
        iconTicker: number;
        /** pending animation steps, cancelled when new quest data arrives */
        timers: number[];
    }> = [];

    /** loading until the pass arrives, or locked for a logged out player */
    phase: PassPhase = "loading";
    updatePass = false;
    updatePassTicker = 0;

    constructor(
        public account: Account,
        public loadoutMenu: LoadoutMenu,
    ) {
        follow(accountPass, (p) => {
            if (p) this.onPass(p.pass, p.quests, p.resetRefresh);
        });
        setPassPanel({
            getCategory: (gameType) => this.loadoutMenu.getCategory(gameType),
            onRefresh: (idx) => this.onRefreshClick(idx),
            onRefreshConfirm: (idx) => this.onRefreshConfirm(idx),
            onRefreshCancel: (idx) => this.setQuestView(idx, { promptOpen: false }),
        });
        this.loadPlaceholders();
    }

    setQuestView(idx: number, view: Partial<QuestView>) {
        setPassView((s) => {
            Object.assign(s.quests[idx], view);
        });
    }

    findQuest(idx: number) {
        return this.quests.find((q) => q.data.idx == idx);
    }

    onRefreshClick(idx: number) {
        if (this.findQuest(idx)?.refreshEnabled) {
            this.setQuestView(idx, { promptOpen: true });
        }
    }

    onRefreshConfirm(idx: number) {
        if (this.findQuest(idx)?.refreshEnabled) {
            this.setQuestView(idx, { loading: true, promptOpen: false });
            this.account.refreshQuest(idx);
        }
    }

    /** jQuery .queue()/.delay() replacement */
    after(timers: number[], ms: number, fn: () => void) {
        timers.push(window.setTimeout(fn, ms));
    }

    onPass(pass: PassState, quests: QuestState[], resetRefresh: boolean) {
        const refreshOffset = 5 * 1000;
        const newQuests = [];
        let questAnimCount = 0;
        for (let passIdx = 0; passIdx < quests.length; passIdx++) {
            const questData = quests[passIdx];
            type QuestData = typeof this["quests"][0];
            const quest: QuestData = {
                data: questData,
                start: 0,
                current: 0,
                ticker: 0,
                delay: questAnimCount * 0.5,
                playCompleteAnim: false,
                progressAnimFinished: false,
                completeAnimFinished: false,
                shouldRequestRefresh: resetRefresh,
                refreshTime: Date.now() + questData.timeToRefresh + refreshOffset,
                refreshSet: false,
                refreshEnabled: false,
                timer: {
                    enabled: false,
                    str: "",
                },
                iconTicker: 0,
                timers: [],
            };
            const curQuest = this.quests.find((existingQuest) => {
                return (
                    existingQuest.data.idx == quest.data.idx
                    && existingQuest.data.type == quest.data.type
                );
            });

            if (curQuest) {
                quest.start = curQuest.current;
                quest.current = curQuest.current;
                if (!curQuest.data.complete && quest.data.complete) {
                    quest.playCompleteAnim = true;
                }
            }
            quest.data.progress = math.min(quest.data.progress, quest.data.target);
            if (quest.data.progress > quest.current) {
                questAnimCount++;
            }
            if (curQuest) {
                for (const timer of curQuest.timers) clearTimeout(timer);
            }

            // Initialize quest UI
            const questDef = QuestDefs[quest.data.type];

            // Humanize time for survival quests
            let targetText: string | number = quest.data.target;
            if (questDef.timed) {
                targetText = humanizeTime(targetText);
            }

            setPassView((s) => {
                const old = s.quests[quest.data.idx];
                const next: QuestView = {
                    type: quest.data.type,
                    xp: questDef.xp,
                    current: String(Math.round(quest.current)),
                    target: String(targetText),
                    barPct: (quest.current / quest.data.target) * 100,
                    hasIcon: !!questDef.icon,
                    iconRot: math.rad2deg(questDef.icon?.rot ?? 0),
                    iconScale: questDef.icon?.scale ?? 1,
                    iconUrl1: old?.iconUrl1 ?? "",
                    iconUrl2: old?.iconUrl2 ?? "",
                    iconAlpha1: old?.iconAlpha1 ?? 1,
                    iconAlpha2: old?.iconAlpha2 ?? 0,
                    refreshEnabled: old?.refreshEnabled ?? false,
                    promptOpen: old?.promptOpen ?? false,
                    loading: false,
                    showTimer: old?.showTimer ?? false,
                    timerText: old?.timerText ?? "",
                    completing: false,
                    pulse: false,
                };
                if (old) Object.assign(old, next);
                else s.quests[quest.data.idx] = next;
            });
            this.setQuestRefreshEnabled(quest);
            newQuests.push(quest);
        }
        this.quests = newQuests;
        this.pass.data = pass;
        this.pass.animSteps = [];
        this.pass.currentXp = Math.round(this.pass.currentXp);
        this.pass.levelXp = passUtil.getPassLevelXp(pass.type, this.pass.currentLevel);
        if (this.phase != "loaded") {
            const initialLevelXp = passUtil.getPassLevelXp(pass.type, pass.level);
            this.pass.currentXp = 0;
            this.pass.currentLevel = pass.level;
            this.pass.levelXp = initialLevelXp;
            this.pass.ticker = 0;
        }
        let level = this.pass.currentLevel;
        let xp = this.pass.currentXp;
        // Animate level-ups

        if (this.phase == "loaded") {
            while (level < pass.level) {
                const levelXp = passUtil.getPassLevelXp(pass.type, level);
                this.pass.animSteps.push({
                    startXp: xp,
                    targetXp: levelXp,
                    levelXp,
                    targetLevel: level + 1,
                });
                level++;
                xp = 0;
            }
            const delay = questAnimCount > 0 ? 2 : 0;
            this.pass.ticker = -delay;
        }

        // Animate leftover xp
        const levelXp = passUtil.getPassLevelXp(pass.type, level);
        this.pass.animSteps.push({
            startXp: xp,
            targetXp: pass.xp,
            levelXp,
            targetLevel: level,
        });
        const unlockItemId = getNextPassUnlockItemId(
            this.pass.data.type,
            this.pass.currentLevel,
        );
        this.phase = "loaded";
        setPassView((s) => {
            s.phase = this.phase;
            s.unlockItem = unlockItemId;
            s.type = pass.type;
            s.level = this.pass.currentLevel;
            s.xpCurrent = this.pass.currentXp;
            s.xpTarget = this.pass.levelXp;
            s.barPct = (this.pass.currentXp / this.pass.levelXp) * 100;
        });
    }

    scheduleUpdatePass(delay: number) {
        this.updatePass = true;
        this.updatePassTicker = delay;
    }

    setQuestRefreshEnabled(quest: (typeof this.quests)[number]) {
        const shouldEnableRefresh = (!quest.data.rerolled && !quest.data.complete)
            || quest.refreshTime - Date.now() < 0;
        if (shouldEnableRefresh != quest.refreshEnabled || !quest.refreshSet) {
            quest.refreshEnabled = shouldEnableRefresh;
            quest.refreshSet = true;
            this.setQuestView(quest.data.idx, { refreshEnabled: shouldEnableRefresh });
        }
    }

    animatePassLevelUp() {
        setPassView((s) => {
            s.level = this.pass.currentLevel;
            s.unlockPulse = true;
        });
        this.after([], 750, () => {
            setPassView((s) => {
                s.unlockHidden = true;
            });
        });
        this.after([], 1000, () => {
            const nextUnlockItemId = getNextPassUnlockItemId(
                this.pass.data.type,
                this.pass.currentLevel,
            );
            setPassView((s) => {
                s.unlockItem = nextUnlockItemId;
                s.unlockPulse = false;
                s.unlockHidden = false;
            });
        });
    }

    animateQuestComplete(quest: (typeof this.quests)[number]) {
        const idx = quest.data.idx;
        this.setQuestView(idx, { pulse: true, refreshEnabled: true, completing: true });
    }

    update(dt: number) {
        this.updatePassTicker -= dt;

        if (this.updatePass && this.updatePassTicker < 0) {
            this.updatePass = false;
            this.account.getPass(false);
        }
        for (let questIndex = 0; questIndex < this.quests.length; questIndex++) {
            const fixedQuest = this.quests[questIndex];
            this.setQuestRefreshEnabled(fixedQuest);
            fixedQuest.ticker += dt;
            const questDef = QuestDefs[fixedQuest.data.type];

            if (!fixedQuest.data.complete) {
                if (questDef.icon?.urls && questDef.icon.urls.length > 1) {
                    fixedQuest.iconTicker += dt / 3;

                    const iconIdx = Math.floor(fixedQuest.iconTicker);

                    const swapIcons = iconIdx % 2 === 0;

                    // swap icons so they can fade in / out
                    const icon1 = util.wrappedArrayIndex(
                        questDef.icon.urls,
                        swapIcons ? iconIdx : iconIdx - 1,
                    );
                    const icon2 = util.wrappedArrayIndex(
                        questDef.icon.urls,
                        swapIcons ? iconIdx - 1 : iconIdx,
                    );

                    this.setQuestView(fixedQuest.data.idx, {
                        iconUrl1: `url(../${icon1})`,
                        iconUrl2: `url(../${icon2})`,
                        iconAlpha1: swapIcons ? 1 : 0,
                        iconAlpha2: swapIcons ? 0 : 1,
                    });
                } else if (questDef.icon?.urls) {
                    this.setQuestView(fixedQuest.data.idx, {
                        iconUrl1: `url(../${questDef.icon.urls[0]})`,
                        iconUrl2: "",
                        iconAlpha1: 1,
                        iconAlpha2: 0,
                    });
                }
            }

            if (!fixedQuest.progressAnimFinished) {
                const progressT = math.clamp(
                    (fixedQuest.ticker - fixedQuest.delay) / 1,
                    0,
                    1,
                );
                fixedQuest.current = math.lerp(
                    math.easeOutExpo(progressT),
                    fixedQuest.start,
                    fixedQuest.data.progress,
                );
                const pctComplete = (fixedQuest.current / fixedQuest.data.target) * 100;

                // Humanize time for survival quests
                let currentText: number | string = Math.round(fixedQuest.current);
                if (questDef.timed) {
                    currentText = humanizeTime(currentText, true);
                }
                this.setQuestView(fixedQuest.data.idx, {
                    current: String(currentText),
                    barPct: pctComplete,
                });
                if (progressT >= 1) {
                    fixedQuest.progressAnimFinished = true;
                }
            }
            if (
                fixedQuest.playCompleteAnim
                && !fixedQuest.completeAnimFinished
                && fixedQuest.ticker - fixedQuest.delay > 1.25
            ) {
                this.animateQuestComplete(fixedQuest);
                fixedQuest.completeAnimFinished = true;
            }
            const completionPhaseReady = !fixedQuest.playCompleteAnim
                || (fixedQuest.completeAnimFinished
                    && fixedQuest.ticker - fixedQuest.delay > 4.25);
            if (
                fixedQuest.data.complete
                && completionPhaseReady
                && fixedQuest.refreshEnabled
                && fixedQuest.shouldRequestRefresh
            ) {
                fixedQuest.shouldRequestRefresh = false;
                this.account.refreshQuest(fixedQuest.data.idx);
            }
            const showRefreshTimer = fixedQuest.data.complete && completionPhaseReady;
            if (showRefreshTimer != fixedQuest.timer.displayed) {
                fixedQuest.timer.displayed = showRefreshTimer;
                this.setQuestView(fixedQuest.data.idx, {
                    pulse: false,
                    completing: false,
                    showTimer: showRefreshTimer,
                });
            }
            if (showRefreshTimer) {
                const refreshTimeRemainingMs = Math.max(
                    fixedQuest.refreshTime - Date.now(),
                    0,
                );
                const refreshTimeText = humanizeTime(refreshTimeRemainingMs / 1000);
                if (refreshTimeText != fixedQuest.timer.str) {
                    fixedQuest.timer.str = refreshTimeText;
                    this.setQuestView(fixedQuest.data.idx, { timerText: refreshTimeText });
                }
            }
        }
        this.pass.ticker += dt;
        if (this.pass.animSteps.length > 0 && this.pass.ticker >= 0) {
            const activeAnimStep = this.pass.animSteps[0];
            const passAnimT = math.clamp(this.pass.ticker / 1.5, 0, 1);
            this.pass.currentXp = math.lerp(
                math.easeOutExpo(passAnimT),
                activeAnimStep.startXp,
                activeAnimStep.targetXp,
            );
            this.pass.levelXp = activeAnimStep.levelXp;
            const passProgressPct = (this.pass.currentXp / activeAnimStep.levelXp) * 100;
            setPassView((s) => {
                s.xpCurrent = Math.round(this.pass.currentXp);
                s.xpTarget = this.pass.levelXp;
                s.barPct = passProgressPct;
            });
            if (passAnimT >= 1) {
                if (activeAnimStep.targetLevel > this.pass.currentLevel) {
                    this.pass.currentLevel = activeAnimStep.targetLevel;
                    this.animatePassLevelUp();
                }
                this.pass.animSteps.shift();
                this.pass.ticker -= 3;
            }
        }
        const status = this.account.status;
        if (this.phase == "loading" && (status == "unknown" || status == "loggedOut")) {
            this.phase = "locked";
            setPassView((s) => {
                s.phase = this.phase;
            });
        }
    }

    onResize() {}
    loadPlaceholders() {
        const def = PassDefs[this.pass.data.type];
        setPassView((s) => {
            s.type = this.pass.data.type;
            s.level = 1;
            s.xpCurrent = 0;
            s.xpTarget = def.xp[0];
            s.unlockItem = def.items[0].item;
        });
    }
}
