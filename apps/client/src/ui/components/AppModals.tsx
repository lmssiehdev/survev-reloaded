import { render } from "@solidjs/web";
import { For } from "solid-js";
import { appModals, ipBanModal, notificationModal, refreshModal } from "../appModals.ts";
import { t } from "../i18n.ts";
import { CreateAccountModal } from "./Account.tsx";
import { HamburgerModal } from "./HamburgerModal.tsx";
import { KeybindModal } from "./Keybinds.tsx";
import { Modal, OkFooter } from "./Modal.tsx";
import { SettingsModal } from "./SettingsModal.tsx";

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
            <KeybindModal />
            <SettingsModal />
            <HamburgerModal />
            <Modal
                modal={notificationModal}
                id="modal-notification"
                title="Alert"
                footer={<OkFooter modal={notificationModal} />}
            >
                <p class="modal-body-text">
                    <Lines text={appModals.notification} />
                </p>
            </Modal>
            <Modal
                modal={refreshModal}
                id="modal-refresh"
                title="New Update"
                footer={
                    <OkFooter
                        modal={refreshModal}
                        okId="force-refresh"
                        onOk={() => (window.location.href = `/?t=${Date.now()}`)}
                    />
                }
            >
                <p class="modal-body-text">
                    A new version of survev.io is available!<br />
                    <br />Press "OK" below to reload the page.
                </p>
            </Modal>
            <Modal
                modal={ipBanModal}
                id="modal-ip-banned"
                title={t("index-ip-banned")}
                footer={<OkFooter modal={ipBanModal} />}
            >
                <div id="modal-ip-banned-reason">{appModals.ipBanReason}</div>
                <div id="modal-ip-banned-expiration">{appModals.ipBanExpiration}</div>
            </Modal>
            <CreateAccountModal />
        </>
    );
}

/** the start menu's modals; fills the #app-modals mount point in index.html */
export function mountAppModals() {
    render(() => <AppModals />, document.getElementById("app-modals")!);
}
