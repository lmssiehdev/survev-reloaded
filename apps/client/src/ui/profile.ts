import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { createStore } from "solid-js";
import { controller } from "./controller.ts";
import type { MessageKey } from "./i18n.ts";
import { MenuModal } from "./menuModal.ts";
import type { ProfileUi } from "./profileUi.ts";

/** the account views' own state (components/Account.tsx); the account itself is accountView */
export const [profile, setProfile] = createStore({
    /** the API has at least one login method */
    loginSupported: false,
    logins: { discord: false, mock: false } as SiteInfoRes["logins"],
    nameModalTitle: "index-create-account" as MessageKey,
    /** the login options explain that logging in links the account */
    loginLink: false,
});

/** set once Application has created it */
export const [profileUi, setProfileUi] = controller<ProfileUi>();

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
