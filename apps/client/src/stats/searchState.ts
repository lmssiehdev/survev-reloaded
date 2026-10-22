import { useSearchParams } from "@solidjs/router";
import { createMemo } from "solid-js";

/** one URL search param and how to read it */
export interface SearchField<T extends string> {
    key: string;
    parse: (raw: string | undefined) => T;
}

/** a value from a fixed list; anything else falls back */
export function oneOf<T extends string>(key: string, values: readonly T[], fallback: T): SearchField<T> {
    return { key, parse: (raw) => values.find((v) => v === raw) ?? fallback };
}

/** free text; empty falls back */
export function text(key: string, fallback: string): SearchField<string> {
    return { key, parse: (raw) => raw || fallback };
}

/**
 * page state kept in the URL; `fields` maps each state key to its search param.
 * each key is its own memo, so reading `state.type` only tracks `?type=`;
 * spreading the state (`{ ...state }`) reads, and tracks, every key.
 * setting state writes every field back, so the URL always holds the full state.
 */
export function useSearchState<S extends Record<string, string>>(fields: { [K in keyof S]: SearchField<S[K]> }) {
    const [search, setSearch] = useSearchParams();
    const keys = Object.keys(fields) as (keyof S & string)[];

    const state = {} as Readonly<S>;
    for (const k of keys) {
        const value = createMemo(() => {
            const raw = search[fields[k].key];
            return fields[k].parse(typeof raw === "string" ? raw : undefined);
        });
        Object.defineProperty(state, k, { get: value, enumerable: true });
    }

    function update(next: Partial<S>) {
        const merged = { ...state, ...next };
        setSearch(Object.fromEntries(keys.map((k) => [fields[k].key, merged[k]])));
    }

    return [state, update] as const;
}
