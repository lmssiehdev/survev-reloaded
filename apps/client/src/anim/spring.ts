/** Springs are stiff enough to blow up on a long frame, so they step no coarser than this */
const maxStep = 1 / 30;

/** Damped spring toward zero, for anything that gets shoved and settles back */
export class Spring {
    pos = 0;
    vel = 0;

    constructor(
        public stiffness: number,
        public damping: number,
    ) {}

    /** Instant shove, moves the position so the motion starts on this frame */
    shove(impulse: number) {
        this.pos += impulse;
        this.vel += impulse * 8;
    }

    /** Shoves only as far as the room left below max, so a stream of them holds instead of piling up */
    shoveWithin(impulse: number, max: number) {
        this.shove(impulse * Math.max(1 - Math.abs(this.pos) / max, 0));
    }

    update(dt: number) {
        const step = Math.min(dt, maxStep);
        this.vel += (-this.pos * this.stiffness - this.vel * this.damping) * step;
        this.pos += this.vel * step;
    }

    settled() {
        return Math.abs(this.pos) < 0.001 && Math.abs(this.vel) < 0.01;
    }

    reset() {
        this.pos = 0;
        this.vel = 0;
    }
}
