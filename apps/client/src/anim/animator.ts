import type { Player } from "../objects/player.ts";
import { clearPose, emptyPose, type Move, type MovePose, sampleInto } from "./move.ts";
import { applyPose } from "./pose.ts";

/*
 * The animator layers moves on top of the Player's own pose, in this order:
 *   1. layers    clips (data) and procedural layers (code), added up by weight
 *   2. modifiers read the summed pose and change it, like weapon drag
 *   3. apply     the pose goes onto the Player's containers
 * Anything data can't express is a layer or a modifier, written in code.
 */

export interface Layer {
    done: boolean;
    update(dt: number): void;
    pose(into: MovePose): void;
}

export interface Modifier {
    /** Runs on the summed pose before it goes on the Player */
    pose(dt: number, into: MovePose): void;
    /** Nothing left to add without new input, the animator can go to sleep */
    settled(): boolean;
    /** Back to rest, called when the animator goes to sleep */
    reset(): void;
}

export interface PlayOpts {
    fadeIn?: number;
    fadeOut?: number;
}

/** Plays a Move once */
export class ClipLayer implements Layer {
    t = 0;
    weight: number;
    done = false;
    private fading = false;
    private fadeOutLeft = 0;
    private fadeOutTotal = 0;
    private weightAtStop = 0;

    constructor(
        public move: Move,
        private opts: PlayOpts = {},
    ) {
        this.weight = (opts.fadeIn ?? 0) > 0 ? 0 : 1;
    }

    /** Lets the clip blend away instead of cutting */
    stop(fadeOut = this.opts.fadeOut ?? 0) {
        if (this.fading) return;
        if (fadeOut <= 0) {
            this.done = true;
            return;
        }
        this.fading = true;
        this.fadeOutLeft = fadeOut;
        this.fadeOutTotal = fadeOut;
        this.weightAtStop = this.weight;
    }

    update(dt: number) {
        this.t += dt;
        if (this.fading) {
            this.fadeOutLeft -= dt;
            this.weight = Math.max(this.weightAtStop * this.fadeOutLeft / this.fadeOutTotal, 0);
            if (this.weight <= 0.001) this.done = true;
            return;
        }
        const fadeIn = this.opts.fadeIn ?? 0;
        if (fadeIn > 0) {
            this.weight = Math.min(this.t / fadeIn, 1);
        }
        if (this.t >= this.move.duration) this.stop();
    }

    pose(into: MovePose) {
        sampleInto(this.move, Math.min(this.t, this.move.duration), this.weight, into);
    }
}

/** A layer written in code: gets its own running time and writes into the pose */
export class ProcLayer implements Layer {
    t = 0;
    weight = 1;
    done = false;

    constructor(private fn: (t: number, weight: number, into: MovePose) => void | "done") {}

    update(dt: number) {
        this.t += dt;
    }

    pose(into: MovePose) {
        if (this.fn(this.t, this.weight, into) == "done") this.done = true;
    }
}

/**
 * Created the first time a Player plays a move. While asleep the Player doesn't call
 * it, so idle players cost nothing.
 */
export class Animator {
    layers: Layer[] = [];
    readonly pose = emptyPose();
    awake = false;

    constructor(
        private player: Player,
        public modifiers: Modifier[] = [],
    ) {}

    play(move: Move, opts: PlayOpts = {}) {
        const layer = new ClipLayer(move, opts);
        this.add(layer);
        return layer;
    }

    add(layer: Layer) {
        this.layers.push(layer);
        this.awake = true;
    }

    /** Blends every clip away */
    stop(fadeOut: number) {
        for (const layer of this.layers) {
            if (layer instanceof ClipLayer) layer.stop(fadeOut);
        }
    }

    /** Drops everything at once and puts the Player back at rest */
    clear() {
        for (const layer of this.layers) layer.done = true;
        this.layers.length = 0;
        this.sleep();
    }

    /** Call after updateRotation has posed the Player for this frame */
    update(dt: number) {
        let kept = 0;
        for (const layer of this.layers) {
            layer.update(dt);
            if (!layer.done) this.layers[kept++] = layer;
        }
        this.layers.length = kept;

        clearPose(this.pose);
        for (const layer of this.layers) layer.pose(this.pose);
        let settled = kept == 0;
        for (const modifier of this.modifiers) {
            modifier.pose(dt, this.pose);
            settled &&= modifier.settled();
        }
        if (settled) {
            this.sleep();
            return;
        }
        applyPose(this.player, this.pose);
    }

    private sleep() {
        for (const modifier of this.modifiers) modifier.reset();
        clearPose(this.pose);
        applyPose(this.player, this.pose);
        this.awake = false;
    }
}
