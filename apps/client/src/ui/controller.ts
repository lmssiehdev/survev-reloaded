/**
 * A game class that a view calls into, created after the views mount. Views only call it from
 * event handlers, so it is a plain reference, not a signal: `const [get, set] = controller<T>()`.
 */
export function controller<T>() {
    let current: T | null = null;
    return [() => current, (value: T) => void (current = value)] as const;
}
