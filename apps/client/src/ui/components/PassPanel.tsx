import { type JSX, render } from "@solidjs/web";
import type { EmoteDef } from "@survev/shared/defs/gameObjects/emoteDefs.ts";
import type { HealEffectDef } from "@survev/shared/defs/gameObjects/healEffectDefs.ts";
import type { MeleeDef } from "@survev/shared/defs/gameObjects/meleeDefs.ts";
import type { OutfitDef } from "@survev/shared/defs/gameObjects/outfitDefs.ts";
import { GameObjectDefs } from "@survev/shared/defs/register.ts";
import { createMemo, createSignal, For } from "solid-js";
import { helpers } from "../../helpers.ts";
import { t, translate } from "../i18n.ts";
import { type Fade, passView, type QuestView } from "../passView.ts";
import { profileUi } from "../profile.ts";
import { startMenu } from "../startMenu.ts";
import { RightColumnToggle } from "./StartMenu.tsx";

export interface PassPanelProps {
    getCategory(gameType: string): { loadoutType: string; categoryImage: string } | null;
    onRefresh(idx: number): void;
    onRefreshConfirm(idx: number): void;
    onRefreshCancel(idx: number): void;
}

const QUEST_SLOTS = [0, 1];

function fadeStyle(fade: Fade): JSX.CSSProperties {
    return {
        opacity: String(fade.opacity),
        transition: fade.ms ? `opacity ${fade.ms}ms` : undefined,
    };
}

function display(visible: boolean) {
    return visible ? "block" : "none";
}

function UnlockTooltip(props: { title: string; desc: string; visible: boolean; hovered: boolean }) {
    return (
        <div
            id="pass-unlock-tooltip"
            style={{
                display: display(props.hovered),
                opacity: props.visible ? "1" : "0",
            }}
        >
            <div class="tooltip-pass-title">{props.title}</div>
            <div class="tooltip-pass-desc">{props.desc}</div>
        </div>
    );
}

function Quest(props: { idx: number; quest: QuestView | undefined } & PassPanelProps) {
    const title = () => (props.quest ? translate(props.quest.type) || props.quest.type : "");
    const descFontSize = createMemo(() =>
        helpers.measureText(title(), "16px Phantom Guardians") > 155 ? "14px" : "16px"
    );
    return (
        <div
            id={`pass-quest-${props.idx}`}
            class={["pass-quest", { "pass-bg-pulse": !!props.quest?.pulse }]}
            style={props.quest ? { display: "block", ...fadeStyle(props.quest.main) } : undefined}
        >
            <div class="pass-quest-timer" style={{ display: display(!!props.quest?.showTimer) }}>
                {props.quest?.timerText}
            </div>
            <div class="pass-quest-spinner-container">
                <div class="pass-quest-spinner" style={{ display: display(!!props.quest?.loading) }} />
            </div>
            <div class="pass-quest-refresh-prompt" style={{ display: display(!!props.quest?.promptOpen) }}>
                <div class="pass-quest-refresh-prompt-text">{t("quest-refresh-prompt")}</div>
                <div
                    class="pass-quest-refresh-confirm btn-pass-quest-refresh"
                    onClick={() => props.onRefreshConfirm(props.idx)}
                />
                <div
                    class="pass-quest-refresh-cancel btn-pass-quest-refresh"
                    onClick={() => props.onRefreshCancel(props.idx)}
                />
            </div>
            <div
                class="pass-quest-info"
                style={{
                    display: display(!props.quest?.showTimer && !props.quest?.promptOpen && !props.quest?.loading),
                }}
            >
                <div class="pass-quest-desc-container">
                    <span
                        class="pass-quest-icon"
                        style={props.quest
                            ? {
                                display: props.quest.hasIcon ? undefined : "none",
                                transform: props.quest.hasIcon
                                    ? `rotate(${props.quest.iconRot}deg) scale(${props.quest.iconScale})`
                                    : undefined,
                                "--img-url-1": props.quest.iconUrl1 || undefined,
                                "--img-url-2": props.quest.iconUrl2 || undefined,
                                "--img-alpha-1": String(props.quest.iconAlpha1),
                                "--img-alpha-2": String(props.quest.iconAlpha2),
                            }
                            : undefined}
                    />{" "}
                    <span class="pass-quest-desc" style={{ "font-size": props.quest ? descFontSize() : undefined }}>
                        {props.quest?.completeText ? "QUEST COMPLETE!" : title()}
                    </span>
                </div>
                <div
                    class={["pass-quest-xp", { "pass-text-pulse": !!props.quest?.pulse }]}
                    data-xp={props.quest?.xp}
                >
                    {props.quest ? `${props.quest.xp} XP` : ""}
                </div>
                <div
                    class={["pass-quest-refresh", {
                        "pass-quest-refresh-disabled": !!props.quest && !props.quest.refreshEnabled,
                    }]}
                    style={props.quest ? fadeStyle(props.quest.refresh) : undefined}
                    onClick={() => props.onRefresh(props.idx)}
                />
                <div class="pass-quest-progress">
                    <div class="pass-quest-bar">
                        <div
                            class="pass-quest-bar-fill"
                            style={props.quest ? { width: `${props.quest.barPct}%` } : undefined}
                        />
                    </div>{" "}
                    <div class="pass-quest-counter" style={props.quest ? fadeStyle(props.quest.counter) : undefined}>
                        <span class="pass-quest-counter-current">{props.quest?.current}</span> <span>/</span>{" "}
                        <span class="pass-quest-counter-target">{props.quest?.target}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function PassPanel(props: PassPanelProps) {
    const [hovered, setHovered] = createSignal(false);

    const unlock = createMemo(() => {
        const item = passView.unlockItem;
        const def = GameObjectDefs.typeToDefSafe(item) as
            | OutfitDef
            | EmoteDef
            | MeleeDef
            | HealEffectDef
            | undefined;
        const category = def ? props.getCategory(def.type) : null;
        return {
            def,
            image: `url(${def ? helpers.getSvgFromGameType(item) : "img/emotes/surviv.svg"})`,
            transform: `translate(-50%, -50%) ${helpers.getCssTransformFromGameType(item)}`,
            filter: def?.type === "outfit" ? helpers.getSvgFilterForTint(def.lootImg.tint) : "",
            title: category ? translate(`loadout-title-${category.loadoutType}`).toUpperCase() : "",
            typeImage: category ? `url(${category.categoryImage})` : "",
        };
    });

    return (
        <>
            <UnlockTooltip
                title={unlock().title}
                desc={unlock().def?.name ?? ""}
                visible={!!unlock().def}
                hovered={hovered()}
            />
            <RightColumnToggle class="news-toggle">
                <div class="account-alert" style={{ display: startMenu.newsUnread ? "block" : "none" }} />
            </RightColumnToggle>
            <div
                id="pass-loading"
                class="pass-column menu-block"
                style={{ display: display(passView.loadingVisible) }}
            >
                <div id="pass-loading-spinner" />
            </div>
            <div
                id="pass-block"
                class="pass-column menu-block"
                style={passView.blockRaised ? { "z-index": "1" } : undefined}
            >
                <div id="pass-name">
                    <span id="pass-name-text">{translate(passView.type).toUpperCase()}</span>
                </div>
                <div id="pass-progress">
                    <div id="pass-progress-level">{passView.level}</div>
                    <div id="pass-progress-bar">
                        <div id="pass-progress-bar-fill" style={{ width: `${passView.barPct}%` }} />
                        <div id="pass-progress-xp">
                            <span id="pass-progress-xp-current">{passView.xpCurrent}</span> <span>/</span>{" "}
                            <span id="pass-progress-xp-target">{passView.xpTarget}</span> <span>XP</span>
                        </div>
                    </div>
                    <div
                        id="pass-progress-unlock-wrapper"
                        class={{ "pass-unlock-pulse": passView.unlockPulse }}
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                    >
                        <div
                            id="pass-progress-unlock"
                            style={{ opacity: unlock().def ? "1" : "0.15", transform: unlock().transform }}
                        >
                            <div
                                id="pass-progress-unlock-image"
                                style={{
                                    "background-image": unlock().image,
                                    filter: unlock().filter || undefined,
                                    ...fadeStyle(passView.unlockImages),
                                }}
                            />
                        </div>
                        <div
                            id="pass-progress-unlock-type-wrapper"
                            style={{ display: display(!!unlock().def) }}
                        >
                            <div id="pass-progress-unlock-type-border">
                                <div
                                    id="pass-progress-unlock-type-image"
                                    style={{
                                        "background-image": unlock().typeImage || undefined,
                                        ...fadeStyle(passView.unlockImages),
                                    }}
                                />
                            </div>
                            <div id="pass-progress-unlock-overlay" />
                        </div>
                    </div>
                </div>
                <div id="pass-quest-wrapper">
                    <div id="pass-locked" style={{ display: display(passView.lockedVisible) }}>
                        <div
                            id="btn-pass-locked"
                            class="menu-option btn-darken"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                profileUi()?.showLoginMenu({ modal: true });
                            }}
                        >
                            {t("quest-login-prompt")}
                        </div>
                    </div>
                    <For each={QUEST_SLOTS}>
                        {(idx) => <Quest idx={idx} quest={passView.quests[idx]} {...props} />}
                    </For>
                </div>
            </div>
        </>
    );
}

/** fills #pass-wrapper in index.html */
export function mountPassPanel(el: HTMLElement, props: PassPanelProps) {
    return render(() => <PassPanel {...props} />, el);
}
