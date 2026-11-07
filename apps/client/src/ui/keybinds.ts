import { createStore, reconcile } from "solid-js";
import type { InputBindUi } from "../inputBinds.ts";
import { controller } from "./controller.ts";

/** the keybind lists' data; InputBinds writes it, components/Keybinds.tsx reads it */
export const [keybinds, setKeybinds] = createStore({
    /** display name of each bind's input (InputValue.toString()), null when unbound */
    inputs: [] as (string | null)[],
    /** the share code for the current binds */
    code: "",
    /** the bind waiting for a key press */
    capturing: null as number | null,
});

export function setKeybindView(inputs: (string | null)[], code: string) {
    setKeybinds((s) => {
        reconcile(inputs)(s.inputs);
        s.code = code;
    });
}

export function setCapturing(bind: number | null) {
    setKeybinds((s) => {
        s.capturing = bind;
    });
}

/** set once the game's input handler exists (after the renderer starts) */
export const [keybindUi, setKeybindUi] = controller<InputBindUi>();
