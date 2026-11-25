import { type Accessor, createSignal } from "solid-js";

/**
 * Open/close state for one modal and the "click outside closes it" rule.
 *
 * Views give their element(s) `class={modal.classes()}` (shown while open, fading out once
 * closed: `.menu-modal` in app.css) and `ref={(el) => modal.attach(el)}` for the click rule.
 * A modal rendered by ModalDialog (components/Modal.tsx) is a ui-sdk Dialog instead, which
 * handles outside presses and Escape itself.
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
    /** false after show(true): an outside press or Escape doesn't close it */
    readonly dismissible: Accessor<boolean>;
    private readonly setDismissible: (dismissible: boolean) => void;
    /** rendered by ModalDialog, which closes it on outside presses and Escape */
    dialog = false;

    private elements: HTMLElement[] = [];

    constructor() {
        [this.isOpen, this.setOpen] = createSignal(false);
        [this.dismissible, this.setDismissible] = createSignal(true);
    }

    /** the classes that show the modal's elements */
    classes() {
        return { "menu-modal": true, closed: !this.isOpen(), "no-fade": this.skipFade };
    }

    /** the modal's root element (`.modal`) */
    get element(): HTMLElement | undefined {
        return this.elements[0];
    }

    /** a view calls this with its root element; a modal can drive several */
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
        this.setDismissible(!isModal);
        this.setOpen(true);
        this.onShowFn();
        if (!isModal && !this.dialog) {
            document.addEventListener("click", this.modalCloseListener);
            document.addEventListener("touchend", this.modalCloseListener);
        }
    }

    hide(e?: Event) {
        if (!this.visible) return;
        this.visible = false;
        this.setOpen(false);
        this.onHideFn(e);
        document.removeEventListener("click", this.modalCloseListener);
        document.removeEventListener("touchend", this.modalCloseListener);
    }
}
