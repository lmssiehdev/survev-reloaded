/// <reference types="vite/client" />
/// <reference types="turnstile-types" />

declare global {
    interface Navigator {
        standalone?: boolean;
        userLanguage: string;
    }

    interface JQuery<TElement = HTMLElement> extends Iterable<TElement> {
        html(
            htmlString_function:
                | number /** Allow for number values to be passed */
                | JQuery.htmlString
                | JQuery.Node
                | ((
                    this: TElement,
                    index: number,
                    oldhtml: JQuery.htmlString,
                ) => JQuery.htmlString | JQuery.Node),
        ): this;
    }

    interface Window {
        mobile?: boolean;
        webkitAudioContext?: AudioContext;
        CP: any;
    }

    interface Document {
        mozFullScreenElement?: Element | null;
        webkitFullscreenElement?: Element | null;
        msFullscreenElement?: Element | null;
        msExitFullscreen: (options?: FullscreenOptions) => Promise<void>;
        mozCancelFullScreen: (options?: FullscreenOptions) => Promise<void>;
        webkitExitFullscreen: (options?: FullscreenOptions) => Promise<void>;
    }
    interface Element {
        msRequestFullscreen: (options?: FullscreenOptions) => Promise<void>;
        mozRequestFullScreen: (options?: FullscreenOptions) => Promise<void>;
        webkitRequestFullscreen: (options?: FullscreenOptions) => Promise<void>;
    }
    const IS_DEV: boolean;

    const GIT_VERSION: string | undefined;
}

declare module "pixi.js-legacy" {
    interface DisplayObject {
        __zOrd: number;
        __zIdx: number;
        __layerIdx: number;
    }
}
export {};
