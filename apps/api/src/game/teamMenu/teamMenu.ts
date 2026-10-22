import { getLogger } from "@survev/logger/node.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import { type ClientRoomData, type ClientToServerTeamMsg, zTeamClientMsg } from "@survev/shared/types/team.ts";
import { settings } from "../../admin/settings.ts";
import { Player, type Socket } from "./player.ts";
import { Room } from "./room.ts";

export const teamCodeCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
function generateTeamCode(): string {
    let str = "";
    for (let i = 0; i < 4; i++) {
        str += teamCodeCharacters.charAt(
            Math.floor(Math.random() * teamCodeCharacters.length),
        );
    }
    return `${str}`;
}

export class TeamMenu {
    rooms = new Map<string, Room>();

    logger = getLogger(["api", "team-menu"]);

    playersByIp = new Map<string, Set<Player>>();

    /** open team menu sockets, one per player */
    get socketCount(): number {
        let n = 0;
        for (const set of this.playersByIp.values()) n += set.size;
        return n;
    }

    start() {
        setInterval(() => this.sweep(), 1000);
    }

    /** ends finished find_game cooldowns and kicks silent players */
    sweep() {
        for (const room of this.rooms.values()) {
            if (room.data.findingGame && room.findGameCooldown < Date.now()) {
                room.data.findingGame = false;
                room.sendState();
            }

            // the client sends a keep alive msg every 45 seconds
            // copied: removePlayer changes the list
            for (const player of room.players.slice()) {
                if (player.lastMsgTime < Date.now() - 8 * 60 * 1000) {
                    player.send("error", { type: "lost_conn" });
                    room.removePlayer(player);
                }
            }
        }
    }

    allowedGameModeIdxs() {
        return settings.modes
            .map((_, i) => i)
            .filter((i) => {
                const mode = settings.modes[i];
                return mode.enabled && mode.teamMode != TeamMode.Solo;
            });
    }

    addPlayer(socket: Socket, userId: string | null, ip: string) {
        const player = new Player(socket, userId, ip);

        let players = this.playersByIp.get(player.encodedIp);
        if (!players) {
            players = new Set();
            this.playersByIp.set(player.encodedIp, players);
        }
        players.add(player);
        return player;
    }

    /** `data` is the message, already JSON.parse'd when it is json */
    onMsg(player: Player, data: unknown) {
        const parsed = zTeamClientMsg.safeParse(data);
        if (!parsed.success) {
            this.logger.info("team.bad_message", { err: parsed.error });
            player.socket.close();
            return;
        }

        if (player.room) {
            player.room.onMsg(player, parsed.data);
            return;
        }

        this.enterRoom(player, parsed.data);

        // creating or joining failed, or it was some other message
        if (!player.room) {
            this.logger.debug("team.player_not_in_room");
            player.socket.close();
        }
    }

    private enterRoom(player: Player, msg: ClientToServerTeamMsg) {
        switch (msg.type) {
            case "create": {
                // don't allow creating a team if there's no team mode enabled
                if (!this.allowedGameModeIdxs().length) {
                    player.send("error", { type: "create_failed" });
                    break;
                }

                player.setName(msg.data.playerData.name);
                this.createRoom(msg.data.roomData).addPlayer(player);
                break;
            }
            case "join": {
                const room = this.rooms.get(msg.data.roomUrl);
                if (!room) {
                    player.send("error", { type: "join_not_found" });
                    break;
                }

                if (room.players.length >= room.data.maxPlayers) {
                    player.send("error", { type: "join_full" });
                    break;
                }
                player.setName(msg.data.playerData.name);
                room.addPlayer(player);
            }
        }
    }

    onClose(player: Player) {
        const byIp = this.playersByIp.get(player.encodedIp);
        if (byIp) {
            byIp.delete(player);
            if (byIp.size === 0) {
                this.playersByIp.delete(player.encodedIp);
            }
        }

        clearTimeout(player.disconnectTimeout);
        player.room?.removePlayer(player);
    }

    createRoom(data: ClientRoomData) {
        let roomUrl = generateTeamCode();
        while (this.rooms.has(roomUrl)) {
            roomUrl = generateTeamCode();
        }

        const room = new Room(this, roomUrl, data);
        this.rooms.set(roomUrl, room);
        return room;
    }

    /** what a shared invite link shows; undefined when the room is gone */
    roomSummary(code: string) {
        const room = this.rooms.get(code);
        if (!room?.players.length) return undefined;
        const mode = settings.modes[room.data.gameModeIdx];
        return {
            players: room.players.map((player) => player.name),
            maxPlayers: room.data.maxPlayers,
            region: room.data.region,
            mapName: mode?.mapName,
        };
    }

    removeRoom(room: Room) {
        this.rooms.delete(room.id);
    }

    disconnectPlayers(encodedIp: string) {
        const players = this.playersByIp.get(encodedIp);
        if (!players) return;

        for (const player of players) {
            player.socket.close();
        }
        players.clear();
        this.playersByIp.delete(encodedIp);
    }
}

export const teamMenu = new TeamMenu();
