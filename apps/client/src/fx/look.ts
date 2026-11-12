import { math } from "@survev/shared/utils/math.ts";

// One look per frame. Time of day picks a keyframe, weather bends it, and every effect reads
// from the result: the lightmap clears to `ambient`, shadows and the grade's dark floor use
// `shade`, fog uses `fog`. No effect gets its own tint, which is what keeps them one image.

export type RGB = [number, number, number];

interface LookKey {
    hour: number;
    // Light falling on the world, multiplied over it. White is plain daylight.
    ambient: RGB;
    // Where darks sink to instead of black: cool by day, deep blue at night.
    shade: RGB;
    sat: number;
    contrast: number;
    // 0 by day, 1 at night; drives lanterns, crickets and cloud visibility.
    night: number;
}

const Night: Omit<LookKey, "hour"> = {
    ambient: [0.34, 0.4, 0.62],
    shade: [0.04, 0.06, 0.16],
    sat: 0.62,
    contrast: 1.06,
    night: 1,
};
const Day: Omit<LookKey, "hour"> = {
    ambient: [1, 1, 1],
    shade: [0.1, 0.16, 0.32],
    sat: 1.05,
    contrast: 1.04,
    night: 0,
};

const TimeKeys: LookKey[] = [
    { hour: 0, ...Night },
    { hour: 5, ...Night, ambient: [0.36, 0.4, 0.6] },
    { hour: 6.5, ambient: [0.96, 0.8, 0.74], shade: [0.2, 0.14, 0.28], sat: 0.95, contrast: 1.03, night: 0.3 },
    { hour: 8, ...Day },
    { hour: 16.5, ...Day },
    // Golden hour keeps blue in the light: multiplying it out turns green grass to mud.
    { hour: 18.3, ambient: [1.0, 0.91, 0.8], shade: [0.22, 0.12, 0.32], sat: 1.15, contrast: 1.05, night: 0.1 },
    { hour: 19.5, ambient: [0.74, 0.64, 0.82], shade: [0.12, 0.06, 0.22], sat: 0.9, contrast: 1.05, night: 0.6 },
    { hour: 20.6, ...Night },
    { hour: 24, ...Night },
];

// Heavy weather pulls the light toward this cool grey instead of drawing a tint on top.
const StormLight: RGB = [0.62, 0.68, 0.82];

export interface WeatherBend {
    gloom: number;
    fog: number;
    flash: number;
}

export interface Look {
    ambient: RGB;
    shade: RGB;
    fog: RGB;
    sat: number;
    contrast: number;
    night: number;
    // Sun height, 0 at the horizon to 1 at noon.
    sunElev: number;
}

const lerp3 = (t: number, a: RGB, b: RGB) => [0, 1, 2].map((k) => math.lerp(t, a[k], b[k])) as RGB;

export const rgbToHex = (c: RGB) =>
    (Math.round(math.clamp(c[0], 0, 1) * 255) << 16)
    | (Math.round(math.clamp(c[1], 0, 1) * 255) << 8)
    | Math.round(math.clamp(c[2], 0, 1) * 255);

export function sampleLook(hour: number, bend: WeatherBend | null): Look {
    let i = 0;
    while (i < TimeKeys.length - 2 && TimeKeys[i + 1].hour <= hour) i++;
    const a = TimeKeys[i];
    const b = TimeKeys[i + 1];
    const t = math.smoothstep(math.clamp((hour - a.hour) / (b.hour - a.hour), 0, 1), 0, 1);
    let ambient = lerp3(t, a.ambient, b.ambient);
    let sat = math.lerp(t, a.sat, b.sat);
    let contrast = math.lerp(t, a.contrast, b.contrast);
    const sunElev = Math.sin(Math.PI * math.clamp((hour - 5.5) / 14, 0, 1));

    if (bend) {
        const g = math.clamp(bend.gloom / 0.45, 0, 1);
        ambient = ambient.map((c, k) => c * math.lerp(g, 1, StormLight[k])) as RGB;
        sat *= 1 - 0.3 * g - 0.25 * bend.fog;
        contrast *= 1 - 0.08 * bend.fog;
    }
    // Fog is the scene's own light, washed out, so it sits inside the palette.
    const l = (ambient[0] + ambient[1] + ambient[2]) / 3;
    const fog = lerp3(0.35, [l, l, l], ambient).map((c) => c * 0.72 + 0.1) as RGB;
    if (bend && bend.flash > 0) ambient = lerp3(bend.flash, ambient, [1, 1, 1]);

    return {
        ambient,
        shade: lerp3(t, a.shade, b.shade),
        fog,
        sat,
        contrast,
        night: math.lerp(t, a.night, b.night),
        sunElev,
    };
}
