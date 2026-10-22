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
 * setting state writes every field back, so the URL always holds the full state.
 */
export function useSearchState<S extends Record<string, string>>(fields: { [K in keyof S]: SearchField<S[K]> }) {
    const [search, setSearch] = useSearchParams();
    const keys = Object.keys(fields) as (keyof S & string)[];

    const state = createMemo(() => {
        const entries = keys.map((k) => {
            const raw = search[fields[k].key];
            return [k, fields[k].parse(typeof raw === "string" ? raw : undefined)];
        });
        return Object.fromEntries(entries) as S;
    });

    function update(next: Partial<S>) {
        const merged = { ...state(), ...next };
        setSearch(Object.fromEntries(keys.map((k) => [fields[k].key, merged[k]])));
    }

    return [state, update] as const;
}
