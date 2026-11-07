import { type Accessor, createSignal } from "solid-js";

const FADE_MS = 200;

/** jQuery's fadeOut(): animate to transparent, then display: none */
function fadeOut(el: HTMLElement) {
    const anim = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], {
        duration: FADE_MS,
        // jQuery's default "swing"
        easing: "ease-in-out",
    });
    anim.onfinish = () => {
        el.style.display = "none";
    };
    return anim;
}

/**
 * Open/close state for one modal and the "click outside closes it" rule.
 *
 * TSX modals render `<Modal modal={...}>` (components/Modal.tsx), which attaches its root.
 * Modals still in index.html pass their element(s) here and get the same display + fade.
 */
export class MenuModal {
    checkSelector = true;
    skipFade = false;
    onShowFn = function() {};
    onHideFn = function(_e?: Event) {};

    /** synchronous: true right after show() */
    visible = false;
    /** reactive, for views that change while the modal is open */
    readonly isOpen: Accessor<boolean>;
    private readonly setOpen: (open: boolean) => void;

    private elements: HTMLElement[] = [];
    private fades: Animation[] = [];

    constructor(elements: Iterable<HTMLElement> = []) {
        [this.isOpen, this.setOpen] = createSignal(false);
        this.elements = [...elements];
        for (const el of this.elements) {
            for (const close of el.querySelectorAll(".close")) {
                close.addEventListener("click", (e) => this.hide(e));
            }
        }
    }

    /** the modal's root element (`.modal`) */
    get element(): HTMLElement | undefined {
        return this.elements[0];
    }

    /** a TSX view calls this with its root element; a modal can drive several */
    attach(el: HTMLElement) {
        if (!this.elements.includes(el)) this.elements.push(el);
    }

    modalCloseListener = (e: Event) => {
        const target = e.target;
        if (
            target instanceof Element
            && !target.closest(".modal-close")
            && (this.elements.some((el) => el === target) || !this.checkSelector)
        ) {
            e.stopPropagation();
            this.hide();
        }
    };

    onShow(fn: () => void) {
        this.onShowFn = fn;
    }

    onHide(fn: (e?: Event) => void) {
        this.onHideFn = fn;
    }

    isVisible() {
        return this.visible;
    }

    /** `isModal`: clicking outside doesn't close it */
    show(isModal?: boolean) {
        if (this.visible) return;
        this.visible = true;
        this.setOpen(true);
        for (const fade of this.fades) fade.cancel();
        this.fades = [];
        for (const el of this.elements) el.style.display = "block";
        this.onShowFn();
        if (!isModal) {
            document.addEventListener("click", this.modalCloseListener);
            document.addEventListener("touchend", this.modalCloseListener);
        }
    }

    hide(e?: Event) {
        if (!this.visible) return;
        this.visible = false;
        this.setOpen(false);
        for (const el of this.elements) {
            if (this.skipFade) {
                el.style.display = "none";
            } else {
                this.fades.push(fadeOut(el));
            }
        }
        this.onHideFn(e);
        document.removeEventListener("click", this.modalCloseListener);
        document.removeEventListener("touchend", this.modalCloseListener);
    }
}
