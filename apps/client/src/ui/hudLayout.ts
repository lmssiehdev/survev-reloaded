import { device, layout } from "../device.ts";

/**
 * The HUD's layout variants: small screens, tablets held sideways and iOS browsers get their own
 * classes and offsets (game.css), following the screen as it resizes.
 */

/** the small layout (phones, small windows) */
export const small = () => layout.small;

/** a tablet held sideways */
export const tabletLandscape = () => device.tablet && layout.landscape;

/** the tablet class of an element, `<cls>-tablet-ipad-browser` on iPads */
export const tabletClass = (cls: string, ipad = false) =>
    tabletLandscape() ? (ipad && device.os == "ios" ? `${cls}-tablet-ipad-browser` : `${cls}-tablet`) : undefined;

const standalone = !!window.navigator.standalone;

/** #ui-game in iOS browsers: shorter, above the browser's bottom bar (and around the notch) */
export function iosGameStyle() {
    if (device.os != "ios") return {};
    if (device.model == "iphonex") {
        return layout.landscape
            ? { height: "99%", top: "0px", left: "50%", transform: "translateX(-50%)", width: "93%" }
            : { height: "90%", top: "32px" };
    }
    if (standalone && !device.tablet) return { height: "95%" };
    return { height: device.tablet ? "100%" : layout.landscape ? "86%" : "82%" };
}

/** the top HUD rows clear the iOS browser's address bar */
export const iosBrowserTop = device.os == "ios" && device.model != "iphonex" && !(standalone && !device.tablet)
    ? { "margin-top": "6px" }
    : undefined;
