import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { accountView } from "../../account.ts";
import { helpers } from "../../helpers.ts";
import { keybindModal, settingsModal } from "../appModals.ts";
import { t } from "../i18n.ts";
import type { MenuModal } from "../menuModal.ts";
import {
    createAccountModal,
    deleteAccountModal,
    loginOptionsModal,
    loginOptionsModalMobile,
    mobileAccountModal,
    profile,
    profileUi,
    resetStatsModal,
    setNameModal,
    userSettingsModal,
} from "../profile.ts";

/** the account modals' header X and body/footer layout (`.modal-account`) */
function AccountModal(props: {
    modal: MenuModal;
    id: string;
    /** suffix of the modal-header-/modal-body-/modal-footer- classes */
    layout: "name" | "reset-stats" | "delete";
    title: JSX.Element;
    titleId?: string;
    closeClass?: string;
    children: JSX.Element;
    footer: JSX.Element;
}) {
    return (
        <div
            id={props.id}
            class={["modal modal-account", props.modal.classes()]}
            ref={(el) => props.modal.attach(el)}
        >
            <div class="modal-content modal-close">
                <div class={`modal-header modal-header-${props.layout}`}>
                    <span
                        class={["close close-corner", props.closeClass]}
                        onClick={(e) => props.modal.hide(e)}
                    />
                    <h2 id={props.titleId}>{props.title}</h2>
                </div>
                <div class={`modal-body modal-body-${props.layout}`}>{props.children}</div>
                <div class={`modal-footer modal-footer-${props.layout} modal-footer-round`}>{props.footer}</div>
            </div>
        </div>
    );
}

/** a text input that runs `onEnter` on Enter */
function AccountInput(props: {
    id: string;
    value: string;
    onInput: (value: string) => void;
    onEnter: () => void;
    placeholder?: string;
}) {
    return (
        <input
            type="text"
            class="menu-option player-name-input"
            tabindex="0"
            placeholder={props.placeholder ?? ""}
            id={props.id}
            maxlength="16"
            value={props.value}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            onKeyPress={(e) => {
                if (e.key === "Enter") props.onEnter();
            }}
        />
    );
}

const [nameInput, setNameInput] = createSignal("");
const [nameWarning, setNameWarning] = createSignal("");
const clearNameForm = () => {
    setNameInput("");
    setNameWarning("");
};
setNameModal.onShow(clearNameForm);
setNameModal.onHide(clearNameForm);

export function SetNameModal() {
    const finish = () =>
        profileUi()?.setUsername(nameInput(), (warning) => {
            if (warning) setNameWarning(warning);
            else setNameModal.hide();
        });
    return (
        <AccountModal
            modal={setNameModal}
            id="modal-account-name-change"
            layout="name"
            title={t(profile.nameModalTitle)}
            titleId="modal-account-name-title"
            footer={
                <h3
                    id="modal-account-name-finish"
                    class="finish"
                    onClick={(e) => {
                        e.stopPropagation();
                        finish();
                    }}
                >
                    {t("index-finish")}
                </h3>
            }
        >
            <div class="modal-settings-item">
                <p id="modal-account-name-desc" class="modal-body-text">{t("index-set-account-name")}</p>
                <div id="modal-body-warning" style={{ display: nameWarning() ? "block" : "none" }}>
                    {nameWarning()}
                </div>
                <AccountInput
                    id="modal-account-name-input"
                    placeholder={t("index-enter-name")}
                    value={nameInput()}
                    onInput={setNameInput}
                    onEnter={finish}
                />
            </div>
        </AccountModal>
    );
}

const [resetInput, setResetInput] = createSignal("");
resetStatsModal.onShow(() => {
    setResetInput("");
    mobileAccountModal.hide();
});

export function ResetStatsModal() {
    const confirm = () => {
        if (resetInput() === "RESET STATS") {
            profileUi()?.account.resetStats();
            resetStatsModal.hide();
        }
    };
    return (
        <AccountModal
            modal={resetStatsModal}
            id="modal-account-reset-stats"
            layout="reset-stats"
            title={t("index-reset-stats")}
            footer={
                <h3
                    id="modal-account-reset-stats-finish"
                    class="finish"
                    onClick={(e) => {
                        e.stopPropagation();
                        confirm();
                    }}
                >
                    {t("index-confirm")}
                </h3>
            }
        >
            <div class="modal-settings-item">
                <p id="modal-account-reset-stats-desc" class="modal-body-text">{t("index-reset-stats-desc")}</p>
                <p id="modal-account-reset-stats-desc-2" class="modal-body-text">{t("index-reset-stats-desc-2")}</p>
                <AccountInput
                    id="modal-account-reset-stats-input"
                    value={resetInput()}
                    onInput={setResetInput}
                    onEnter={confirm}
                />
            </div>
        </AccountModal>
    );
}

const [deleteInput, setDeleteInput] = createSignal("");
deleteAccountModal.onShow(() => {
    setDeleteInput("");
    mobileAccountModal.hide();
});

export function DeleteAccountModal() {
    const confirm = () => {
        if (deleteInput() === "DELETE") {
            profileUi()?.account.deleteAccount();
            deleteAccountModal.hide();
        }
    };
    return (
        <AccountModal
            modal={deleteAccountModal}
            id="modal-account-delete"
            layout="delete"
            title={t("index-delete-account")}
            footer={
                <h3
                    id="modal-account-delete-finish"
                    class="finish"
                    onClick={(e) => {
                        e.stopPropagation();
                        confirm();
                    }}
                >
                    {t("index-confirm")}
                </h3>
            }
        >
            <div class="modal-settings-item">
                <p id="modal-account-delete-desc" class="modal-body-text">{t("index-delete-account-desc")}</p>
                <AccountInput
                    id="modal-account-delete-input"
                    value={deleteInput()}
                    onInput={setDeleteInput}
                    onEnter={confirm}
                />
            </div>
        </AccountModal>
    );
}

/** the login buttons; above them, a note when logging in links the account */
function LoginOptions() {
    const option = (method: "discord" | "mock") => (
        <div
            class={`menu-option btn-darken btn-standard btn-login-${method}`}
            onClick={() => profileUi()?.login(method)}
        >
            <span class="login-button-name">
                <span>{t(`index-${method}`)}</span>
                <div class="icon"></div>
            </span>
        </div>
    );
    return (
        <div class="login-options-content">
            <Show when={profile.loginLink}>
                <div class="account-login-desc">
                    <p>{t("index-link-account-to")}</p>
                </div>
            </Show>
            <div class="account-buttons">
                <Show when={profile.logins.discord}>{option("discord")}</Show>
                <Show when={profile.logins.mock}>{option("mock")}</Show>
            </div>
        </div>
    );
}

/** the account actions shown under the name (desktop) and in the phone menu */
function AccountSettings(props: { class?: string; myStats?: boolean }) {
    const action = (fn: () => void) => (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
    };
    return (
        <div
            class={[
                "account-buttons-settings account-buttons-wrapper account-block-arrow modal-close",
                props.class,
                userSettingsModal.classes(),
            ]}
            ref={(el) => userSettingsModal.attach(el)}
        >
            <div class="account-buttons">
                <Show when={props.myStats}>
                    <div
                        class="account-stats-link btn-player-stats-link menu-option btn-darken btn-standard"
                        onClick={action(() => profileUi()?.openMyStats())}
                    >
                        {t("index-my-stats")}
                    </div>
                </Show>
                <div
                    class={[
                        "btn-account-change-name btn-account-turq menu-option btn-darken btn-standard",
                        { "btn-account-disabled": accountView.usernameChangeTime > 0 },
                    ]}
                    onClick={action(() => profileUi()?.changeName())}
                >
                    {t("index-change-account-name")}
                </div>
                <div
                    class="btn-account-reset-stats btn-account-turq menu-option btn-darken btn-standard"
                    onClick={action(() => {
                        userSettingsModal.hide();
                        resetStatsModal.show();
                    })}
                >
                    {t("index-reset-stats")}
                </div>
                <div
                    class="btn-account-delete btn-account-turq menu-option btn-darken btn-standard"
                    onClick={action(() => {
                        userSettingsModal.hide();
                        deleteAccountModal.show();
                    })}
                >
                    {t("index-delete-account")}
                </div>
                <div
                    class="btn-account-logout btn-account-grey menu-option btn-darken btn-standard"
                    onClick={action(() => profileUi()?.account.logout())}
                >
                    {t("index-log-out")}
                </div>
            </div>
        </div>
    );
}

mobileAccountModal.onHide(() => userSettingsModal.hide());

export function MobileAccountModal() {
    return (
        <div
            id="modal-mobile-account"
            class={["modal", mobileAccountModal.classes()]}
            ref={(el) => mobileAccountModal.attach(el)}
        >
            <div class="modal-content modal-close">
                <div class="modal-header">
                    <span class="close close-corner" onClick={(e) => mobileAccountModal.hide(e)} />
                    <h2>{t("index-account")}</h2>
                </div>
                <div id="modal-mobile-account-body">
                    <AccountSettings myStats />
                    <div
                        id="account-login-options-mobile"
                        class={[
                            "account-buttons-link-account account-buttons-wrapper account-block-arrow modal-close",
                            loginOptionsModalMobile.classes(),
                        ]}
                        ref={(el) => loginOptionsModalMobile.attach(el)}
                    >
                        <LoginOptions />
                    </div>
                </div>
            </div>
        </div>
    );
}

/** the top-right corner of the start menu: loadout/stats/leaderboard, the name, its menus */
/** the player icon, or the default silhouette */
const avatar = () => helpers.getSvgFromGameType(accountView.playerIcon) || "img/gui/player-gui.svg";

export function StartTopRight() {
    // the row above the name hides while a menu under the name is open
    const menuOpen = () =>
        userSettingsModal.isOpen() || loginOptionsModal.isOpen() || loginOptionsModalMobile.isOpen()
        || mobileAccountModal.isOpen();
    const link = (fn: () => void) => (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
    };
    return (
        <div
            id="start-top-right"
            class={["fade", {
                faded: mobileAccountModal.isOpen() || settingsModal.isOpen() || keybindModal.isOpen(),
            }]}
        >
            <div class="account-block" style={{ display: profile.loginSupported ? "block" : "none" }}>
                <div class="account-details-top" style={{ display: menuOpen() ? "none" : "block" }}>
                    <div class="account-details-top-buttons">
                        <div class="account-details-button-wrapper account-details-button-loadout menu-option btn-darken-alt">
                            <div class="account-details-button">
                                <div
                                    id="loadout-alert-main"
                                    class="account-alert-main account-alert"
                                    style={{ display: accountView.itemAlert ? "block" : "none" }}
                                />
                                <div
                                    class="account-link account-loadout-link"
                                    onClick={link(() => profileUi()?.openLoadout())}
                                >
                                    <span>{t("index-loadout")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="account-details-button-wrapper account-details-link-out menu-option btn-darken hide-on-mobile">
                            <div class="account-details-button">
                                <div
                                    class="account-link account-stats-link"
                                    onClick={link(() => profileUi()?.openMyStats())}
                                >
                                    <span>{t("index-my-stats")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="account-details-button-wrapper account-details-link-out menu-option btn-darken hide-on-mobile">
                            <div class="account-details-button">
                                <div
                                    class="account-link account-leaderboard-link"
                                    onClick={link(() => window.open("/stats", "_blank"))}
                                >
                                    <span>{t("index-leaderboards")}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="account-overview">
                    <div
                        class="account-details-user account-details-block"
                        onClick={link(() => profileUi()?.toggleAccountMenu())}
                    >
                        <div class="account-details">
                            <div class="account-avatar" style={{ "background-image": `url(${avatar()})` }} />
                            <div
                                id="account-login"
                                class="account-player-name account-name account-name-user"
                                style={{ display: accountView.status == "loggedIn" ? "none" : "block" }}
                            >
                                {t("index-log-in-desc")}
                            </div>
                            <div
                                id="account-player-name"
                                class="account-player-name account-name account-name-user"
                                style={{ display: accountView.status == "loggedIn" ? "block" : "none" }}
                            >
                                {accountView.username}
                            </div>
                            <div class="account-loading-container">
                                <div class="account-loading" style={{ opacity: accountView.requests > 0 ? 1 : 0 }} />
                            </div>
                        </div>
                    </div>
                </div>
                <AccountSettings class="hide-on-mobile" />
                <div
                    id="account-login-options"
                    class={[
                        "account-buttons-link-account account-buttons-wrapper account-block-arrow modal-close",
                        loginOptionsModal.classes(),
                    ]}
                    ref={(el) => loginOptionsModal.attach(el)}
                >
                    <LoginOptions />
                </div>
            </div>
        </div>
    );
}

/** "Log in to access this feature!"; part of the start menu's modals (AppModals.tsx) */
export function CreateAccountModal() {
    return (
        <AccountModal
            modal={createAccountModal}
            id="modal-create-account"
            layout="name"
            title={t("index-log-in-desc")}
            closeClass="close-loadouts"
            footer={
                <h3 class="close close-footer" onClick={(e) => createAccountModal.hide(e)}>
                    {t("index-cancel")}
                </h3>
            }
        >
            <p class="modal-body-text">{t("index-create-account-prompt-1")}</p>
            <LoginOptions />
        </AccountModal>
    );
}
