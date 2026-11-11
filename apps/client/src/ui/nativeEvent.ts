/**
 * `ref={onNative("touchstart", handler)}`: a listener on the element itself. Solid delegates
 * touch events to the document, where `stopPropagation()` comes too late for the game's own
 * document listeners (EmoteBarn, UiManager, InputHandler).
 */
export function onNative<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
) {
    return (el: HTMLElement) => el.addEventListener(type, handler);
}
