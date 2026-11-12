/** Longest a single hit stop can be, seconds */
const maxHitStop = 0.1;
/** How fast visuals run during a hit stop, a near freeze */
const frozenScale = 0.06;

/**
 * A short freeze on kills and heavy hits that the active player is part of. Visual
 * only: it slows the animator's layers and the particles and nothing else. Input,
 * netcode, positions, the server timed hand keyframes and the camera all keep real time.
 */
class HitStop {
    private left = 0;
    /** Multiplier for visual time steps this frame */
    scale = 1;

    add(seconds: number) {
        this.left = Math.max(this.left, Math.min(seconds, maxHitStop));
    }

    /** Once a frame, before anything uses scale */
    update(dt: number) {
        this.scale = this.left > 0 ? frozenScale : 1;
        this.left = Math.max(this.left - dt, 0);
    }

    reset() {
        this.left = 0;
        this.scale = 1;
    }
}

export const hitStop = new HitStop();
