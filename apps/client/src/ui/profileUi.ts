import loadout, { type Item } from "@survev/shared/utils/loadout.ts";
import type { Account } from "../account.ts";
import { api } from "../api.ts";
import { signInWithDiscord } from "../authClient.ts";
import { device } from "../device.ts";
import { helpers } from "../helpers.ts";
import { showNotification } from "./appModals.ts";
import type { LoadoutMenu } from "./loadoutMenu.ts";
import {
    createAccountModal,
    loginOptionsModal,
    loginOptionsModalMobile,
    mobileAccountModal,
    setNameModal,
    setProfile,
    setProfileUi,
    userSettingsModal,
} from "./profile.ts";

const usernameErrors: Record<string, string> = {
    failed: "Failed setting username.",
    invalid: "Invalid username.",
    taken: "Name already taken!",
    change_time_not_expired: "Username has already been set recently.",
};

/** keeps the account views' store (./profile.ts) in sync with Account, and runs their actions */
export class ProfileUi {
    constructor(
        public account: Account,
        public loadoutMenu: LoadoutMenu,
    ) {
        account.addEventListener("error", this.onError.bind(this));
        account.addEventListener("login", this.onLogin.bind(this));
        account.addEventListener("loadout", this.sync.bind(this));
        account.addEventListener("items", this.onItemsUpdated.bind(this));
        account.addEventListener("request", this.sync.bind(this));

        createAccountModal.onHide(() => this.loadoutMenu.hide());

        setProfileUi(this);
        this.updateLoginSupport();
        this.sync();
    }

    /** again once site_info says which logins the API has */
    updateLoginSupport() {
        setProfile((p) => {
            p.loginSupported = api.anyLoginSupported();
            p.logins.discord = api.loginSupported("discord");
            p.logins.mock = api.loginSupported("mock");
        });
    }

    sync() {
        const account = this.account;
        setProfile((p) => {
            p.loading = account.requestsInFlight > 0;
            p.loggedIn = account.loggedIn;
            p.loggingIn = account.loggingIn;
            p.username = account.profile.username || "";
            p.usernameChangeTime = account.profile.usernameChangeTime;
            p.avatar = helpers.getSvgFromGameType(account.loadout.player_icon) || "img/gui/player-gui.svg";
        });
    }

    onError(type: string, data?: string) {
        const typeText = {
            server_error: "Operation failed, please try again later.",
            facebook_account_in_use: "Failed linking Facebook account.\nAccount already in use!",
            twitch_account_in_use: "Failed linking Twitch account.\nAccount already in use!",
            discord_account_in_use: "Failed linking Discord account.\nAccount already in use!",
            account_banned: `Account banned: ${data}`,
            login_failed: "Login failed.",
        };
        const text = typeText[type as keyof typeof typeText];
        if (text) showNotification(text);
    }

    onLogin() {
        createAccountModal.hide();
        loginOptionsModalMobile.hide();
        loginOptionsModal.hide();
        if (!this.account.profile.usernameSet) {
            setNameModal.show(true);
        }
    }

    onItemsUpdated(items: Item[]) {
        // new or unconfirmed items light up the loadout button
        const itemAlert = items.some((item) => item.status < loadout.ItemStatus.Ackd);
        setProfile((p) => {
            p.itemAlert = itemAlert;
        });
    }

    waitOnLogin(cb: () => void) {
        if (this.account.loggingIn && !this.account.loggedIn) {
            const runOnce = () => {
                cb();
                this.account.removeEventListener("requestsComplete", runOnce);
            };
            this.account.addEventListener("requestsComplete", runOnce);
        } else {
            cb();
        }
    }

    showLoginMenu(opts: { modal?: boolean; link?: boolean }) {
        setProfile((p) => {
            p.loginLink = !!opts.link;
        });
        const modal = opts.modal ? createAccountModal : device.mobile ? loginOptionsModalMobile : loginOptionsModal;
        modal.show();
    }

    login(method: "discord" | "mock") {
        if (method === "discord") {
            signInWithDiscord();
        } else {
            window.location.href = api.resolveUrl("/api/auth/mock");
        }
    }

    openLoadout() {
        this.loadoutMenu.show();
    }

    /** the player's stats page, or a prompt to log in / pick a name first */
    openMyStats() {
        this.waitOnLogin(() => {
            if (!this.account.loggedIn) {
                this.showLoginMenu({ modal: true });
            } else if (!this.account.profile.usernameSet) {
                setNameModal.show(true);
            } else {
                window.open(`/stats/?slug=${this.account.profile.slug || ""}`, "_blank");
            }
        });
    }

    /** clicking the name: the account menu when logged in, the login buttons when not */
    toggleAccountMenu() {
        if (userSettingsModal.isVisible() || loginOptionsModal.isVisible()) {
            userSettingsModal.hide();
            loginOptionsModal.hide();
            return;
        }
        this.waitOnLogin(() => {
            if (device.mobile) {
                mobileAccountModal.show();
            }
            if (this.account.loggedIn) {
                loginOptionsModal.hide();
                userSettingsModal.show();
            } else {
                this.showLoginMenu({ modal: false });
            }
        });
    }

    changeName() {
        if (this.account.profile.usernameChangeTime > 0) return;
        userSettingsModal.hide();
        mobileAccountModal.hide();
        setProfile((p) => {
            p.nameModalTitle = "index-change-account-name";
        });
        setNameModal.show();
    }

    /** `done` gets the message to show, or nothing when the name was set */
    setUsername(name: string, done: (warning?: string) => void) {
        this.account.setUsername(name, (error) => {
            done(error ? usernameErrors[error] || usernameErrors.failed : undefined);
        });
    }
}
