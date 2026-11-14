import type { Modifier } from "./animator.ts";
import type { MovePose } from "./move.ts";

/**
 * Secondary motion: the weapon trails behind fast turns of the pose and whips past
 * when they stop. Heavier weapons lag more and settle slower. Nothing in a clip has
 * to key it.
 */
export class WeaponDrag implements Modifier {
    private lastAngle: number | null = null;
    private lag = 0;
    private vel = 0;

    /** weight: 0 is weightless, 1 a machete, 2 a sledgehammer */
    constructor(
        public weight = 1,
        private max = 0.7,
    ) {}

    reset() {
        this.lastAngle = null;
        this.lag = 0;
        this.vel = 0;
    }

    settled() {
        return Math.abs(this.lag) < 0.001 && Math.abs(this.vel) < 0.01;
    }

    pose(dt: number, into: MovePose) {
        if (dt <= 0) {
            into.gunRot += this.lag;
            return;
        }
        // Its own output goes into gunRot, so only the turns it trails are read
        const angle = into.bodyRot + into.spin * Math.PI * 2 + into.rigRot;
        const turn = this.lastAngle == null ? 0 : (angle - this.lastAngle) / dt;
        this.lastAngle = angle;

        // A spring pulled toward lagging behind the turn rate. Stepped no coarser than
        // 30 fps so a long frame can't make it blow up.
        const step = Math.min(dt, 1 / 30);
        const stiffness = 260 / (0.6 + this.weight);
        const damping = 16 / Math.sqrt(0.6 + this.weight);
        const want = -turn * 0.012 * this.weight;
        this.vel += ((want - this.lag) * stiffness - this.vel * damping) * step;
        this.lag += this.vel * step;
        this.lag = Math.max(-this.max, Math.min(this.max, this.lag));
        into.gunRot += this.lag;
    }
}
