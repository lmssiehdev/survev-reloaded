import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import { type FindGameMatchData, type FindGamePrivateError, loadoutSchema } from "@survev/shared/types/api.ts";
import { zSpectateFilter } from "@survev/shared/types/moderation.ts";
import { z } from "zod";

/** each game server registers its region with the API by reporting it every few seconds */
export const zUpdateRegionBody = z.object({
    regionId: z.string(),
    data: z.object({
        playerCount: z.number(),
        /** public URL of the game server, players and the API connect to it */
        url: z.url(),
        /** translation key of the region name, eg index-north-america */
        l10n: z.string(),
    }),
});
export type UpdateRegionBody = z.infer<typeof zUpdateRegionBody>;

export const zSetGameModeBody = z.object({
    index: z.number(),
    team_mode: z.enum(TeamMode).optional(),
    map_name: z.string().optional(),
    enabled: z.boolean().optional(),
});

export const zSetClientThemeBody = z.object({
    theme: z.string(),
});

/**
 * Runtime validator for SaveGameBody["matchData"], used to check lost game files before retrying them.
 * The API checks that this stays assignable to its match_data insert type (see apps/api/src/stats/privateRoutes.ts).
 */
export const zSaveGameMatchData = z.array(
    z.object({
        userId: z.string().nullish(),
        userBanned: z.boolean().nullish(),
        // dates are serialized as strings in the JSON files
        createdAt: z.coerce.date().optional(),
        region: z.string(),
        mapId: z.number().int(),
        gameId: z.guid(),
        mapSeed: z.number().int(),
        username: z.string(),
        playerId: z.number().int(),
        teamMode: z.enum(TeamMode),
        teamCount: z.number().int(),
        teamTotal: z.number().int(),
        teamId: z.number().int(),
        timeAlive: z.number().int(),
        rank: z.number().int(),
        died: z.boolean(),
        kills: z.number().int(),
        teamKills: z.number().int().optional(),
        damageDealt: z.number().int(),
        damageTaken: z.number().int(),
        killerId: z.number().int(),
        killedIds: z.array(z.number().int()),
        role: z.string().optional(),
        ip: z.string(),
        findGameIp: z.string(),
    }),
);

export interface SaveGameBody {
    matchData: z.infer<typeof zSaveGameMatchData>;
}

export const zFindGamePrivateBody = z.object({
    region: z.string(),
    version: z.number(),
    autoFill: z.boolean(),
    mapName: z.string(),
    teamMode: z.number(),
    playerData: z.array(
        z.object({
            joinToken: z.string(),
            userId: z.string().nullable(),
            ip: z.string(),
            loadout: loadoutSchema.optional(),
            quests: z.array(z.string()).optional(),
        }),
    ),
});

export type FindGamePrivateBody = z.infer<typeof zFindGamePrivateBody>;

export type FindGamePrivateRes =
    | {
        urls: string[];
    }
    | { error: FindGamePrivateError };

export type SpectateGamePrivateRes = {
    players: Array<{
        gameId: string;
        mapName: MapDefKey;
        teamMode: TeamMode;
        data: FindGameMatchData;
    }>;
};

export type ModRouterSpectateGameRes = SpectateGamePrivateRes & {
    region: string;
    done: boolean;
};

export const zSpectateGamePrivateBody = z.object({
    filter: zSpectateFilter,
});

export type SpectateGamePrivateBody = z.infer<typeof zSpectateGamePrivateBody>;
