import { createEffect } from "solid-js";

/** jQuery's fadeIn()/fadeOut()/show()/hide() without jQuery; one running fade per element */
const fades = new WeakMap<HTMLElement, { anim: Animation; hiding: boolean }>();

const isHidden = (el: HTMLElement) => getComputedStyle(el).display === "none";

/** jQuery's show(): the stylesheet's display, or a block if that hides it */
export function showElem(el: HTMLElement) {
    if (el.style.display === "none") el.style.display = "";
    if (isHidden(el)) el.style.display = "block";
}

/** stops a running fade where it is */
export function cancelFade(el: HTMLElement) {
    fades.get(el)?.anim.cancel();
    fades.delete(el);
}

export function fadeIn(el: HTMLElement | null | undefined, ms: number) {
    if (!el) return;
    const running = fades.get(el);
    if (!isHidden(el) && !running?.hiding) return;
    running?.anim.cancel();
    showElem(el);
    const anim = el.animate([{ opacity: 0 }, { opacity: getComputedStyle(el).opacity }], {
        duration: ms,
        // jQuery's default "swing"
        easing: "ease-in-out",
    });
    fades.set(el, { anim, hiding: false });
    anim.onfinish = () => fades.delete(el);
}

/** animates to transparent, then display: none */
export function fadeOut(el: HTMLElement | null | undefined, ms: number) {
    if (!el) return;
    const running = fades.get(el);
    if (isHidden(el) && !(running && !running.hiding)) return;
    running?.anim.cancel();
    const anim = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], {
        duration: ms,
        easing: "ease-in-out",
    });
    anim.onfinish = () => {
        el.style.display = "none";
        fades.delete(el);
    };
    fades.set(el, { anim, hiding: true });
}

/**
 * fadeIn/fadeOut driven by a signal: `ref={fade(() => open())}`, called while the component
 * renders (it creates the effect there). The first value applies without animating.
 */
export function fade(visible: () => boolean, ms = 200) {
    let el: HTMLElement | undefined;
    let latest: boolean | undefined;
    let applied = false;
    const apply = (node: HTMLElement, isVisible: boolean) => {
        if (!applied) {
            applied = true;
            if (!isVisible) node.style.display = "none";
        } else if (isVisible) {
            fadeIn(node, ms);
        } else {
            fadeOut(node, ms);
        }
    };
    createEffect(visible, (isVisible) => {
        latest = isVisible;
        if (el) apply(el, isVisible);
    });
    return (node: HTMLElement) => {
        el = node;
        // the effect ran before the element existed
        if (latest !== undefined && !applied) apply(node, latest);
    };
}
