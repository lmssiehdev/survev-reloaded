import { createSignal } from "solid-js";

/** a short message ("Copied!", "Loaded!") that floats up from where it was clicked, then fades */
export interface Toast {
    text: string;
    left: number;
    top: number;
    rise: number;
}

export const [toasts, setToasts] = createSignal<Toast[]>([]);

/** shows `text` at the click's x, rising from `anchor`'s top (components/App.tsx renders it) */
export function showToast(text: string, anchor: Element, event: MouseEvent, rise = 25) {
    const toast = { text, left: event.clientX, top: anchor.getBoundingClientRect().top, rise };
    setToasts((list) => [...list, toast]);
}

export function removeToast(toast: Toast) {
    setToasts((list) => list.filter((t) => t !== toast));
}
