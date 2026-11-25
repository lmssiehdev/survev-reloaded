import type { JSX } from "@solidjs/web";
import { Dialog, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog";
import type { MenuModal } from "../menuModal.ts";

/**
 * A MenuModal's `.modal` element as a ui-sdk Dialog: it opens in the top layer, traps focus and
 * makes the page behind it inert, and Escape closes it. The element covers the screen, so a press
 * on it outside its `.modal-content` is a press on the backdrop, which closes it too. Both only
 * while the modal is dismissible (not opened with show(true)).
 */
export function ModalDialog(props: {
    modal: MenuModal;
    id: string;
    class?: string;
    style?: JSX.CSSProperties;
    /** names the dialog when it has no ModalTitle */
    label?: string;
    /** whether Escape may close it right now */
    escapable?: () => boolean;
    onContextMenu?: (e: MouseEvent) => void;
    children: JSX.Element;
}) {
    props.modal.dialog = true;
    const dismissible = () => props.modal.dismissible() && (props.escapable?.() ?? true);
    return (
        <Dialog
            open={props.modal.isOpen()}
            dismissible={dismissible()}
            closeOnOutsidePress={false}
            onOpenChange={(open) => {
                if (!open) props.modal.hide();
            }}
        >
            <DialogContent
                keepMounted
                id={props.id}
                class={["modal", props.class, props.modal.classes()]}
                style={props.style}
                aria-label={props.label}
                ref={(el: HTMLElement) => props.modal.attach(el)}
                onContextMenu={props.onContextMenu}
                onClick={(e: MouseEvent) => {
                    if (e.target === e.currentTarget && props.modal.dismissible()) props.modal.hide(e);
                }}
            >
                {props.children}
            </DialogContent>
        </Dialog>
    );
}

/** a modal's heading, which names its dialog */
export function ModalTitle(props: { id?: string; children: JSX.Element }) {
    return <DialogTitle id={props.id}>{props.children}</DialogTitle>;
}

/**
 * The `.modal` shell from index.html. Open/close state and the click-outside rule live in the
 * MenuModal passed in; game code calls modal.show() / modal.hide().
 */
export function Modal(props: {
    modal: MenuModal;
    id: string;
    title: JSX.Element;
    /** the header's close button, `close-corner` (an X) by default */
    closeClass?: string;
    bodyId?: string;
    children: JSX.Element;
    footer?: JSX.Element;
}) {
    return (
        <ModalDialog modal={props.modal} id={props.id}>
            <div class="modal-content modal-close">
                <div class="modal-header">
                    <span class={`close ${props.closeClass ?? "close-corner"}`} onClick={(e) => props.modal.hide(e)} />
                    <ModalTitle>{props.title}</ModalTitle>
                </div>
                <div id={props.bodyId} class="modal-body">{props.children}</div>
                {props.footer}
            </div>
        </ModalDialog>
    );
}

/** the round footer with an OK button that closes the modal */
export function OkFooter(props: { modal: MenuModal; okId?: string; onOk?: () => void }) {
    return (
        <div class="modal-footer modal-footer-round">
            <h3
                id={props.okId}
                class="close close-footer"
                onClick={(e) => {
                    props.onOk?.();
                    props.modal.hide(e);
                }}
            >
                OK
            </h3>
        </div>
    );
}
