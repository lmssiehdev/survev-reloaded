import type { PassState, QuestState } from "@survev/shared/types/user.ts";
import type { Item, ItemStatus } from "@survev/shared/utils/loadout.ts";
import { type Loadout, loadout as loadouts } from "@survev/shared/utils/loadout.ts";
import { util } from "@survev/shared/utils/util.ts";
import { createSignal, createStore } from "solid-js";
import { api } from "./api.ts";
import { authClient } from "./authClient.ts";
import type { ConfigManager } from "./config.ts";
import { showNotification } from "./ui/appModals.ts";

import { type Treaty, treaty } from "@elysia/eden";
import type { UserRouterApp } from "@survev/api/types";

type UserRouter = ReturnType<typeof treaty<UserRouterApp>>["api"]["user"];
type UserRoute = Exclude<keyof UserRouter, "~path">;

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

/*
 * What game classes follow (ui/controller.ts `follow`). Account keeps the truth in its fields, since
 * a signal read returns the old value until the next flush; these get a new value on every change.
 */
export const [accountLoadout, setAccountLoadout] = createSignal<Loadout>(loadouts.defaultLoadout());
export const [accountItems, setAccountItems] = createSignal<Item[]>([]);
/** resetRefresh: the quests' refresh timers start over */
export const [accountPass, setAccountPass] = createSignal<
    null | { pass: PassState; quests: QuestState[]; resetRefresh: boolean }
>(null);

const serverError = "Operation failed, please try again later.";

export class Account {
    requestsInFlight = 0;
    status: AccountStatus = "unknown";

    get loggedIn() {
        return this.status == "loggedIn";
    }

    /** resolves the `settled()` promises once no request is in flight */
    private onSettled: Array<() => void> = [];
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
        setAccountView((v) => {
            v.status = this.status;
            v.requests = this.requestsInFlight;
            v.username = this.profile.username || "";
            v.usernameChangeTime = this.profile.usernameChangeTime;
            v.playerIcon = this.loadout.player_icon;
            v.itemAlert = this.items.some((item) => item.status! < loadouts.ItemStatus.Ackd);
        });
    }

    /** a new loadout, or the same one changed */
    private loadoutChanged() {
        setAccountLoadout({ ...this.loadout });
        this.publish();
    }

    /** the items, or one's status, changed */
    private itemsChanged() {
        setAccountItems([...this.items]);
        this.publish();
    }

    init() {
        // logged out players use their local loadout until the profile says otherwise
        const storedLoadout = this.config.get("loadout")!;
        this.loadout = util.mergeDeep<Loadout>({}, loadouts.defaultLoadout(), storedLoadout);
        this.loadoutChanged();
    }

    /** once site_info says which logins the API has */
    initLogin() {
        this.status = "loggedOut";
        // the session cookie is httpOnly, so asking for the profile is how we learn if we're logged in
        if (api.anyLoginSupported()) {
            this.loadProfile();
            return;
        }

        this.itemsChanged();
    }

    logout() {
        this.config.set("profile", null);
        this.config.set("loadout", loadouts.defaultLoadout());
        authClient.signOut().finally(() => {
            window.location.reload();
        });
    }

    loadProfile() {
        // a reload while logged in stays logged in until the answer
        if (!this.loggedIn) this.status = "loggingIn";
        this.publish();
        this.fetchApi("profile", {}, (err, data) => {
            const wasLoggingIn = this.status == "loggingIn";
            this.status = "loggedOut";
            this.profile = {} as this["profile"];
            this.items = [];
            if (err) {
                // leave the profile logged out
            } else if (data.banned) {
                showNotification(`Account banned: ${data.reason}`);
            } else if (data.success) {
                this.status = "loggedIn";
                this.profile = data.profile;
                this.items = data.items;
                this.loadout = data.loadout;
                const profile = this.config.get("profile") || { slug: "" };
                profile.slug = data.profile.slug;
                this.config.set("profile", profile);
            }
            if (wasLoggingIn && this.loggedIn) {
                this.getPass(true);
            }
            this.itemsChanged();
            this.loadoutChanged();
        });
    }

    resetStats() {
        this.fetchApi("reset_stats", {}, (err) => {
            if (err) {
                showNotification(serverError);
            }
        });
    }

    deleteAccount() {
        this.fetchApi("delete", {}, (err) => {
            if (err) {
                showNotification(serverError);
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
        this.loadoutChanged();
        this.config.set("loadout", loadout);

        if (!this.loggedIn) return;

        this.fetchApi("loadout", { loadout }, (err, res) => {
            if (err) {
                showNotification(serverError);
            }
            if (err || !res.loadout) {
                this.loadout = loadoutPrev;
            } else {
                this.loadout = res.loadout;
            }
            this.loadoutChanged();
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

            this.itemsChanged();
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
                setAccountPass({ pass: this.pass, quests: this.quests, resetRefresh: true });
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
                setAccountPass({ pass: this.pass, quests: this.quests, resetRefresh: false });
            }
        });
    }
}
