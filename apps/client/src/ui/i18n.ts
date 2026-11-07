import english from "../en.json";
import { createI18n } from "../lib/createI18n.ts";

export const Locales = {
    da: "Dansk",
    de: "Deutsch",
    en: "English",
    es: "Español",
    fr: "Français",
    it: "Italiano",
    nl: "Nederlands",
    pl: "Polski",
    pt: "Português",
    ru: "Русский",
    sv: "Svenska",
    vn: "Tiếng Việt",
    tr: "Türkçe",
    jp: "日本語",
    ko: "한국어",
    th: "ภาษาไทย",
    "zh-cn": "中文简体",
    "zh-tw": "中文繁體",
};

export type Locale = keyof typeof Locales;
export const locales = Object.keys(Locales) as Locale[];
export const isLocale = (value: unknown): value is Locale => typeof value === "string" && value in Locales;

/** every key in en.json; a typo is a compile error */
export type MessageKey = keyof typeof english;

const i18n = createI18n<Locale, MessageKey>({
    base: english,
    baseLocale: "en",
    url: (locale) => `./l10n/${locale}.json`,
});

export const { locale, setLocale, t } = i18n;

/** for keys built at runtime (`game-${type}`); "a b" also tries "a-b" */
export function translate(key: string): string {
    return i18n.find(key) || i18n.find(key.replace(" ", "-")) || (english as Record<string, string>)[key] || "";
}

/** the browser's language if we have it, else English */
export function detectLocale(): Locale {
    let detected = navigator.language.toLowerCase();
    for (const wildcard of ["pt", "de", "es", "fr", "ko", "ru", "en"]) {
        if (detected.includes(wildcard)) {
            detected = wildcard;
            break;
        }
    }
    return locales.find((loc) => detected.includes(loc)) ?? "en";
}
