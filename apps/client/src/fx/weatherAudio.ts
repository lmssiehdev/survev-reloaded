import { math } from "@survev/shared/utils/math.ts";
import { util } from "@survev/shared/utils/util.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";
import type { AudioManager } from "../audioManager.ts";
import type { SoundHandle } from "../lib/createJS.ts";

// Weather sound for the map effects. Mastered to the game's ambient level (mono, 32 kHz,
// around -45 LUFS). Quiet by default: beds swell in and out, everything else is a rare event
// from somewhere off screen.

const Beds = {
    rain: "fx_rain_loop",
    storm: "fx_storm_loop",
    roof: "fx_roof_rain_loop",
    crickets: "fx_crickets_loop",
};
type BedKey = keyof typeof Beds;
const BedKeys = Object.keys(Beds) as BedKey[];
const bedRecord = <T>(init: () => T) => Object.fromEntries(BedKeys.map((k) => [k, init()])) as Record<BedKey, T>;
export type BedLevels = Record<BedKey, number>;

const ThunderNear = ["fx_thunder_near_01", "fx_thunder_near_02"];
const ThunderFar = ["fx_thunder_far_01", "fx_thunder_far_02"];
const Gusts = ["fx_gust_01", "fx_gust_02", "fx_gust_03"];
// The game's own sounds, pitched down and pushed far away.
const Creaks = ["door_open_01", "door_open_02", "door_open_03"];
const Howl = "howl_01";
const Snap = "tree_break_01";

export interface Mood {
    wind: number;
    rain: number;
    storm: number;
    night: number;
    muffle: number;
}

interface EventDef {
    // Seconds between events at full strength; weaker moods space them out further.
    every: [number, number];
    strength: (m: Mood) => number;
    play: (m: Mood) => void;
    // Creepy events hush the crickets, so the silence lands before you place the sound.
    hush?: boolean;
}

export class WeatherAudio {
    inst = bedRecord((): SoundHandle | null => null);
    level: BedLevels = bedRecord(() => 0);
    // Each bed swells on its own offset so they never breathe in step.
    phase = bedRecord(() => Math.random() * 100);
    time = 0;
    hush = 0;
    chorus = { on: true, left: 12 };
    events: Array<EventDef & { wait: number }>;
    listener: Vec2 = { x: 0, y: 0 };

    constructor(public audio: AudioManager) {
        const load = (names: string[], channel: string, dir: string) => {
            for (const name of names) {
                audio.loadSound({ name, channel, path: `audio/${dir}/${name}.mp3`, options: { volume: 1 } });
            }
        };
        load([...Object.values(Beds), ...ThunderNear, ...ThunderFar, ...Gusts], "ambient", "ambient");
        // Gusts and far thunder also play positionally, which goes through the sfx channel.
        load([...Gusts, ...ThunderFar], "sfx", "ambient");
        load([...Creaks, Howl, Snap], "sfx", "sfx");

        const defs: EventDef[] = [
            {
                every: [7, 20],
                strength: (m) => math.clamp((m.wind - 0.4) / 1.1, 0, 1),
                play: (m) => this.positional(util.randomItem(Gusts), 24, 0.9 * (1 - 0.5 * m.muffle), -200, 150),
            },
            {
                // A far rumble now and then while it rains, with no flash to explain it.
                every: [45, 100],
                strength: (m) => m.rain * (1 - m.storm),
                play: (m) => this.positional(util.randomItem(ThunderFar), 30, 0.7 * (1 - 0.5 * m.muffle), -400, 0),
            },
            {
                every: [80, 170],
                strength: (m) => m.night * (1 - m.rain) * (1 - m.muffle),
                play: () => this.positional(Howl, 42, 0.35, -350, -50, true),
                hush: true,
            },
            {
                every: [50, 120],
                strength: (m) => m.night * (1 - 0.5 * m.rain),
                play: () => this.positional(util.randomItem(Creaks), 32, 0.4, -1000, -650, true),
                hush: true,
            },
            {
                every: [70, 150],
                strength: (m) => m.night * (1 - 0.6 * m.rain) * (1 - m.muffle),
                play: () => this.positional(Snap, 36, 0.35, -500, -200, true),
                hush: true,
            },
        ];
        this.events = defs.map((e) => ({ ...e, wait: util.random(e.every[0] * 0.3, e.every[1]) }));
    }

    // Plays a sound somewhere around the listener so it pans and falls off with distance.
    positional(name: string, dist: number, volume: number, detuneMin: number, detuneMax: number, muffled = false) {
        const ang = Math.random() * Math.PI * 2;
        this.audio.playSound(name, {
            channel: "sfx",
            soundPos: { x: this.listener.x + Math.cos(ang) * dist, y: this.listener.y + Math.sin(ang) * dist },
            volumeScale: volume,
            detune: util.random(detuneMin, detuneMax),
            filter: muffled ? "muffled" : "reverb",
            forceFilter: muffled,
        });
    }

    // Slow, uneven swell between 0.25 and 1 so beds breathe instead of droning.
    swell(key: BedKey) {
        const t = this.time + this.phase[key];
        const n = 0.5 + 0.3 * Math.sin(t * 0.11) + 0.2 * Math.sin(t * 0.047 + 1.3);
        return 0.25 + 0.75 * math.clamp(n, 0, 1);
    }

    update(dt: number, listener: Vec2, mood: Mood, target: BedLevels) {
        this.time += dt;
        this.listener = listener;
        this.hush = Math.max(0, this.hush - dt);

        // Crickets come and go in choruses rather than one endless loop.
        this.chorus.left -= dt;
        if (this.chorus.left <= 0) {
            this.chorus.on = !this.chorus.on;
            this.chorus.left = this.chorus.on ? util.random(10, 25) : util.random(8, 30);
        }

        for (const ev of this.events) {
            const s = ev.strength(mood);
            if (s <= 0.02) continue;
            ev.wait -= dt * s;
            if (ev.wait > 0) continue;
            ev.wait = util.random(ev.every[0], ev.every[1]);
            if (ev.hush) this.hush = util.random(8, 16);
            ev.play(mood);
        }

        for (const key of BedKeys) {
            let want = target[key] * this.swell(key);
            let rate = 0.6;
            if (key == "crickets") {
                want *= this.chorus.on && this.hush <= 0 ? 1 : 0;
                // They stop at once and come back slowly.
                rate = want < this.level[key] ? 5 : 0.25;
            }
            this.level[key] = math.lerp(1 - Math.exp(-dt * rate), this.level[key], want);
            const name = Beds[key];
            if (!this.inst[key] && this.audio.isSoundLoaded(name, "ambient")) {
                this.inst[key] = this.audio.playSound(name, {
                    channel: "ambient",
                    startSilent: true,
                    loop: true,
                    forceStart: true,
                });
            }
            const inst = this.inst[key];
            if (inst) this.audio.setVolume(inst, this.level[key], "ambient");
        }
    }

    // Sound travels slower than light: far strikes arrive later, quieter and lower.
    thunder(dist: number, muffle: number) {
        const near = dist < 0.4;
        this.audio.playSound(util.randomItem(near ? ThunderNear : ThunderFar), {
            channel: "ambient",
            delay: 150 + dist * 2600,
            volumeScale: (near ? 1 : 0.8 - 0.3 * dist) * (1 - 0.5 * muffle),
            detune: -dist * 300,
        });
    }

    free() {
        for (const key of BedKeys) {
            const inst = this.inst[key];
            if (inst) this.audio.stopSound(inst);
            this.inst[key] = null;
        }
    }
}
