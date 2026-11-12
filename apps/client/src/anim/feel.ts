import type { Layer } from "./animator.ts";
import type { GunFeel } from "./gunFeel.ts";
import type { MovePose } from "./move.ts";
import { Spring } from "./spring.ts";

/** Body pixels to a world unit */
const bodyPpu = 16;
const maxSquash = 0.22;
const maxGunSnap = 0.8;

/**
 * The procedural layer for shoves that come from events rather than clips: a gun's
 * recoil going back through the body. It lives on the Player and is put back in the
 * animator whenever something shoves it, then drops out once everything has settled.
 */
export class FeelLayer implements Layer {
    done = true;
    /** Body pixels along the aim */
    private bodyKick = new Spring(180, 18);
    /** Radians, counterclockwise */
    private climb = new Spring(200, 20);
    private squash = 0;
    private gunSnap = 0;
    private gunSettle = 20;

    /** Called when the layer goes back into the animator, whatever was left is stale */
    wake() {
        this.done = false;
        this.bodyKick.reset();
        this.climb.reset();
        this.squash = 0;
        this.gunSnap = 0;
    }

    shot(feel: GunFeel) {
        this.bodyKick.stiffness = feel.stiffness;
        this.bodyKick.shove(-feel.bodyKick * bodyPpu);
        // Mostly climbs one way, now and then the other so fast guns don't just walk up
        this.climb.shove(feel.climb * (Math.random() < 0.8 ? 1 : -0.6));
        this.squash = Math.min(this.squash + feel.power * 0.14, maxSquash);
        this.gunSnap = Math.min(this.gunSnap + feel.gunSnap, maxGunSnap);
        this.gunSettle = feel.gunSettle;
    }

    update(dt: number) {
        this.bodyKick.update(dt);
        this.climb.update(dt);
        this.squash = Math.max(this.squash - this.squash * dt * 14 - dt * 0.01, 0);
        this.gunSnap = Math.max(this.gunSnap - this.gunSnap * this.gunSettle * dt - dt * 0.01, 0);
        this.done = this.bodyKick.settled() && this.climb.settled() && this.squash == 0 && this.gunSnap == 0;
    }

    pose(into: MovePose) {
        into.bodyX += this.bodyKick.pos;
        into.bodyRot -= this.climb.pos;
        into.squash += this.squash;
        // The gun lifts around the grip and the off hand stays on it
        into.gunRot -= this.gunSnap;
        into.handLY -= this.gunSnap * bodyPpu;
    }
}
