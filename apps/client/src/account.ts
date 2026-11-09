import type { PassState, QuestState } from "@survev/shared/types/user.ts";
import type { Item, ItemStatus } from "@survev/shared/utils/loadout.ts";
import { type Loadout, loadout as loadouts } from "@survev/shared/utils/loadout.ts";
import { util } from "@survev/shared/utils/util.ts";
import { createStore } from "solid-js";
import { api } from "./api.ts";
import { authClient } from "./authClient.ts";
import type { ConfigManager } from "./config.ts";

import { type Treaty, treaty } from "@elysia/eden";
import type { UserRouterApp } from "@survev/api/types";

type UserRouter = ReturnType<typeof treaty<UserRouterApp>>["api"]["user"];
type UserRoute = Exclude<keyof UserRouter, "~path">;

type AccountEventMap = {
    login: (account: Account) => void;
    loadout: (loadout: Loadout) => void;
    items: (items: Item[]) => void;
    error: (error: string, reason?: string) => void;
    pass: (pass: PassState, quests: QuestState[], resetRefresh: boolean) => void;
};

/** unknown: before site_info says whether there is a login to ask about */
export type AccountStatus = "unknown" | "loggingIn" | "loggedIn" | "loggedOut";

/** what views show of the account; Account writes it whenever it changes */
export const [accountView, setAccountView] = createStore({
    status: "unknown" as AccountStatus,
    /** account requests in flight */
    requests: 0,
    username: "",
    /** seconds until the name can change again; 0 when it can */
    usernameChangeTime: 0,
    playerIcon: "",
    /** some items are new or unconfirmed */
    itemAlert: false,
});

export class Account {
    events: Record<string, Array<(...args: any[]) => void>> = {};
    requestsInFlight = 0;
    /** site_info said whether to ask for the profile */
    loginChecked = false;
    /** resolves the `settled()` promises once no request is in flight */
    private onSettled: Array<() => void> = [];
    loggingIn = false;
    loggedIn = false;
    profile = {
        linked: false,
        usernameSet: false,
        username: "",
        slug: "",
        usernameChangeTime: 0,
    };

    loadout = loadouts.defaultLoadout();
    items: Item[] = [];
    quests: QuestState[] = [];
    pass = {} as PassState;

    router: UserRouter;

    constructor(public config: ConfigManager) {
        // keepDomain: the url is relative when the API is on the same host
        this.router = treaty<UserRouterApp>(api.resolveUrl(""), {
            keepDomain: true,
            // a fetcher, not fetch: { credentials }: api.credentials() changes once site_info loads
            fetcher: ((input: RequestInfo | URL, init?: RequestInit) =>
                fetch(input, { ...init, credentials: api.credentials() })) as typeof fetch,
        }).api.user;
    }

    async fetchApi<Path extends UserRoute>(
        path: Path,
        body: Parameters<UserRouter[Path]["post"]>[0],
        cb: (
            error: null | any,
            res: Treaty.Data<UserRouter[Path]["post"]>,
        ) => void,
    ): Promise<void> {
        this.requestsInFlight++;
        this.publish();

        try {
            const { data, error, response } = await this.router[path].post(body as any);
            // no response: the request failed, error.value is what fetch threw
            if (!response) throw error?.value;
            // the API's error body ({ error, message }); other non 2xx bodies like { result: "invalid" } are answers
            const value = (error ? error.value : data) as any;
            if (error && value && "error" in value && "message" in value) throw new Error(`${path}: ${value.message}`);
            cb(null, value);
        } catch (err) {
            cb(err, {} as any);
        }

        this.requestsInFlight--;
        this.publish();
        if (this.requestsInFlight == 0) {
            for (const resolve of this.onSettled.splice(0)) resolve();
        }
    }

    /** once no account request is in flight */
    settled() {
        if (this.requestsInFlight == 0) return Promise.resolve();
        return new Promise<void>((resolve) => this.onSettled.push(resolve));
    }

    /** copies what the views show into accountView */
    publish() {
        const status: AccountStatus = this.loggingIn
            ? "loggingIn"
            : this.loggedIn
            ? "loggedIn"
            : this.loginChecked
            ? "loggedOut"
            : "unknown";
        setAccountView((v) => {
            v.status = status;
            v.requests = this.requestsInFlight;
            v.username = this.profile.username || "";
            v.usernameChangeTime = this.profile.usernameChangeTime;
            v.playerIcon = this.loadout.player_icon;
            v.itemAlert = this.items.some((item) => item.status! < loadouts.ItemStatus.Ackd);
        });
    }

    addEventListener<E extends keyof AccountEventMap>(
        event: E,
        callback: AccountEventMap[E],
    ) {
        this.events[event] = this.events[event] || [];
        this.events[event].push(callback);
    }

    removeEventListener<E extends keyof AccountEventMap>(
        event: E,
        callback: AccountEventMap[E],
    ) {
        const listeners = this.events[event] || [];
        for (let i = listeners.length - 1; i >= 0; i--) {
            if (listeners[i] == callback) {
                listeners.splice(i, 1);
            }
        }
    }

    emit<E extends keyof AccountEventMap>(event: E, ...args: Parameters<AccountEventMap[E]>): void {
        this.publish();
        const listenersCopy = (this.events[event] || []).slice(0);
        for (let i = 0; i < listenersCopy.length; i++) {
            listenersCopy[i](...args);
        }
    }

    init() {
        // logged out players use their local loadout until the profile says otherwise
        const storedLoadout = this.config.get("loadout")!;
        this.loadout = util.mergeDeep<Loadout>({}, loadouts.defaultLoadout(), storedLoadout);
        this.emit("loadout", this.loadout);
    }

    /** once site_info says which logins the API has */
    initLogin() {
        this.loginChecked = true;
        // the session cookie is httpOnly, so asking for the profile is how we learn if we're logged in
        if (api.anyLoginSupported()) {
            this.loadProfile();
            return;
        }

        this.emit("items", []);
    }

    logout() {
        this.config.set("profile", null);
        this.config.set("loadout", loadouts.defaultLoadout());
        authClient.signOut().finally(() => {
            window.location.reload();
        });
    }

    loadProfile() {
        this.loggingIn = !this.loggedIn;
        this.publish();
        this.fetchApi("profile", {}, (err, data) => {
            const wasLogginIn = this.loggingIn;
            this.loggingIn = false;
            this.loggedIn = false;
            this.profile = {} as this["profile"];
            this.items = [];
            if (err) {
                // leave the profile logged out
            } else if (data.banned) {
                this.emit("error", "account_banned", data.reason);
            } else if (data.success) {
                this.loggedIn = true;
                this.profile = data.profile;
                this.items = data.items;
                this.loadout = data.loadout;
                const profile = this.config.get("profile") || { slug: "" };
                profile.slug = data.profile.slug;
                this.config.set("profile", profile);
            }
            if (wasLogginIn && this.loggedIn) {
                this.emit("login", this);
                this.getPass(true);
            }
            this.emit("items", this.items);
            this.emit("loadout", this.loadout);
        });
    }

    resetStats() {
        this.fetchApi("reset_stats", {}, (err) => {
            if (err) {
                this.emit("error", "server_error");
            }
        });
    }

    deleteAccount() {
        this.fetchApi("delete", {}, (err) => {
            if (err) {
                this.emit("error", "server_error");
                return;
            }
            this.config.set("profile", null);
            window.location.reload();
        });
    }

    setUsername(username: string, callback: (err?: string) => void) {
        this.fetchApi("username", { username }, (err, res) => {
            if (err) {
                callback(err);
                return;
            }
            if (res.result == "success") {
                this.loadProfile();
                callback();
            } else {
                callback(res.result);
            }
        });
    }

    setLoadout(loadout: Loadout) {
        // Preemptively set the new loadout and revert if the call fail
        const loadoutPrev = this.loadout;
        this.loadout = loadout;
        this.emit("loadout", this.loadout);
        this.config.set("loadout", loadout);

        if (!this.loggedIn) return;

        this.fetchApi("loadout", { loadout }, (err, res) => {
            if (err) {
                this.emit("error", "server_error");
            }
            if (err || !res.loadout) {
                this.loadout = loadoutPrev;
            } else {
                this.loadout = res.loadout;
            }
            this.emit("loadout", this.loadout);
        });
    }

    setItemStatus(status: ItemStatus, itemTypes: string[]) {
        if (itemTypes.length != 0) {
            // Preemptively mark the item status as modified on our local copy
            for (let i = 0; i < itemTypes.length; i++) {
                const item = this.items.find((x) => {
                    return x.type == itemTypes[i];
                });
                if (item) {
                    item.status = Math.max(item.status!, status);
                }
            }

            this.emit("items", this.items);
            this.fetchApi("set_item_status", {
                status,
                itemTypes,
            }, () => {});
        }
    }

    getPass(tryRefreshQuests: boolean) {
        this.fetchApi("get_pass", { tryRefreshQuests }, (err, res) => {
            this.pass = {} as PassState;
            this.quests = [];
            if (err || !res.success) {
                // no pass available, keep the empty state
            } else {
                this.pass = res.pass || {} as PassState;
                this.quests = res.quests || [];
                this.quests.sort((a, b) => {
                    return a.idx - b.idx;
                });
                this.emit("pass", this.pass, this.quests, true);
                if (this.pass?.newItems) {
                    this.loadProfile();
                }
            }
        });
    }

    setPassUnlock(unlockType: string) {
        this.fetchApi("set_pass_unlock", { unlockType }, (err, res) => {
            if (err || !res.success) {
                // unlock failed, nothing to refresh
            } else {
                this.getPass(false);
            }
        });
    }

    refreshQuest(idx: number) {
        this.fetchApi("refresh_quest", { idx }, (err, res) => {
            if (err) {
                return;
            }
            if (res.success) {
                this.getPass(false);
            } else {
                // Give the pass UI a chance to update quests
                this.emit("pass", this.pass!, this.quests, false);
            }
        });
    }
}
