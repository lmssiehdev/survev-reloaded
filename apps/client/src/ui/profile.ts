import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { createSignal, createStore } from "solid-js";
import type { MessageKey } from "./i18n.ts";
import { MenuModal } from "./menuModal.ts";
import type { ProfileUi } from "./profileUi.ts";

/** what the account views (components/Account.tsx) show; ProfileUi writes it */
export const [profile, setProfile] = createStore({
    /** the API has at least one login method */
    loginSupported: false,
    logins: { discord: false, mock: false } as SiteInfoRes["logins"],
    loggedIn: false,
    loggingIn: false,
    /** an account request is in flight */
    loading: false,
    username: "",
    /** seconds until the name can change again; 0 when it can */
    usernameChangeTime: 0,
    /** player icon background */
    avatar: "img/gui/player-gui.svg",
    /** some items are new or unconfirmed */
    itemAlert: false,
    nameModalTitle: "index-create-account" as MessageKey,
    /** the login options explain that logging in links the account */
    loginLink: false,
});

/** set once Application has created it */
export const [profileUi, setProfileUi] = createSignal<ProfileUi | null>(null);

function dropdown() {
    const modal = new MenuModal();
    modal.checkSelector = false;
    modal.skipFade = true;
    return modal;
}

export const setNameModal = new MenuModal();
export const resetStatsModal = new MenuModal();
export const deleteAccountModal = new MenuModal();
/** "log in to access this feature" */
export const createAccountModal = new MenuModal();
/** the phone layout's account menu */
export const mobileAccountModal = new MenuModal();
/** the logged-in account menu under the name (desktop and mobile) */
export const userSettingsModal = dropdown();
/** the login buttons under the name */
export const loginOptionsModal = dropdown();
export const loginOptionsModalMobile = dropdown();
