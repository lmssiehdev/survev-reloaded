import $ from "jquery";
import { device } from "../device.ts";
import { detectLocale, isLocale, type Locale, locale, Locales, locales, setLocale, translate } from "./i18n.ts";

export type { Locale };

/**
 * The game classes' handle on ./i18n.ts. TSX reads `t()` from there directly; this keeps the
 * static `data-l10n` markup in index.html translated until those screens are components.
 */
export class Localization {
    setLocale(next: Locale) {
        void setLocale(isLocale(next) ? next : "en").then((switched) => {
            if (switched) this.localizeIndex();
        });
    }

    getLocale() {
        return locale();
    }

    translate(key: string) {
        return translate(key);
    }

    localizeIndex() {
        // Go through index and replace data-l10n tagged elements
        const localizedElements = $("*[data-l10n]");
        localizedElements.each((_idx, el): any => {
            const el$ = $(el);
            let datal10n = el$.attr("data-l10n")!;
            if (el$.hasClass("help-control") && device.touch) {
                datal10n += "-touch";
            }
            let localizedText = this.translate(datal10n);
            if (localizedText) {
                if (el$.attr("data-caps") === "true") {
                    localizedText = localizedText.toUpperCase();
                }
                if (el$.attr("label")) {
                    el$.attr("label", localizedText);
                    return true;
                }
                if (el$.attr("placeholder")) {
                    el$.attr("placeholder", localizedText);
                    return true;
                }
                el$.html(localizedText);
                if (el$.attr("data-label")) {
                    el$.attr("data-label", localizedText);
                }
            }
        });

        $("#start-bottom-right .language-select").val(this.getLocale());
    }

    populateLanguageSelect() {
        // the start menu's; the settings modal's is TSX
        const el = $("#start-bottom-right .language-select");
        el.empty();
        for (const loc of locales) {
            el.append($("<option>", { value: loc, text: Locales[loc] }));
        }
    }

    detectLocale() {
        return detectLocale();
    }
}
