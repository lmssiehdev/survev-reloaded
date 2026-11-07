import { detectLocale, isLocale, type Locale, locale, setLocale, translate } from "./i18n.ts";

export type { Locale };

/**
 * The game classes' handle on ./i18n.ts; TSX reads `t()` from there directly.
 */
export class Localization {
    setLocale(next: Locale) {
        void setLocale(isLocale(next) ? next : "en");
    }

    getLocale() {
        return locale();
    }

    translate(key: string) {
        return translate(key);
    }

    detectLocale() {
        return detectLocale();
    }
}
