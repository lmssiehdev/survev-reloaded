import { GameConfig } from "@survev/shared/gameConfig.ts";
import * as net from "@survev/shared/net/net.ts";
import type {
    FindGameBody,
    FindGameError,
    FindGameMatchData,
    FindGameResponse,
    GameWsDisconnectReason,
} from "@survev/shared/types/api.ts";
import { math } from "@survev/shared/utils/math.ts";
import $ from "jquery";
import * as PIXI from "pixi.js-legacy";
import { Account } from "./account.ts";
import { Ambiance } from "./ambiance.ts";
import { api } from "./api.ts";
import { config as appConfig } from "./appConfig.ts";
import { AudioManager } from "./audioManager.ts";
import type { ConfigKey, ConfigType } from "./config.ts";
import { device } from "./device.ts";
import { Game } from "./game.ts";
import { helpers } from "./helpers.ts";
import { InputHandler } from "./input.ts";
import { InputBinds, InputBindUi } from "./inputBinds.ts";
import { PingTest } from "./pingTest.ts";
import { ResourceManager } from "./resources.ts";
import { SiteInfo } from "./siteInfo.ts";
import { teamCodeFromPath } from "./teamLink.ts";
import { notificationModal, showIpBan, showNotification, showRefresh } from "./ui/appModals.ts";
import { mountAccount } from "./ui/components/Account.tsx";
import { mountAppModals } from "./ui/components/AppModals.tsx";
import { mountEmoteWheels } from "./ui/components/EmoteWheel.tsx";
import { mountGameView } from "./ui/components/GameHud.tsx";
import { mountHud } from "./ui/components/Hud.tsx";
import { currentNewsTime, mountStartMenu } from "./ui/components/StartMenu.tsx";
import { LoadoutMenu } from "./ui/loadoutMenu.ts";
import { Localization } from "./ui/localization.ts";
import Menu from "./ui/menu.ts";
import { LoadoutDisplay } from "./ui/opponentDisplay.ts";
import { Pass } from "./ui/pass.ts";
import { ProfileUi } from "./ui/profileUi.ts";
import { setApp, setStartMenu, startMenu } from "./ui/startMenu.ts";
import { TeamMenu } from "./ui/teamMenu.ts";
import { loadStaticDomImages } from "./ui/ui2.ts";

export class Application {
    startMenuWrapper = $("#start-menu-wrapper");
    gameAreaWrapper = $("#game-area-wrapper");
    config = appConfig;
    localization = new Localization();

    account!: Account;
    loadoutMenu!: LoadoutMenu;
    pass!: Pass;
    profileUi!: ProfileUi;

    pingTest = new PingTest();
    audioManager = new AudioManager();
    ambience = new Ambiance();

    siteInfo!: SiteInfo;
    teamMenu!: TeamMenu;

    pixi: PIXI.Application<HTMLCanvasElement> | null = null;
    resourceManager: ResourceManager | null = null;
    input: InputHandler | null = null;
    inputBinds: InputBinds | null = null;
    inputBindUi: InputBindUi | null = null;
    game: Game | null = null;
    loadoutDisplay: LoadoutDisplay | null = null;
    domContentLoaded = false;
    configLoaded = false;
    initialized = false;
    active = false;
    sessionId = helpers.random64();
    contextListener = function(e: MouseEvent) {
        e.preventDefault();
    };

    errorMessage = "";
    quickPlayPendingModeIdx = -1;
    findGameAttempts = 0;
    findGameTime = 0;
    pauseTime = 0;
    wasPlayingVideo = false;
    checkedPingTest = false;
    hasFocus = true;
    playLockTimeout = 0;

    constructor() {
        this.account = new Account(this.config);
        this.loadoutMenu = new LoadoutMenu(this.account);
        this.pass = new Pass(this.account, this.loadoutMenu);
        this.profileUi = new ProfileUi(this.account, this.loadoutMenu);
        this.siteInfo = new SiteInfo(this.config);

        this.teamMenu = new TeamMenu(
            this.config,
            this.pingTest,
            this.siteInfo,
            this.audioManager,
            this.onTeamMenuJoinGame.bind(this),
            this.onTeamMenuLeave.bind(this),
        );

        const onLoadComplete = () => {
            this.config.load(() => {
                this.configLoaded = true;
                this.tryLoad();
            });
        };
        onLoadComplete();
    }

    tryLoad() {
        if (this.domContentLoaded && this.configLoaded && !this.initialized) {
            this.initialized = true;
            // this should be this.config.config.teamAutofill = true???
            // this.config.teamAutoFill = true;
            const language = this.config.get("language") || this.localization.detectLocale();
            this.config.set("language", language);
            this.localization.setLocale(language);
            this.siteInfo.load().then(() => {
                this.pingTest.setRegions(this.siteInfo.info.regions ?? {});
                this.startPingTest();
                this.updateLoginSupport();
                this.profileUi.updateLoginSupport();
                this.account.initLogin();
            });
            this.localization.localizeIndex();
            this.account.init();

            this.updateLoginSupport();
            const lastSeenNewsTime = this.config.get("lastNewsTimestamp")!;
            setStartMenu((m) => {
                m.newsUnread = currentNewsTime > lastSeenNewsTime;
            });
            this.setDOMFromConfig();
            this.setAppActive(true);
            const domCanvas = document.querySelector<HTMLCanvasElement>("#cvs")!;

            const rendererRes = window.devicePixelRatio > 1 ? 2 : 1;

            if (device.os == "ios") {
                PIXI.settings.PRECISION_FRAGMENT = PIXI.PRECISION.HIGH;
            }

            const createPixiApplication = (forceCanvas: boolean) => {
                return new PIXI.Application<HTMLCanvasElement>({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    view: domCanvas,
                    antialias: false,
                    resolution: rendererRes,
                    hello: true,
                    forceCanvas,
                });
            };
            let pixi = null;
            try {
                pixi = createPixiApplication(false);
            } catch (_e) {
                pixi = createPixiApplication(true);
            }
            this.pixi = pixi;
            this.pixi.renderer.events.destroy();
            this.pixi.ticker.add(this.update, this);
            this.pixi.renderer.background.color = 7378501;
            this.resourceManager = new ResourceManager(
                this.pixi.renderer,
                this.audioManager,
                this.config,
            );
            this.resourceManager.loadMapAssets("main");
            this.input = new InputHandler(document.getElementById("game-touch-area")!);
            this.inputBinds = new InputBinds(this.input, this.config);
            this.inputBindUi = new InputBindUi(this.input, this.inputBinds);
            const onJoin = () => {
                this.loadoutDisplay!.free();
                this.game!.init();
                this.onResize();
                this.findGameAttempts = 0;
                this.ambience.onGameStart();
            };
            const onQuit = (errMsg?: GameWsDisconnectReason) => {
                if (this.game!.m_updatePass) {
                    this.pass.scheduleUpdatePass(this.game!.m_updatePassDelay);
                }
                this.game!.free();
                this.errorMessage = errMsg ? this.getErrorString(errMsg, "host_closed") : "";
                this.teamMenu.onGameComplete(this.errorMessage);
                this.ambience.onGameComplete(this.audioManager);
                this.ambience.setMap(this.siteInfo?.info?.clientTheme || "main", this.audioManager);
                this.setAppActive(true);
                this.setPlayLockout(false);

                if (errMsg == "invalid_protocol") {
                    showRefresh();
                }
                if (errMsg == "behind_proxy" || errMsg == "ip_banned") {
                    this.showErrorModal(errMsg);
                }
                if (errMsg) {
                    console.warn("Quitting", errMsg);
                }
            };
            this.game = new Game(
                this.pixi,
                this.audioManager,
                this.localization,
                this.config,
                this.input,
                this.inputBinds,
                this.inputBindUi,
                this.ambience,
                this.resourceManager,
                onJoin,
                onQuit,
            );
            this.loadoutDisplay = new LoadoutDisplay(
                this.pixi,
                this.audioManager,
                this.config,
                this.inputBinds,
                this.account,
            );

            if (this.pixi.renderer.type === PIXI.RENDERER_TYPE.WEBGL) {
                this.pixi.view.addEventListener("webglcontextrestored", () => {
                    if (this.game?.initialized && this.game.m_map.mapLoaded) {
                        this.game.m_map.renderMap(this.pixi!.renderer, false);
                    }
                });
            }

            this.loadoutMenu.loadoutDisplay = this.loadoutDisplay;
            this.onResize();
            this.tryJoinTeam(false);
            Menu.setupModals(this.inputBindUi);
            this.onConfigModified();
            this.config.addModifiedListener(this.onConfigModified.bind(this));
            loadStaticDomImages();

            this.tryJoinGameFromParam();
        }
    }

    onUnload() {
        this.teamMenu.leave();
    }

    onResize() {
        device.onResize();
        Menu.onResize();
        this.loadoutMenu.onResize();
        this.pixi?.renderer.resize(device.screenWidth, device.screenHeight);
        if (this.game?.initialized) {
            this.game.resize();
        }
        if (this.loadoutDisplay?.initialized) {
            this.loadoutDisplay.resize();
        }
        this.refreshUi();
    }

    /** hide pass and show news if login is unsupported, again once site_info says which logins the API has */
    updateLoginSupport() {
        setStartMenu((m) => {
            m.newsDisplayed = !api.anyLoginSupported();
        });
    }

    /** the right column's pass / news switch; opening the news marks it read */
    toggleNews() {
        const showNews = !startMenu.newsDisplayed;
        if (showNews) this.config.set("lastNewsTimestamp", currentNewsTime);
        setStartMenu((m) => {
            m.newsDisplayed = showNews;
            if (showNews) m.newsUnread = false;
        });
    }

    openTeamLink() {
        setStartMenu((m) => {
            m.teamLinkOpen = true;
            m.teamLink = "";
            m.teamLinkWarning = false;
        });
    }

    closeTeamLink() {
        setStartMenu((m) => {
            m.teamLinkOpen = false;
            m.teamLink = "";
        });
    }

    /** "Join Team" in the paste-a-link panel */
    joinTeamLink(code: string) {
        if (code.length > 0) {
            setStartMenu((m) => {
                m.teamLinkOpen = false;
            });
            this.tryJoinTeam(false, code);
        } else {
            setStartMenu((m) => {
                m.teamLinkWarning = true;
            });
        }
    }

    leaveTeam() {
        if (window.history) {
            window.history.replaceState("", "", "/");
        }
        this.game?.free();
        this.teamMenu.leave();
    }

    startPingTest() {
        const regions = this.config.get("regionSelected")
            ? [this.config.get("region")!]
            : this.pingTest.getRegionList();
        this.pingTest.start(regions);
    }

    setAppActive(active: boolean) {
        this.active = active;
        this.quickPlayPendingModeIdx = -1;
        this.refreshUi();

        // Certain systems, like the account, can throw errors
        // while the user is already in a game.
        // Seeing these errors when returning to the menu would be
        // confusing, so we'll hide the modal instead.
        if (active) {
            notificationModal.hide();
        }
    }

    /** dims the play buttons while a game is joined; unlocking waits a second (not in dev) */
    setPlayLockout(lock: boolean) {
        clearTimeout(this.playLockTimeout);
        this.playLockTimeout = window.setTimeout(
            () => {
                setStartMenu((m) => {
                    m.playLocked = lock;
                });
            },
            lock || IS_DEV ? 0 : 1000,
        );
    }

    onTeamMenuJoinGame(data: FindGameMatchData) {
        this.waitOnAccount(() => {
            this.joinGame(data);
        });
    }

    onTeamMenuLeave(errTxt?: string) {
        if (errTxt && window.history) {
            window.history.replaceState("", "", "/");
        }

        this.errorMessage = errTxt || "";
        this.setDOMFromConfig();
        this.refreshUi();
    }

    // Config
    setConfigFromDOM() {
        const playerName = helpers.sanitizeNameInput(startMenu.playerName);
        this.config.set("playerName", playerName);
        // (an empty select, before site_info, keeps the saved region)
        if (startMenu.regions.some((r) => r.id === startMenu.region)) {
            this.config.set("region", startMenu.region);
        }
    }

    setDOMFromConfig() {
        setStartMenu((m) => {
            m.playerName = this.config.get("playerName")!;
            m.region = this.config.get("region")!;
        });
    }

    onConfigModified(key?: ConfigKey) {
        const muteAudio = this.config.get("muteAudio")!;
        if (muteAudio != this.audioManager.mute) {
            this.audioManager.setMute(muteAudio);
        }

        // the volume sliders (settings modal, in-game menu) only write the config
        this.audioManager.setMasterVolume(this.config.get("masterVolume")!);
        this.audioManager.setSoundVolume(this.config.get("soundVolume")!);
        this.audioManager.setMusicVolume(this.config.get("musicVolume")!);

        if (key == "language") {
            this.localization.setLocale(this.config.get("language")!);
        }

        if (key == "region") {
            setStartMenu((m) => {
                m.region = this.config.get("region")!;
            });
            this.config.set("regionSelected", true);
            this.startPingTest();
        }

        if (key == "highResTex") {
            location.reload();
        }

        if (key == "clientTheme") {
            if (!this.game?.initialized) {
                this.ambience.setMap(this.config.get("clientTheme") || "main", this.audioManager);
            }
        }

        if (key === "debugHUD") {
            this.game?.debugHUD?.onConfigModified();
        }
    }

    refreshUi() {
        this.startMenuWrapper.css("display", this.active ? "flex" : "none");
        this.gameAreaWrapper.css({
            display: this.active ? "none" : "block",
            opacity: this.active ? 0 : 1,
        });
        if (this.active) {
            $("body").removeClass("user-select-none");
            document.removeEventListener("contextmenu", this.contextListener);
        } else {
            $("body").addClass("user-select-none");
            document.addEventListener("contextmenu", this.contextListener);
        }
        setStartMenu((m) => {
            m.active = this.active;
            m.errorMessage = this.errorMessage;
            m.pendingModeIdx = this.quickPlayPendingModeIdx;
            m.landscape = device.isLandscape;
        });
    }

    waitOnAccount(cb: () => void) {
        if (this.account.requestsInFlight == 0) {
            cb();
        } else {
            // Wait some maximum amount of time for pending account requests
            const timeout = setTimeout(() => {
                runOnce();
            }, 2500);
            const runOnce = () => {
                cb();
                clearTimeout(timeout);
                this.account.removeEventListener("requestsComplete", runOnce);
            };
            this.account.addEventListener("requestsComplete", runOnce);
        }
    }

    tryJoinTeam(create: boolean, url?: string) {
        if (this.active && this.quickPlayPendingModeIdx === -1) {
            // Join team if the url contains a team address
            const roomUrl = url || window.location.hash.slice(1);

            if (create || roomUrl != "") {
                // The main menu and squad menus have separate
                // DOM elements for input, such as player name and
                // selected region. We will stash the menu values
                // into the config so the team menu can read them.
                this.setConfigFromDOM();
                this.teamMenu.connect(create, roomUrl);
                this.refreshUi();
            }
        }
    }

    tryQuickStartGame(gameModeIdx: number) {
        if (this.quickPlayPendingModeIdx === -1) {
            // Update UI to display a spinner on the play button
            this.errorMessage = "";
            this.quickPlayPendingModeIdx = gameModeIdx;
            this.setConfigFromDOM();
            this.refreshUi();

            // Wait some amount of time if we've recently attempted to
            // find a game to prevent spamming the server
            let delay = 0;
            if (this.findGameAttempts > 0 && Date.now() - this.findGameTime < 30000) {
                delay = Math.min(this.findGameAttempts * 2.5 * 1000, 7500);
            } else {
                this.findGameAttempts = 0;
            }
            this.findGameTime = Date.now();
            this.findGameAttempts++;

            // the delay is annoying on dev
            if (IS_DEV) {
                delay = 0;
            }

            const version = GameConfig.protocolVersion;
            let region = this.config.get("region")!;
            const paramRegion = helpers.getParameterByName("region");
            if (paramRegion !== undefined && paramRegion.length > 0) {
                region = paramRegion;
            }
            let zones = this.pingTest.getZones(region);
            const paramZone = helpers.getParameterByName("zone");
            if (paramZone !== undefined && paramZone.length > 0) {
                zones = [paramZone];
            }

            const matchArgs: FindGameBody = {
                version,
                region,
                zones,
                playerCount: 1,
                autoFill: true,
                gameModeIdx,
            };

            const tryQuickStartGameImpl = () => {
                this.waitOnAccount(() => {
                    this.findGame(matchArgs, {
                        error: (err) => {
                            this.onJoinGameError(err);
                        },
                        success: (data) => {
                            this.joinGame(data);
                        },
                        ban: (ban) => {
                            this.onIpBanned(ban);
                        },
                    });
                });
            };

            if (delay == 0) {
                // We can improve findGame responsiveness by ~30 ms by skipping
                // the 0ms setTimeout
                tryQuickStartGameImpl();
            } else {
                setTimeout(() => {
                    tryQuickStartGameImpl();
                }, delay);
            }
        }
    }

    findGame(
        matchArgs: FindGameBody,
        cbs: {
            error: (err: FindGameError) => void;
            success: (matchData: FindGameMatchData) => void;
            ban: (data: FindGameResponse & { type: "banned" }) => void;
        },
    ) {
        const findGameImpl = (iter: number, maxAttempts: number, token: string) => {
            if (iter >= maxAttempts) {
                cbs.error("full");
                return;
            }
            const retry = () => {
                setTimeout(() => {
                    helpers.verifyTurnstile(
                        this.siteInfo.info.captchaEnabled && !this.account.loggedIn,
                        (token) => {
                            findGameImpl(iter + 1, maxAttempts, token);
                        },
                    );
                }, 500);
            };
            matchArgs.turnstileToken = token;

            fetch(api.resolveUrl("/api/find_game_v2"), {
                method: "POST",
                body: JSON.stringify(matchArgs),
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                },
                credentials: api.credentials(),
                signal: helpers.abortSignal(10 * 1000),
            }).then(res => res.json()).then((data: FindGameResponse) => {
                if (data.type === "error") {
                    cbs.error(data.error);
                } else if (data.type === "banned") {
                    cbs.ban(data);
                } else if (data.type === "success") {
                    cbs.success(data.res);
                }
            }).catch(() => {
                retry();
            });
        };

        helpers.verifyTurnstile(
            this.siteInfo.info.captchaEnabled && !this.account.loggedIn,
            (token) => {
                findGameImpl(0, 2, token);
            },
        );
    }

    joinGame(matchData: FindGameMatchData) {
        if (!this.game) {
            setTimeout(() => {
                this.joinGame(matchData);
            }, 250);
            return;
        }
        const urls = [...matchData.urls];

        const joinGameImpl = (urls: string[], matchData: FindGameMatchData) => {
            const url = urls.shift();
            if (!url) {
                this.onJoinGameError("join_game_failed");
                return;
            }
            const onFailure = function() {
                joinGameImpl(urls, matchData);
            };
            this.game!.tryJoinGame(
                url,
                matchData.joinToken,
                onFailure,
            );
        };
        joinGameImpl(urls, matchData);
    }

    tryJoinGameFromParam() {
        const params = new URLSearchParams(window.location.search);
        if (params.has("u") && params.has("jt")) {
            try {
                const urls = atob(params.get("u")!).split(",");
                const joinToken = params.get("jt")!;

                this!.joinGame({ urls, joinToken });
            } catch (e) {
                console.error("Failed to parse join data:", e);
                this.onJoinGameError("join_game_failed");
            }

            params.delete("u");
            params.delete("jt");
            window.history.pushState(
                "",
                "",
                params.size ? `${window.location.pathname}?${params.toString()}` : window.location.pathname,
            );
        }
    }

    getErrorString(err: FindGameError | GameWsDisconnectReason, fallback: "host_closed" | "full") {
        const errMap: Partial<Record<FindGameError | GameWsDisconnectReason, string>> = {
            banned: this.localization.translate("index-ip-banned"),
            behind_proxy: this.localization.translate("index-behind-proxy"),
            find_game_failed: this.localization.translate("index-failed-finding-game"),
            full: this.localization.translate("index-failed-finding-game"),
            host_closed: this.localization.translate("index-host-closed"),
            invalid_captcha: this.localization.translate("index-invalid-captcha"),
            invalid_packet: this.localization.translate("index-invalid-packet"),
            invalid_protocol: this.localization.translate("index-invalid-protocol"),
            invalid_token: this.localization.translate("index-invalid-token"),
            ip_banned: this.localization.translate("index-ip-banned"),
            join_game_failed: this.localization.translate("index-failed-joining-game"),
            player_not_found: this.localization.translate("index-player-not-found"),
            rate_limited: this.localization.translate("index-rate-limited"),
            server_crashed: this.localization.translate("index-server-crashed"),
            server_restart: this.localization.translate("index-server-restart"),
        };
        return errMap[err] || errMap[fallback]!;
    }

    onJoinGameError(err: FindGameError) {
        if (err == "invalid_protocol") {
            showRefresh();
        }

        // Forcefully set captcha to enabled if we fail the captcha
        // This can happen if it was disabled when the page loaded which would meant it was sending an empty token
        // And we only fetch the state when the page loads...
        if (err === "invalid_captcha") {
            this.siteInfo.info.captchaEnabled = true;
        }
        if (err == "behind_proxy" || err == "banned") {
            this.showErrorModal(err);
        }

        this.errorMessage = this.getErrorString(err, "full");
        this.quickPlayPendingModeIdx = -1;
        this.teamMenu.leave("join_game_failed");
        this.refreshUi();
    }

    onIpBanned(ban: FindGameResponse & { type: "banned" }) {
        showIpBan(ban);
        this.quickPlayPendingModeIdx = -1;
        this.teamMenu.leave("banned");
        this.refreshUi();
    }

    showErrorModal(err: FindGameError | GameWsDisconnectReason) {
        const text = this.getErrorString(err, "full");
        if (text) showNotification(text);
    }

    update() {
        const dt = math.clamp(this.pixi!.ticker.elapsedMS / 1000, 0.001, 1 / 8);
        this.pingTest.update(dt);
        if (!this.checkedPingTest && this.pingTest.isComplete()) {
            if (!this.config.get("regionSelected")) {
                const region = this.pingTest.getRegion();

                if (region) {
                    this.config.set("region", region);
                    this.setDOMFromConfig();
                }
            }
            this.checkedPingTest = true;
        }
        this.resourceManager!.update(dt);
        this.audioManager.update(dt);
        this.ambience.update(dt, this.audioManager, !this.active);

        // Game update
        if (this.game?.initialized && this.game.m_playing) {
            if (this.active) {
                this.setAppActive(false);
                this.setPlayLockout(true);
            }
            this.game.update(dt);
        }

        // LoadoutDisplay update
        if (this.active && this.loadoutDisplay && this.game && !this.game.initialized) {
            if (this.loadoutMenu.active) {
                if (!this.loadoutDisplay.initialized) {
                    this.loadoutDisplay.init();
                }
                this.loadoutDisplay.show();
                this.loadoutDisplay.update(dt, this.hasFocus);
            } else {
                this.loadoutDisplay.hide();
            }
        }
        if (!this.active && this.loadoutMenu.active) {
            this.loadoutMenu.hide();
        }
        if (this.active) {
            this.pass?.update(dt);
        }
        this.input!.flush();
    }
}

// a shared /t/<code> link: everything after this joins through the hash, as it always has
const sharedTeamCode = teamCodeFromPath(window.location.pathname);
if (sharedTeamCode) window.history.replaceState("", "", `/#${sharedTeamCode}`);

// islands mount before Application, whose classes look their elements up by id
mountAppModals();
mountStartMenu();
mountAccount();
mountGameView();
mountHud();
mountEmoteWheels();
const App = new Application();
setApp(App);

function onPageLoad() {
    App.domContentLoaded = true;
    App.tryLoad();
}

document.addEventListener("DOMContentLoaded", onPageLoad);
window.addEventListener("load", onPageLoad);
window.addEventListener("unload", (_e) => {
    App.onUnload();
});
if (window.location.hash == "#_=_") {
    window.location.hash = "";
    history.pushState("", document.title, window.location.pathname);
}
window.addEventListener("resize", () => {
    App.onResize();
});
window.addEventListener("orientationchange", () => {
    App.onResize();
});
window.addEventListener("hashchange", () => {
    App.tryJoinTeam(false);
});
window.addEventListener("beforeunload", (e) => {
    if (App.game?.warnPageReload()) {
        // In new browsers, dialogText is overridden by a generic string
        const dialogText = "Do you want to reload the game?";
        e.returnValue = dialogText;
        return dialogText;
    }
});
window.addEventListener("focus", () => {
    App.hasFocus = true;
});
window.addEventListener("blur", () => {
    App.hasFocus = false;
});
