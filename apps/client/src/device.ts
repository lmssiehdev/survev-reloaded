import { isMobile } from "pixi.js-legacy";
import { createStore } from "solid-js";

function detectMobile() {
    return isMobile.android.device || isMobile.apple.device || isIpad();
}

function isIpad() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes("ipad") || (ua.includes("macintosh") && "ontouchend" in document);
}

function detectiOS() {
    return isMobile.apple.phone || isMobile.apple.ipod;
}

function detectAndroid() {
    return isMobile.android.device;
}

function detectiPhoneX() {
    return (
        detectiOS()
        && ((screen.width == 375 && screen.height == 812)
            || (screen.height == 375 && screen.width == 812)
            || (screen.width == 414 && screen.height == 896)
            || (screen.height == 414 && screen.width == 896))
    );
}

function getOs() {
    if (detectiOS()) return "ios";
    if (detectAndroid()) return "android";
    return "pc";
}

class Device {
    readonly UiLayout = {
        Lg: 0,
        Sm: 1,
    };

    readonly os = getOs();
    readonly model = detectiPhoneX() ? "iphonex" : "unknown";

    readonly mobile = detectMobile();
    readonly tablet = isMobile.tablet || isIpad();
    readonly touch = this.mobile || this.tablet;

    uiLayout = this.mobile ? this.UiLayout.Sm : this.UiLayout.Lg;
    pixelRatio = window.devicePixelRatio;
    isLandscape = true;

    screenWidth = 0;
    screenHeight = 0;

    constructor() {
        this.onResize();
    }

    get small() {
        return this.uiLayout == this.UiLayout.Sm;
    }

    onResize() {
        this.screenWidth = window.innerWidth;
        this.screenHeight = window.innerHeight;

        this.isLandscape = window.innerWidth > window.innerHeight;

        const layoutDim = this.isLandscape ? this.screenWidth : this.screenHeight;
        this.uiLayout = this.mobile || layoutDim <= 850 || (layoutDim <= 900 && this.pixelRatio >= 3)
            ? this.UiLayout.Sm
            : this.UiLayout.Lg;
        setLayout((l) => {
            l.small = this.small;
            l.landscape = this.isLandscape;
            l.width = this.screenWidth;
            l.height = this.screenHeight;
        });
    }
}

/**
 * The screen as views see it: `device` written into a store on every resize. Game code reads
 * `device` itself.
 */
export const [layout, setLayout] = createStore({ small: false, landscape: true, width: 0, height: 0 });

export const device = new Device();
