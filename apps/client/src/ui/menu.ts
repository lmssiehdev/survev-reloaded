import { device } from "../device.ts";
import type { InputBindUi } from "../inputBinds.ts";
import { keybindModal } from "./appModals.ts";
import { resetKeybindModal } from "./components/Keybinds.tsx";

function setupModals(inputBindUi: InputBindUi) {
    keybindModal.onShow(resetKeybindModal);
    keybindModal.onHide(() => inputBindUi.cancelBind());
}

const all = (selector: string) => document.querySelectorAll<HTMLElement>(selector);

function onResize() {
    // Add styling specific to safari in browser
    if (device.os == "ios") {
        // iPhone X+ specific
        if (device.model == "iphonex") {
            for (const el of all(".main-volume-slider")) el.style.width = device.isLandscape ? "90%" : "";
        } else if (!window.navigator.standalone) {
            if (device.isLandscape) {
                for (const el of all("#start-main-center, #modal-customize .modal-content")) {
                    el.removeAttribute("style");
                }
            } else {
                for (const el of all("#modal-customize .modal-content")) {
                    el.style.transform = "translate(-50%, -50%) scale(0.45)";
                    el.style.top = "38%";
                }
            }
        }
    }
}

export default {
    setupModals,
    onResize,
};
