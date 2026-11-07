import { For } from "solid-js";
import { config } from "../../appConfig.ts";
import type { ConfigKey } from "../../config.ts";
import { settingsModal } from "../appModals.ts";
import { isLocale, locale, Locales, locales, type MessageKey, t } from "../i18n.ts";
import { Modal } from "./Modal.tsx";

type BoolKey = { [K in ConfigKey]: (typeof config.state)[K] extends boolean ? K : never }[ConfigKey];
type VolumeKey = "masterVolume" | "soundVolume" | "musicVolume";

const checkboxes: { key: BoolKey; label: MessageKey; id?: string; hideOnMobile?: boolean }[] = [
    { key: "highResTex", label: "index-high-resolution", id: "modal-settings-high-res" },
    { key: "interpolation", label: "index-client-side-interp", id: "modal-settings-interp" },
    { key: "localRotation", label: "index-client-side-rotation", id: "modal-settings-rotation", hideOnMobile: true },
    { key: "screenShake", label: "index-screen-shake", hideOnMobile: true },
    { key: "anonPlayerNames", label: "index-anon-player-names" },
];

const sliders: { key: VolumeKey; label: MessageKey; class: string }[] = [
    { key: "masterVolume", label: "index-master-volume", class: "sl-master-volume" },
    { key: "soundVolume", label: "index-sfx-volume", class: "sl-sound-volume" },
    { key: "musicVolume", label: "index-music-volume", class: "sl-music-volume" },
];

/** the language picker: in the start menu's bottom bar, and in the settings modal on small screens */
export function LanguageSelect() {
    return (
        <div class="language-select-wrap">
            <select
                class="language-select"
                onChange={(e) => {
                    const value = e.currentTarget.value;
                    if (isLocale(value)) config.set("language", value);
                }}
            >
                <For each={locales}>
                    {(loc) => <option value={loc} selected={loc === locale()}>{Locales[loc]}</option>}
                </For>
            </select>
        </div>
    );
}

export function SettingsModal() {
    return (
        <Modal
            modal={settingsModal}
            id="modal-settings"
            title={t("index-settings")}
            bodyId="modal-settings-body"
            footer={<div class="modal-footer"></div>}
        >
            <div id="language-select-mobile-wrapper" class="modal-settings-item">
                <LanguageSelect />
            </div>
            <For each={checkboxes}>
                {(item) => (
                    <div id={item.id} class={["modal-settings-item", { "hide-on-mobile": item.hideOnMobile }]}>
                        <input
                            id={item.key}
                            type="checkbox"
                            checked={config.state[item.key]}
                            onChange={(e) => config.set(item.key, e.currentTarget.checked)}
                        />
                        <p class="modal-settings-checkbox-text">{t(item.label)}</p>
                    </div>
                )}
            </For>
            <For each={sliders}>
                {(slider) => (
                    <div class="modal-settings-item slider-container main-volume-slider">
                        <p class="modal-slider-text">{t(slider.label)}</p>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            class={`slider ${slider.class}`}
                            value={config.state[slider.key] * 100}
                            onInput={(e) => config.set(slider.key, Number(e.currentTarget.value) / 100)}
                        />
                    </div>
                )}
            </For>
            <div id="settings-links">
                <a href="attribution.txt" target="_blank">{t("index-attributions")}</a>
            </div>
        </Modal>
    );
}
