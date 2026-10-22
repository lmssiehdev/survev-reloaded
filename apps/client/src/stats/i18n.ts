import { createSignal, createStore } from "solid-js";
import { config } from "./config.ts";
import english from "./en.json";

export const statsLocales = {
    en: "English",
    es: "Español",
} as const;

export type StatsLocale = keyof typeof statsLocales;
const { "@metadata": _metadata, ...base } = english;
export type StatsKey = keyof typeof base;

const isStatsLocale = (locale: unknown): locale is StatsLocale => typeof locale === "string" && locale in statsLocales;

const [locale, setLocaleSignal] = createSignal<StatsLocale>("en");
const [dicts, setDicts] = createStore<Partial<Record<StatsLocale, Record<string, string>>>>({
    en: base,
});
let requested: StatsLocale = "en";

export { locale };

/** downloads the language file if needed, then switches; also saved to the config */
export async function setLocale(next: StatsLocale, save = true) {
    requested = next;
    if (save) config.set("language", next);
    if (!dicts[next]) {
        try {
            // relative to /stats/
            const res = await fetch(`../l10n/stats/${next}.json`);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = (await res.json()) as Record<string, string>;
            setDicts((d) => {
                d[next] = data;
            });
        } catch (err) {
            console.error(`Failed loading translation data for locale ${next}`, err);
            return;
        }
    }
    // a newer setLocale call won
    if (requested === next) setLocaleSignal(next);
}

/** reactive when read in JSX or a memo; falls back to English */
export function t(key: StatsKey): string {
    return dicts[locale()]?.[key] || base[key] || "";
}

const saved = config.get("language");
if (isStatsLocale(saved) && saved !== "en") void setLocale(saved, false);
