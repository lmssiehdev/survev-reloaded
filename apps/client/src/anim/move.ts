/**
 * A move is a short additive animation layered on top of whatever the Player is
 * already doing. Every channel is in the body's own frame: x points down the aim,
 * y is the right hand side, units are body pixels (16 to a world unit) and rotations
 * are radians, positive turning clockwise on screen. Zero is "no change", so moves
 * stack by adding their poses.
 */
export const CHANNELS = [
    /** Whole body, the hitbox, so keep these small */
    "bodyX",
    "bodyY",
    "bodyRot",
    /** Positive squashes along the aim and bulges sideways */
    "squash",
    /** Full turns of the body, for rolls and spins */
    "spin",
    /** Both hands and the weapon as one piece */
    "rigX",
    "rigY",
    /** Swings the hands and weapon around the body's center */
    "rigRot",
    /** Recoil flip: the weapon turns in the grip hand and the support hand rides along */
    "flip",
    /** Turns just the weapon or blade in the hand */
    "gunRot",
    "handLX",
    "handLY",
    "handRX",
    "handRY",
] as const;
export type Channel = (typeof CHANNELS)[number];
export type MovePose = Record<Channel, number>;

/** How a key is reached from the one before it */
export type Ease = "linear" | "in" | "out" | "inOut" | "snap" | "back";

const eases: Record<Ease, (x: number) => number> = {
    linear: (x) => x,
    in: (x) => x * x * x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    /** Gets almost all the way on the first frames, the shape of a recoil kick */
    snap: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -12 * x)),
    /** Overshoots then settles */
    back: (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2),
};

export interface Key {
    t: number;
    v: number;
    ease: Ease;
}

/**
 * A pop out and back. Beats in one track add up: one that lands before the last
 * one settled starts from where that one is.
 */
export interface Beat {
    /** When it starts */
    at: number;
    /** How far it goes */
    to: number;
    /** Time to reach it */
    attack: number;
    /** Time to come back to rest, 0 stays there */
    settle: number;
    attackEase: Ease;
    settleEase: Ease;
}

/** Either a path through keyed values or a list of beats, evaluated as they are */
export type Track = { keys: Key[] } | { beats: Beat[] };

export interface Move {
    duration: number;
    tracks: Partial<Record<Channel, Track>>;
}

export function emptyPose(): MovePose {
    return {
        bodyX: 0,
        bodyY: 0,
        bodyRot: 0,
        squash: 0,
        spin: 0,
        rigX: 0,
        rigY: 0,
        rigRot: 0,
        flip: 0,
        gunRot: 0,
        handLX: 0,
        handLY: 0,
        handRX: 0,
        handRY: 0,
    };
}

export function clearPose(pose: MovePose) {
    for (const channel of CHANNELS) pose[channel] = 0;
}

/** A path through values: [time, value, ease into it] */
export function path(...keys: Array<[number, number, Ease?]>): Track {
    return { keys: keys.map(([t, v, ease]) => ({ t, v, ease: ease ?? "inOut" })) };
}

export function beats(...list: Beat[]): Track {
    return { beats: list };
}

/** A kick that snaps out and eases back, recoil in one line */
export function kick(at: number, to: number, settle = 0.25, attack = 0.035): Beat {
    return { at, to, attack, settle, attackEase: "snap", settleEase: "back" };
}

function sampleKeys(keys: Key[], t: number) {
    if (t <= keys[0].t) return keys[0].v;
    for (let i = 1; i < keys.length; i++) {
        const b = keys[i];
        if (t > b.t) continue;
        const a = keys[i - 1];
        const x = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return a.v + (b.v - a.v) * eases[b.ease](x);
    }
    return keys[keys.length - 1].v;
}

function beatValue(beat: Beat, t: number) {
    if (t <= beat.at) return 0;
    const up = beat.attack > 0 ? Math.min((t - beat.at) / beat.attack, 1) : 1;
    const value = beat.to * eases[beat.attackEase](up);
    if (beat.settle <= 0 || up < 1) return value;
    const down = Math.min((t - beat.at - beat.attack) / beat.settle, 1);
    return beat.to - beat.to * eases[beat.settleEase](down);
}

function sampleTrack(track: Track, t: number) {
    if ("keys" in track) return sampleKeys(track.keys, t);
    let v = 0;
    for (const beat of track.beats) v += beatValue(beat, t);
    return v;
}

/** Adds the move's pose at time t, scaled by weight, into a pose */
export function sampleInto(move: Move, t: number, weight: number, into: MovePose) {
    for (const channel of CHANNELS) {
        const track = move.tracks[channel];
        if (track) into[channel] += sampleTrack(track, t) * weight;
    }
}
