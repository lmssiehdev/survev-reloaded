import { createSignal, For } from "solid-js";
import { helpers } from "../../helpers.ts";
import { bindList } from "../../inputBinds.ts";
import { keybindModal } from "../appModals.ts";
import { t, translate } from "../i18n.ts";
import { keybinds, keybindUi } from "../keybinds.ts";
import { showToast } from "../toast.ts";

/** one row per bind: click a name, then press the new key */
function KeybindList(props: { id: string; height?: string }) {
    return (
        <div id={props.id} class="js-keybind-list" style={{ height: props.height }}>
            <For each={bindList}>
                {(item) => {
                    const inputLabel = () => {
                        const input = keybinds.inputs[item.bind];
                        return input ? translate(input) || input : "";
                    };
                    return (
                        <div class="ui-keybind-container">
                            <a
                                class={[
                                    "btn-game-menu btn-darken btn-keybind-desc",
                                    { "btn-keybind-desc-selected": keybinds.capturing === item.bind },
                                ]}
                                onClick={() => keybindUi()?.capture(item.bind)}
                            >
                                {translate(item.nameKey) || item.name}
                            </a>
                            <div class="btn-keybind-display">{inputLabel()}</div>
                        </div>
                    );
                }}
            </For>
        </div>
    );
}

const [shareOpen, setShareOpen] = createSignal(false);
const [codeWarning, setCodeWarning] = createSignal(false);

/** the share section starts closed every time the modal opens */
export function resetKeybindModal() {
    setShareOpen(false);
    setCodeWarning(false);
}

/** "Customize Keybinds", opened from the start menu */
export function KeybindModal() {
    const [code, setCode] = createSignal("");
    let link!: HTMLDivElement;
    const copy = (e: MouseEvent) => {
        showToast("Copied!", link, e);
        helpers.copyTextToClipboard(keybinds.code);
    };
    return (
        <div
            id="ui-modal-keybind"
            class={["ui-modal-keybind modal", keybindModal.classes()]}
            ref={(el) => keybindModal.attach(el)}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div class="ui-modal-keybind-content modal-content modal-close">
                <div id="ui-modal-keybind-header" class="modal-header">
                    <span id="ui-close-keybind" class="close close-corner" onClick={(e) => keybindModal.hide(e)} />
                    <h2>{t("index-customize-keybinds")}</h2>
                </div>
                <div id="ui-modal-keybind-body" class="modal-body">
                    <KeybindList id="ui-modal-keybind-list" height={shareOpen() ? "275px" : "420px"} />
                    <div id="ui-modal-keybind-share" style={{ display: shareOpen() ? "block" : "none" }}>
                        <div class="ui-modal-keybind-share-row">
                            <div class="ui-modal-keybind-share-elem">
                                <span>{t("index-keybind-link")}</span>:
                            </div>
                            <div class="ui-modal-keybind-share-elem">
                                <div id="keybind-link-text">
                                    <div id="keybind-link" ref={(el) => (link = el)} onClick={copy}>
                                        {keybinds.code}
                                    </div>
                                    <span id="keybind-copy" class="copy-item btn-darken" onClick={copy} />
                                </div>
                            </div>
                        </div>
                        <span class="keybind-share-paste-text">{t("index-keybind-paste")}</span>
                        <span>:</span>
                        <div
                            id="keybind-warning"
                            class="link-warning"
                            style={{ display: codeWarning() ? "block" : "none" }}
                        >
                            Invalid code!
                        </div>
                        <div class="ui-modal-keybind-share-row">
                            <input
                                id="keybind-code-input"
                                type="text"
                                class="menu-option"
                                tabindex="0"
                                placeholder="Paste a keybind code here"
                                value={code()}
                                onInput={(e) => setCode(e.currentTarget.value)}
                            />
                            <a
                                id="btn-keybind-code-load"
                                class="btn-game-menu btn-darken"
                                onClick={(e) => {
                                    const success = !!keybindUi()?.loadCode(code());
                                    setCode("");
                                    setCodeWarning(!success);
                                    if (success) showToast("Loaded!", e.currentTarget, e);
                                }}
                            >
                                {t("index-keybind-apply")}
                            </a>
                        </div>
                    </div>
                </div>
                <div id="ui-modal-keybind-footer" class="modal-footer modal-footer-round">
                    <a
                        class="js-btn-keybind-share btn-game-menu btn-darken"
                        onClick={() => setShareOpen((open) => !open)}
                    >
                        {t("game-share")}
                    </a>
                    <a
                        class="js-btn-keybind-restore btn-game-menu btn-darken"
                        onClick={() => keybindUi()?.restoreDefaults()}
                    >
                        {t("game-restore-defaults")}
                    </a>
                </div>
            </div>
        </div>
    );
}

/** the in-game menu's keybinds tab */
/** the in-game menu's keybinds tab (components/GameMenu.tsx) */
export function GameKeybindsTab() {
    return (
        <>
            <KeybindList id="ui-keybind-list" />
            <a
                class="js-btn-keybind-restore btn-keybind-restore btn-game-menu btn-darken"
                onClick={() => keybindUi()?.restoreDefaults()}
            >
                {t("game-restore-defaults")}
            </a>
        </>
    );
}
