import type { InputBindUi } from "../inputBinds.ts";
import { keybindModal } from "./appModals.ts";
import { resetKeybindModal } from "./components/Keybinds.tsx";

function setupModals(inputBindUi: InputBindUi) {
    keybindModal.onShow(resetKeybindModal);
    keybindModal.onHide(() => inputBindUi.cancelBind());
}

export default {
    setupModals,
};
