import { MapId, TeamMode } from "@survev/shared/gameConfig.ts";
import { describe, expect, test } from "bun:test";
import "@survev/shared/test/testHelpers.ts";
import { questHelpers } from "../src/utils/questHelpers.ts";

describe("Quest helpers", () => {
    describe("getAvailableQuestsForModes", () => {
        test("All normal mode, no current quests", () => {
            const available = questHelpers.getAvailableQuestsForModes(
                [
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Solo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Duo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Squad,
                    },
                ],
                new Set(),
            );

            expect.soft(available).not.toContain("quest_damage_grenade_ltm");
            expect.soft(available).not.toContain("quest_damage_woods_king");
            expect.soft(available).toContain("quest_vending");
            expect.soft(available).toContain("quest_kills");
            expect.soft(available).toContain("quest_kills_harder");
        });

        test("Current quests excluded", () => {
            const available = questHelpers.getAvailableQuestsForModes(
                [
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Solo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Duo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Squad,
                    },
                ],
                new Set(["quest_vending"]),
            );

            expect.soft(available).not.toContain("quest_damage_grenade_ltm");
            expect.soft(available).not.toContain("quest_damage_woods_king");
            expect.soft(available).not.toContain("quest_vending");
            expect.soft(available).toContain("quest_kills");
            expect.soft(available).toContain("quest_kills_harder");
        });

        test("One cobalt map", () => {
            const available = questHelpers.getAvailableQuestsForModes(
                [
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Solo,
                    },
                    {
                        mapName: "cobalt",
                        enabled: true,
                        teamMode: TeamMode.Duo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Squad,
                    },
                ],
                new Set(["quest_vending"]),
            );

            expect.soft(available).toContain("quest_damage_grenade_ltm");
            expect.soft(available).not.toContain("quest_damage_grenade");
            expect.soft(available).not.toContain("quest_damage_woods_king");
            expect.soft(available).not.toContain("quest_vending");
            expect.soft(available).toContain("quest_kills");
            expect.soft(available).toContain("quest_kills_harder");

            expect.soft(available).not.toContain("quest_top_squad");
            expect.soft(available).not.toContain("quest_top_solo");
            expect.soft(available).toContain("quest_top_duo");
        });

        test("Honors exclusion group with current quest", () => {
            const available = questHelpers.getAvailableQuestsForModes(
                [
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Solo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Duo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Squad,
                    },
                ],
                new Set(["quest_kills"]),
            );

            expect.soft(available).not.toContain("quest_kills_hard");
        });

        test("Ignores exclusion groups of the rerolled quest", () => {
            const available = questHelpers.getAvailableQuestsForModes(
                [
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Solo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Duo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Squad,
                    },
                ],
                new Set(["quest_kills"]),
                "quest_kills",
            );

            expect.soft(available).toContain("quest_kills_hard");
        });

        test("Quest which is in exclusion group with rerolled and in group with other current quest is not available", () => {
            const available = questHelpers.getAvailableQuestsForModes(
                [
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Solo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Duo,
                    },
                    {
                        mapName: "main",
                        enabled: true,
                        teamMode: TeamMode.Squad,
                    },
                ],
                new Set(["quest_top_solo", "quest_top_duo"]),
                "quest_top_solo",
            );

            // still blocked by quest_top_duo
            expect.soft(available).not.toContain("quest_win_any");
        });
    });

    test("satisfiesMapFilter", () => {
        expect.soft(questHelpers.satisfiesMapFilter(["main"], {})).toBe(true);
        expect.soft(questHelpers.satisfiesMapFilter(["main"], { mapFilterType: "only_on", maps: ["main"] })).toBe(true);
        expect.soft(questHelpers.satisfiesMapFilter(["main", "desert"], { mapFilterType: "only_on", maps: ["main"] }))
            .toBe(true);
        expect.soft(
            questHelpers.satisfiesMapFilter(["main", "desert"], { mapFilterType: "only_on", maps: [MapId.Desert] }),
        ).toBe(true);
        expect.soft(
            questHelpers.satisfiesMapFilter(["main", "desert"], { mapFilterType: "all_except", maps: [MapId.Desert] }),
        ).toBe(false);
        expect.soft(
            questHelpers.satisfiesMapFilter(["main", "cobalt"], { mapFilterType: "all_except", maps: [MapId.Desert] }),
        ).toBe(true);
        expect.soft(
            questHelpers.satisfiesMapFilter(["main", "cobalt"], {
                mapFilterType: "all_except",
                maps: [MapId.Desert, MapId.Faction],
            }),
        ).toBe(true);
        expect.soft(
            questHelpers.satisfiesMapFilter(["woods_spring"], {
                mapFilterType: "all_except",
                maps: [MapId.Desert, "woods_spring"],
            }),
        ).toBe(false);
        expect.soft(
            questHelpers.satisfiesMapFilter(["desert"], {
                mapFilterType: "all_except",
                maps: [MapId.Desert, "woods_spring"],
            }),
        ).toBe(false);
        expect.soft(
            questHelpers.satisfiesMapFilter(["main", "cobalt"], {
                mapFilterType: "only_on",
                maps: [MapId.Desert, MapId.Faction],
            }),
        ).toBe(false);
    });

    test("hasMapMatch", () => {
        expect.soft(questHelpers.hasMapMatch(["main"], ["main"])).toBe(true);

        expect.soft(questHelpers.hasMapMatch(["main"], ["cobalt"])).toBe(false);

        expect.soft(questHelpers.hasMapMatch(["main", "desert"], ["main"])).toBe(true);
        expect.soft(questHelpers.hasMapMatch(["main", "desert"], ["woods"])).toBe(false);

        expect.soft(questHelpers.hasMapMatch(["main"], [MapId.Main])).toBe(true);

        expect.soft(questHelpers.hasMapMatch(["main"], [MapId.Faction])).toBe(false);

        expect.soft(questHelpers.hasMapMatch(["main", "desert"], [MapId.Main])).toBe(true);
        expect.soft(questHelpers.hasMapMatch(["main", "desert"], [MapId.Woods])).toBe(false);

        expect.soft(questHelpers.hasMapMatch(["main"], [MapId.Main, MapId.Woods])).toBe(true);
        expect.soft(questHelpers.hasMapMatch(["main"], ["main", "woods"])).toBe(true);

        expect.soft(questHelpers.hasMapMatch(["woods_spring"], [MapId.Main, MapId.Woods])).toBe(true);
        expect.soft(questHelpers.hasMapMatch(["woods_spring"], ["main", "woods"])).toBe(false);

        expect.soft(questHelpers.hasMapMatch(["faction_potato"], [MapId.Main, MapId.Woods])).toBe(false);
        expect.soft(questHelpers.hasMapMatch(["faction_potato"], ["main", "woods"])).toBe(false);
    });

    test("matchesFilter", () => {
        expect.soft(questHelpers.matchesFilter("beach", "beach")).toBe(true);
        expect.soft(questHelpers.matchesFilter("beach", "desert")).toBe(false);
        expect.soft(questHelpers.matchesFilter("main", MapId.Main)).toBe(true);
        expect.soft(questHelpers.matchesFilter("woods", MapId.Main)).toBe(false);
        expect.soft(questHelpers.matchesFilter("woods", MapId.Woods)).toBe(true);
        expect.soft(questHelpers.matchesFilter("woods_spring", MapId.Woods)).toBe(true);
    });
});
