import type { JSX } from "@solidjs/web";
import type { MenuModal } from "../menuModal.ts";

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
        <div id={props.id} class="modal" ref={(el) => props.modal.attach(el)}>
            <div class="modal-content modal-close">
                <div class="modal-header">
                    <span class={`close ${props.closeClass ?? "close-corner"}`} onClick={(e) => props.modal.hide(e)} />
                    <h2>{props.title}</h2>
                </div>
                <div id={props.bodyId} class="modal-body">{props.children}</div>
                {props.footer}
            </div>
        </div>
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
