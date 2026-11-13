import type { BitStream } from "../net/net.ts";

// Map effects (lighting, shadows, weather...). Each map def picks its own in `biome.fx`; the
// game server rolls one setup per match and sends it to clients when they join, so everyone in
// a match sees the same time of day and weather.

export const FxEffects = ["light", "sway", "shadow", "weather", "grade"] as const;
export type FxEffect = (typeof FxEffects)[number];

export const WeatherNames = ["clear", "windy", "rain", "storm", "fog"] as const;
export type WeatherName = (typeof WeatherNames)[number];

export interface MapFxDef {
    effects: FxEffect[];
    /** hour of day the match starts at, 0 to 24 */
    startHour: number;
    /** seconds for a full day to pass, 0 freezes the clock */
    dayLength: number;
    /** one is picked per match, weighted like airdrop crates */
    weather: Array<{ name: WeatherName; weight: number }>;
}

/** the setup a match settled on, as of the moment it is sent */
export interface MatchFx {
    effects: FxEffect[];
    hour: number;
    dayLength: number;
    weather: WeatherName;
}

export const NoFx: MatchFx = { effects: [], hour: 15, dayLength: 0, weather: "clear" };

export function serializeMatchFx(s: BitStream, fx: MatchFx) {
    let mask = 0;
    for (const effect of fx.effects) mask |= 1 << FxEffects.indexOf(effect);
    s.writeBits(mask, FxEffects.length);
    s.writeUint8(WeatherNames.indexOf(fx.weather));
    s.writeFloat(fx.hour, 0, 24, 16);
    s.writeUint16(fx.dayLength);
}

export function deserializeMatchFx(s: BitStream): MatchFx {
    const mask = s.readBits(FxEffects.length);
    return {
        effects: FxEffects.filter((_, i) => mask & (1 << i)),
        weather: WeatherNames[s.readUint8()] ?? "clear",
        hour: s.readFloat(0, 24, 16),
        dayLength: s.readUint16(),
    };
}
