import type { FindGamePrivateBody } from "@survev/contracts";
import type { GameData, SpectateTokenData } from "./game.ts";
import type { GameMode } from "./gameOptions.ts";

export enum ProcessMsgType {
    Create,
    KeepAlive,
    UpdateData,
    AddJoinToken,
    AddSpectateToken,
}

export interface CreateGameMsg {
    type: ProcessMsgType.Create;
    config: GameMode;
    id: string;
}

export interface KeepAliveMsg {
    type: ProcessMsgType.KeepAlive;
}

export interface UpdateDataMsg extends GameData {
    type: ProcessMsgType.UpdateData;
}

export interface AddJoinTokenMsg {
    type: ProcessMsgType.AddJoinToken;
    autoFill: boolean;
    tokens: FindGamePrivateBody["playerData"];
}

export interface AddSpectateTokenMsg {
    type: ProcessMsgType.AddSpectateToken;
    token: string;
    data: SpectateTokenData;
}

export type ProcessMsg =
    | CreateGameMsg
    | KeepAliveMsg
    | UpdateDataMsg
    | AddJoinTokenMsg
    | AddSpectateTokenMsg;
