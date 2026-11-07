import $ from "jquery";
import { device } from "../device.ts";
import type { InputBindUi } from "../inputBinds.ts";
import { keybindModal } from "./appModals.ts";
import { resetKeybindModal } from "./components/Keybinds.tsx";

function setupModals(inputBindUi: InputBindUi) {
    keybindModal.onShow(resetKeybindModal);
    keybindModal.onHide(() => inputBindUi.cancelBind());
}

function onResize() {
    // Add styling specific to safari in browser
    if (device.os == "ios") {
        // iPhone X+ specific
        if (device.model == "iphonex") {
            if (device.isLandscape) {
                $(".main-volume-slider").css("width", "90%");
            } else {
                $(".main-volume-slider").css("width", "");
            }
        } else if (!window.navigator.standalone) {
            if (device.isLandscape) {
                $("#start-main-center").attr("style", "");
                $("#modal-customize .modal-content").attr("style", "");
            } else {
                $("#modal-customize .modal-content").css({
                    transform: "translate(-50%, -50%) scale(0.45)",
                    top: "38%",
                });
            }
        }
    }
}

export default {
    setupModals,
    onResize,
};
