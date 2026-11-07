import { GameConfig } from "@survev/shared/gameConfig.ts";
import type { FindGameMatchData } from "@survev/shared/types/api.ts";
import type {
    RoomData,
    ServerToClientTeamMsg,
    TeamErrorMsg,
    TeamMenuErrorType,
    TeamPlayGameMsg,
    TeamStateMsg,
} from "@survev/shared/types/team.ts";
import { reconcile } from "solid-js";
import { api } from "../api.ts";
import type { AudioManager } from "../audioManager.ts";
import type { ConfigManager } from "../config.ts";
import { helpers } from "../helpers.ts";
import type { PingTest } from "../pingTest.ts";
import type { SiteInfo } from "../siteInfo.ts";
import { showRefresh } from "./appModals.ts";
import { translate } from "./i18n.ts";
import { setTeam, setTeamMenu } from "./startMenu.ts";

const errorKeys: Partial<Record<TeamMenuErrorType, string>> = {
    join_full: "index-team-is-full",
    join_not_found: "index-failed-joining-team",
    create_failed: "index-failed-creating-team",
    join_failed: "index-failed-joining-team",
    join_game_failed: "index-failed-joining-game",
    lost_conn: "index-lost-connection",
    find_game_error: "index-failed-finding-game",
    find_game_full: "index-failed-finding-game",
    find_game_invalid_protocol: "index-invalid-protocol",
    find_game_invalid_captcha: "index-invalid-captcha",
    kicked: "index-team-kicked",
    banned: "index-ip-banned",
};

function errorTypeToString(type: TeamMenuErrorType) {
    // passed on to the main app, which shows a modal
    if (type === "behind_proxy") return "behind_proxy";
    return translate(errorKeys[type] ?? "index-lost-connection");
}

/** the team room's websocket; components/TeamMenu.tsx shows its state (team in ./startMenu.ts) */
export class TeamMenu {
    active = false;
    joined = false;
    create = false;
    joiningGame = false;
    ws: WebSocket | null = null;

    gameError: string | undefined = undefined;

    playerData = {};
    roomData = {} as RoomData;
    players: TeamStateMsg["data"]["players"] = [];

    prevPlayerCount = 0;
    localPlayerId = 0;
    isLeader = true;
    editingName = false;
    displayedInvalidProtocolModal = false;

    constructor(
        public config: ConfigManager,
        public pingTest: PingTest,
        public siteInfo: SiteInfo,
        public audioManager: AudioManager,
        public joinGameCb: (data: FindGameMatchData) => void,
        public leaveCb: (err?: string) => void,
    ) {
        setInterval(() => {
            if (this.joined) {
                this.sendMessage("keepAlive", {});
            }
        }, 10 * 1000);
        setTeamMenu(this);
    }

    getPlayerById(playerId: number) {
        return this.players.find((x) => x.playerId == playerId);
    }

    connect(create: boolean, roomUrl: string) {
        if (this.active && roomUrl === this.roomData.roomUrl) return;
        const roomHost = api.resolveRoomHost();
        const url = `w${window.location.protocol === "https:" ? "ss" : "s"}://${roomHost}/team_v2`;
        this.active = true;
        this.joined = false;
        this.create = create;
        this.joiningGame = false;
        this.editingName = false;
        this.gameError = undefined;

        // Load properties from config
        this.playerData = {
            name: this.config.get("playerName"),
        };
        this.roomData = {
            roomUrl,
            region: this.config.get("region")!,
            gameModeIdx: this.config.get("gameModeIdx")!,
            autoFill: this.config.get("teamAutoFill")!,
            findingGame: false,
            lastError: undefined,
        } as RoomData;
        this.displayedInvalidProtocolModal = false;

        this.refreshUi();

        if (this.ws) {
            this.ws.onclose = function() {};
            this.ws.close();
            this.ws = null;
        }

        try {
            this.ws = new WebSocket(url);
            this.ws.onerror = (_e) => {
                this.ws?.close();
            };
            this.ws.onclose = () => {
                let errMsg: TeamMenuErrorType | undefined = undefined;
                if (!this.joiningGame) {
                    errMsg = this.joined ? "lost_conn" : this.create ? "create_failed" : "join_failed";
                }
                this.leave(errMsg);
            };
            this.ws.onopen = () => {
                if (this.create) {
                    this.sendMessage("create", {
                        roomData: this.roomData,
                        playerData: this.playerData,
                    });
                } else {
                    this.sendMessage("join", {
                        roomUrl: this.roomData.roomUrl,
                        playerData: this.playerData,
                    });
                }
            };
            this.ws.onmessage = (e) => {
                if (this.active) {
                    const msg = JSON.parse(e.data);
                    this.onMessage(msg.type, msg.data);
                }
            };
        } catch (_e) {
            this.leave(this.create ? "create_failed" : "join_failed");
        }
    }

    leave(errType?: TeamMenuErrorType) {
        if (!this.active) return;
        this.ws?.close();
        this.ws = null;
        this.active = false;
        this.joined = false;
        this.joiningGame = false;
        this.refreshUi();

        // Save state to config for the menu
        this.config.set("gameModeIdx", this.roomData.gameModeIdx);
        this.config.set("teamAutoFill", this.roomData.autoFill);
        if (this.isLeader) {
            this.config.set("region", this.roomData.region);
        }
        this.leaveCb(errType ? errorTypeToString(errType) : "");
    }

    onGameComplete(errMessage?: string) {
        if (this.active) {
            this.joiningGame = false;
            this.sendMessage("gameComplete");

            this.gameError = errMessage;
        }
    }

    onMessage<T extends ServerToClientTeamMsg["type"]>(type: T, data: ServerToClientTeamMsg["data"]) {
        switch (type) {
            case "state": {
                const stateData = data as TeamStateMsg["data"];
                this.joined = true;
                const ourRoomData = this.roomData;
                this.roomData = stateData.room;
                this.players = stateData.players;
                this.localPlayerId = stateData.localPlayerId;
                this.isLeader = this.getPlayerById(this.localPlayerId)!.isLeader;

                // Override room properties with local values if we're
                // the leader; otherwise, the server may override a
                // recent change.
                //
                // A better solution here would be just a sequence
                // number and we can ignore updates that don't include our
                // most recent change request.
                if (this.isLeader) {
                    this.roomData.region = ourRoomData.region;
                    this.roomData.autoFill = ourRoomData.autoFill;
                }
                this.refreshUi();
                break;
            }
            case "joinGame":
                this.joiningGame = true;
                this.joinGameCb(data as FindGameMatchData);
                break;
            case "keepAlive":
                break;
            case "kicked":
                this.leave("kicked");
                break;
            case "error":
                this.leave((data as TeamErrorMsg["data"]).type);
        }
    }

    sendMessage(type: string, data?: unknown) {
        if (this.ws) {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.send(JSON.stringify({ type, data }));
            } else {
                this.ws.close();
            }
        }
    }

    setRoomProperty<T extends keyof RoomData>(prop: T, val: RoomData[T]) {
        if (this.isLeader && this.roomData[prop] != val) {
            this.roomData[prop] = val;
            this.sendMessage("setRoomProps", this.roomData);
        }
    }

    setRegion(region: string) {
        this.pingTest.start([region]);
        this.setRoomProperty("region", region);
    }

    tryStartGame() {
        if (this.isLeader && !this.roomData.findingGame) {
            const version = GameConfig.protocolVersion;
            let region = this.roomData.region;
            const paramRegion = helpers.getParameterByName("region");
            if (paramRegion !== undefined && paramRegion.length > 0) {
                region = paramRegion;
            }
            let zones = this.pingTest.getZones(region);
            const paramZone = helpers.getParameterByName("zone");
            if (paramZone !== undefined && paramZone.length > 0) {
                zones = [paramZone];
            }
            const matchArgs: TeamPlayGameMsg["data"] = {
                version,
                region,
                zones,
            };

            helpers.verifyTurnstile(this.roomData.captchaEnabled, (token) => {
                matchArgs.turnstileToken = token;
                this.sendMessage("playGame", matchArgs);
            });
            this.roomData.findingGame = true;
            this.gameError = undefined;
            this.refreshUi();
        }
    }

    /** the invite text to copy: the share link, or the bare code inside an iframe */
    inviteToCopy() {
        const roomCode = this.roomData.roomUrl.substring(1);
        return window !== window.top ? roomCode : `${window.location.origin}/t/${roomCode}`;
    }

    editName() {
        this.editingName = true;
        this.refreshUi();
    }

    submitName(input: string) {
        const name = helpers.sanitizeNameInput(input);
        this.config.set("playerName", name);
        this.sendMessage("changeName", { name });
        this.editingName = false;
        this.refreshUi();
    }

    cancelNameEdit() {
        this.editingName = false;
        this.refreshUi();
    }

    kick(playerId: number) {
        this.sendMessage("kick", { playerId });
    }

    refreshUi() {
        const lastError = this.roomData.lastError;
        if (lastError == "find_game_invalid_protocol" && !this.displayedInvalidProtocolModal) {
            showRefresh();
            this.displayedInvalidProtocolModal = true;
        }

        // Set captcha to enabled if we fail the captcha
        // This can happen if it was disabled when the page loaded which would meant it was sending an empty token
        // And we only fetch the state when the page loads...
        if (lastError === "find_game_invalid_captcha") {
            this.siteInfo.info.captchaEnabled = true;
        }

        if (this.joined && this.roomData.roomUrl && window.history) {
            window.history.replaceState("", "", this.roomData.roomUrl);
        }

        setTeam((t) => {
            t.active = this.active;
            t.joined = this.joined;
            t.create = this.create;
            t.joiningGame = this.joiningGame;
            t.isLeader = this.isLeader;
            t.localPlayerId = this.localPlayerId;
            t.editingName = this.editingName;
            t.error = lastError ? errorTypeToString(lastError) : this.gameError || "";
            reconcile({
                roomUrl: this.roomData.roomUrl ?? "",
                region: this.roomData.region ?? "",
                gameModeIdx: this.roomData.gameModeIdx ?? 0,
                enabledGameModeIdxs: this.roomData.enabledGameModeIdxs ?? [],
                autoFill: !!this.roomData.autoFill,
                findingGame: !!this.roomData.findingGame,
                maxPlayers: this.roomData.maxPlayers ?? 0,
            })(t.room);
            reconcile(this.players.map((p) => ({ ...p })), "playerId")(t.players);
        });

        if (!this.joined) return;
        // Play a sound if player count has increased
        const localPlayer = this.getPlayerById(this.localPlayerId);
        const playJoinSound = localPlayer && !localPlayer.inGame;
        if (
            !document.hasFocus()
            && this.prevPlayerCount < this.players.length
            && this.players.length > 1
            && playJoinSound
        ) {
            this.audioManager.playSound("notification_join_01", {
                channel: "ui",
            });
        }
        this.prevPlayerCount = this.players.length;
    }
}
