import { createEffect, createRoot } from "solid-js";

/**
 * A game class that a view calls into, created after the views mount. Views only call it from
 * event handlers, so it is a plain reference, not a signal: `const [get, set] = controller<T>()`.
 */
export function controller<T>() {
    let current: T | null = null;
    return [() => current, (value: T) => void (current = value)] as const;
}

/**
 * The other way round: a game class following reactive state. Runs `fn` after each change of
 * `source` (not for its current value), once Solid's flush is over, like an event listener: it can
 * read anything and `flush()` before measuring the DOM. Call the returned function to stop.
 */
export function follow<T>(source: () => T, fn: (value: T, prev: T | undefined) => void) {
    let stopped = false;
    // game classes live outside any component, so this owns its effect
    const dispose = createRoot((dispose) => {
        createEffect(source, (value, prev) => {
            queueMicrotask(() => {
                if (!stopped) fn(value, prev);
            });
        }, { defer: true });
        return dispose;
    });
    return () => {
        stopped = true;
        dispose();
    };
}
