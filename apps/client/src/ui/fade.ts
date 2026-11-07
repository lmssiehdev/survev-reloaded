import { createEffect } from "solid-js";

/** shows an element the way the stylesheet would, or with `fallback` if that hides it */
function show(el: HTMLElement, fallback: string) {
    el.style.display = "";
    if (getComputedStyle(el).display === "none") el.style.display = fallback;
}

/**
 * jQuery's fadeIn()/fadeOut() driven by a signal: `ref={fade(() => open())}`, called while the
 * component renders (it creates the effect there). The first value applies without animating;
 * later changes animate opacity over `ms`, then hidden elements get `display: none`. Shown
 * elements get their stylesheet display back.
 */
export function fade(visible: () => boolean, ms = 200, fallbackDisplay = "block") {
    let el: HTMLElement | undefined;
    let anim: Animation | undefined;
    let first = true;
    let latest: boolean | undefined;
    createEffect(visible, (isVisible) => {
        latest = isVisible;
        if (!el) return;
        anim?.cancel();
        anim = undefined;
        if (first) {
            first = false;
            if (!isVisible) el.style.display = "none";
            return;
        }
        const target = el;
        const from = target.style.display === "none" ? 0 : Number(getComputedStyle(target).opacity);
        show(target, fallbackDisplay);
        anim = target.animate([{ opacity: from }, { opacity: isVisible ? 1 : 0 }], {
            duration: ms,
            easing: "ease-in-out",
        });
        anim.onfinish = () => {
            anim = undefined;
            if (!isVisible) target.style.display = "none";
        };
    });
    return (node: HTMLElement) => {
        el = node;
        // the effect ran before the element existed: apply its value now
        if (latest !== undefined && first) {
            first = false;
            if (!latest) node.style.display = "none";
        }
    };
}
