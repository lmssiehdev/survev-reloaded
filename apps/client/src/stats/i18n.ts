import english from "@survev/shared/l10n/stats.en.json";
import { createI18n } from "../lib/createI18n.ts";
import { config } from "./config.ts";

export const statsLocales = {
    en: "English",
    es: "Español",
} as const;

export type StatsLocale = keyof typeof statsLocales;
const { "@metadata": _metadata, ...base } = english;
export type StatsKey = keyof typeof base;

const isStatsLocale = (locale: unknown): locale is StatsLocale => typeof locale === "string" && locale in statsLocales;

const i18n = createI18n<StatsLocale, StatsKey>({
    base,
    baseLocale: "en",
    // relative to /stats/
    url: (locale) => `../l10n/stats/${locale}.json`,
});

/** reactive when read in JSX or a memo; t() falls back to English */
export const { locale, t } = i18n;

/** downloads the language file if needed, then switches; also saved to the config */
export function setLocale(next: StatsLocale, save = true) {
    if (save) config.set("language", next);
    return i18n.setLocale(next);
}

const saved = config.get("language");
if (isStatsLocale(saved) && saved !== "en") void setLocale(saved, false);
