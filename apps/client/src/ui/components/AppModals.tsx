import { render } from "@solidjs/web";
import { For } from "solid-js";
import { appModals, ipBanModal, notificationModal, refreshModal } from "../appModals.ts";
import { t } from "../i18n.ts";
import { Modal } from "./Modal.tsx";

/** "\n" separated lines, without innerHTML */
function Lines(props: { text: string }) {
    return (
        <For each={props.text.split("\n")}>
            {(line, i) => (
                <>
                    {i() > 0 && <br />}
                    {line}
                </>
            )}
        </For>
    );
}

function AppModals() {
    return (
        <>
            <Modal modal={notificationModal} id="modal-notification" title="Alert">
                <p class="modal-body-text">
                    <Lines text={appModals.notification} />
                </p>
            </Modal>
            <Modal
                modal={refreshModal}
                id="modal-refresh"
                title="New Update"
                okId="force-refresh"
                onOk={() => (window.location.href = `/?t=${Date.now()}`)}
            >
                <p class="modal-body-text">
                    A new version of survev.io is available!<br />
                    <br />Press "OK" below to reload the page.
                </p>
            </Modal>
            <Modal modal={ipBanModal} id="modal-ip-banned" title={t("index-ip-banned")}>
                <div id="modal-ip-banned-reason">{appModals.ipBanReason}</div>
                <div id="modal-ip-banned-expiration">{appModals.ipBanExpiration}</div>
            </Modal>
        </>
    );
}

/** fills the #app-modals mount point in index.html */
export function mountAppModals() {
    render(() => <AppModals />, document.getElementById("app-modals")!);
}
