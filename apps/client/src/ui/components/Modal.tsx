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
    children: JSX.Element;
    /** id of the footer OK button */
    okId?: string;
    onOk?: () => void;
}) {
    const close = (e: MouseEvent) => props.modal.hide(e);
    return (
        <div id={props.id} class="modal" ref={(el) => props.modal.attach(el)}>
            <div class="modal-content modal-close">
                <div class="modal-header">
                    <span class="close close-corner" onClick={close} />
                    <h2>{props.title}</h2>
                </div>
                <div class="modal-body">{props.children}</div>
                <div class="modal-footer modal-footer-round">
                    <h3
                        id={props.okId}
                        class="close close-footer"
                        onClick={(e) => {
                            props.onOk?.();
                            close(e);
                        }}
                    >
                        OK
                    </h3>
                </div>
            </div>
        </div>
    );
}
