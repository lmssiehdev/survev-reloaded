import { type Accessor, createSignal, createStore, flush } from "solid-js";

export interface I18n<L extends string, K extends string> {
    /** reactive in JSX and memos */
    locale: Accessor<L>;
    /**
     * Downloads the language file if needed, then switches. Resolves false if the download
     * failed or a newer setLocale call won; the locale is unchanged then.
     */
    setLocale(next: L): Promise<boolean>;
    /** the text for `key` in the current locale, falling back to the base (English) text */
    t(key: K): string;
    /** the current locale's text for any key, no fallback */
    find(key: string): string | undefined;
}

/**
 * A locale signal plus a store of downloaded dictionaries, created at module level so legacy
 * classes and TSX components share them.
 *
 * Language files are not an async memo on purpose: a pending async memo holds every computation
 * that reads it, so a slow download would freeze any text that also goes through t(). The
 * dictionary is fetched first, then committed together with the locale.
 */
export function createI18n<L extends string, K extends string>(opts: {
    base: Record<K, string>;
    baseLocale: L;
    url: (locale: L) => string;
}): I18n<L, K> {
    // (the function form: a plain generic value trips createSignal's not-a-function overload)
    const [locale, setLocaleSignal] = createSignal<L>(() => opts.baseLocale);
    // downloaded dictionaries by locale
    const [dicts, setDicts] = createStore<Record<string, Record<string, string>>>({});
    let requested = opts.baseLocale;

    async function setLocale(next: L) {
        requested = next;
        if (next !== opts.baseLocale && !dicts[next]) {
            try {
                const res = await fetch(opts.url(next));
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = (await res.json()) as Record<string, string>;
                setDicts((d) => {
                    d[next] = data;
                });
            } catch (err) {
                console.error(`Failed loading translation data for locale ${next}`, err);
                return false;
            }
        }
        if (requested !== next) return false;
        setLocaleSignal(() => next);
        // imperative callers read locale() and t() right after awaiting this
        flush();
        return true;
    }

    function find(key: string) {
        return dicts[locale()]?.[key];
    }

    function t(key: K) {
        return find(key) || opts.base[key] || "";
    }

    return { locale, setLocale, t, find };
}
