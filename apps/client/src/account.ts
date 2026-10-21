import type { PassState, QuestState } from "@survev/shared/types/user.ts";
import type { Item, ItemStatus } from "@survev/shared/utils/loadout.ts";
import { type Loadout, loadout as loadouts } from "@survev/shared/utils/loadout.ts";
import { util } from "@survev/shared/utils/util.ts";
import { api } from "./api.ts";
import type { ConfigManager } from "./config.ts";
import { errorLogManager } from "./errorLogs.ts";
import { proxy } from "./proxy.ts";

import type { UserRouterApp } from "@survev/api/types";
import { hc, type InferResponseType } from "hono/client";

type UserRouter = ReturnType<typeof hc<UserRouterApp>>;

type AccountEventMap = {
    request: (account: Account) => void;
    requestsComplete: () => void;
    login: (account: Account) => void;
    loadout: (loadout: Loadout) => void;
    items: (items: Item[]) => void;
    error: (error: string, reason?: string) => void;
    pass: (pass: PassState, quests: QuestState[], resetRefresh: boolean) => void;
};

export class Account {
    events: Record<string, Array<(...args: any[]) => void>> = {};
    requestsInFlight = 0;
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
        this.router = hc<UserRouterApp>(api.resolveUrl("/api/user"), {
            init: {
                credentials: proxy.anyLoginSupported() ? "include" : "omit",
            },
        });
    }

    async fetchApi<Path extends keyof UserRouter>(
        path: Path,
        body: Parameters<UserRouter[Path]["$post"]>[0],
        cb: (
            error: null | any,
            res: InferResponseType<UserRouter[Path]["$post"], 200>,
        ) => void,
    ): Promise<void> {
        this.requestsInFlight++;
        this.emit("request", this);

        try {
            const res = await this.router[path].$post(body as any);
            const data: object = await res.json();
            // the API's error body ({ error, message }); other non 2xx bodies like { result: "invalid" } are answers
            if (!res.ok && "error" in data && "message" in data) throw new Error(`${path}: ${data.message}`);
            cb(null, data as any);
        } catch (err) {
            cb(err, {} as any);
        }

        this.requestsInFlight--;
        this.emit("request", this);
        if (this.requestsInFlight == 0) {
            this.emit("requestsComplete");
        }
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

        // the session cookie is httpOnly, so asking for the profile is how we learn if we're logged in
        if (proxy.anyLoginSupported()) {
            this.loadProfile();
            return;
        }

        this.emit("request", this);
        this.emit("items", []);
    }

    logout() {
        this.config.set("profile", null);
        this.config.set("loadout", loadouts.defaultLoadout());
        this.fetchApi("logout", {}, () => {
            window.location.reload();
        });
    }

    loadProfile() {
        this.loggingIn = !this.loggedIn;
        this.fetchApi("profile", {}, (err, data) => {
            const wasLogginIn = this.loggingIn;
            this.loggingIn = false;
            this.loggedIn = false;
            this.profile = {} as this["profile"];
            this.items = [];
            if (err) {
                errorLogManager.storeGeneric("account", "load_profile_error");
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
                errorLogManager.storeGeneric("account", "reset_stats_error");
                this.emit("error", "server_error");
            }
        });
    }

    deleteAccount() {
        this.fetchApi("delete", {}, (err) => {
            if (err) {
                errorLogManager.storeGeneric("account", "delete_error");
                this.emit("error", "server_error");
                return;
            }
            this.config.set("profile", null);
            window.location.reload();
        });
    }

    setUsername(username: string, callback: (err?: string) => void) {
        this.fetchApi("username", { json: { username } }, (err, res) => {
            if (err) {
                errorLogManager.storeGeneric("account", "set_username_error");
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

        this.fetchApi("loadout", { json: { loadout } }, (err, res) => {
            if (err) {
                errorLogManager.storeGeneric("account", "set_loadout_error");
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
                json: {
                    status,
                    itemTypes,
                },
            }, (err) => {
                if (err) {
                    errorLogManager.storeGeneric("account", "set_item_status_error");
                }
            });
        }
    }

    getPass(tryRefreshQuests: boolean) {
        this.fetchApi("get_pass", { json: { tryRefreshQuests } }, (err, res) => {
            this.pass = {} as PassState;
            this.quests = [];
            if (err || !res.success) {
                errorLogManager.storeGeneric("account", "get_pass_error");
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
        this.fetchApi("set_pass_unlock", { json: { unlockType } }, (err, res) => {
            if (err || !res.success) {
                errorLogManager.storeGeneric("account", "set_pass_unlock_error");
            } else {
                this.getPass(false);
            }
        });
    }

    refreshQuest(idx: number) {
        this.fetchApi("refresh_quest", { json: { idx } }, (err, res) => {
            if (err) {
                errorLogManager.storeGeneric("account", "refresh_quest_error");
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
