import { math } from "@survev/shared/utils/math.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";
import type * as PIXI from "pixi.js-legacy";
import type { Layer } from "./animator.ts";
import type { GunFeel } from "./gunFeel.ts";
import type { MovePose } from "./move.ts";
import { Spring } from "./spring.ts";

/** Body pixels to a world unit */
const bodyPpu = 16;
const maxSquash = 0.22;
const maxGunSnap = 0.8;

/** Damage where a single hit reads as a full weight blow */
const fullHitDamage = 40;
const maxHitWeight = 1.3;
/** World units, the body never leaves its hitbox by more than this */
const maxHitKick = 0.5;
const maxHitTwist = 0.4;
/** Body pixels, hands stay on the body */
const maxHandKick = 11;
const maxHitSquash = 0.1;

/** Curved so small hits stay small and a big one is much more than a few small ones */
export function hitWeight(damage: number) {
    return Math.pow(Math.min(damage / fullHitDamage, maxHitWeight), 1.5);
}

/**
 * The procedural layer for shoves that come from events rather than clips: a gun's
 * recoil going back through the body, and hits knocking it the other way. It lives on
 * the Player and is put back in the animator whenever something shoves it, then drops
 * out once everything has settled.
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

    // Hits, world units with y up so they keep pointing along the blow as the body turns
    private hitKickX = new Spring(320, 19);
    private hitKickY = new Spring(320, 19);
    private hitTwist = new Spring(260, 15);
    private hitSquash = new Spring(620, 24);
    private handKickX = new Spring(420, 20);
    private handKickY = new Spring(420, 20);
    private hitDirX = 1;
    private hitDirY = 0;
    /** Recent hits, a stream of them gets a smaller reaction each */
    private rattle = 0;

    constructor(private body: PIXI.Container) {}

    /** Called when the layer goes back into the animator, whatever was left is stale */
    wake() {
        this.done = false;
        this.bodyKick.reset();
        this.climb.reset();
        this.squash = 0;
        this.gunSnap = 0;
        this.hitKickX.reset();
        this.hitKickY.reset();
        this.hitTwist.reset();
        this.hitSquash.reset();
        this.handKickX.reset();
        this.handKickY.reset();
        this.rattle = 0;
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

    /**
     * Knocked along the blow and turned by where it landed. dir is the way the blow
     * travels, lever the signed distance of the contact off the line through the
     * body's center. Returns how big the hit was after rapid fire is taken off.
     */
    hit(dir: Vec2, lever: number, damage: number) {
        const amount = hitWeight(damage) / (1 + this.rattle * 1.5);
        this.rattle += amount;
        this.hitDirX = dir.x;
        this.hitDirY = dir.y;

        const kick = 0.1 + amount * 0.5;
        this.hitKickX.shoveWithin(dir.x * kick, maxHitKick);
        this.hitKickY.shoveWithin(dir.y * kick, maxHitKick);
        const hand = 2.4 + amount * 7;
        this.handKickX.shoveWithin(dir.x * hand, maxHandKick);
        this.handKickY.shoveWithin(dir.y * hand, maxHandKick);
        this.hitSquash.shove(Math.min(amount * 0.12, maxHitSquash));

        // Off center hits turn the body the way they'd really push it, dead center ones pick a side
        let side = math.clamp(lever, -1, 1);
        if (Math.abs(lever) <= 0.2) side = Math.random() < 0.5 ? -0.6 : 0.6;
        this.hitTwist.shoveWithin(side * (0.05 + amount * 0.16), maxHitTwist);
        return amount;
    }

    update(dt: number) {
        this.bodyKick.update(dt);
        this.climb.update(dt);
        this.squash = Math.max(this.squash - this.squash * dt * 14 - dt * 0.01, 0);
        this.gunSnap = Math.max(this.gunSnap - this.gunSnap * this.gunSettle * dt - dt * 0.01, 0);
        this.hitKickX.update(dt);
        this.hitKickY.update(dt);
        this.hitTwist.update(dt);
        this.hitSquash.update(dt);
        this.handKickX.update(dt);
        this.handKickY.update(dt);
        this.rattle = Math.max(this.rattle - this.rattle * dt * 5, 0);
        this.done = this.bodyKick.settled() && this.climb.settled() && this.squash == 0 && this.gunSnap == 0
            && this.hitKickX.settled() && this.hitKickY.settled() && this.hitTwist.settled()
            && this.hitSquash.settled() && this.handKickX.settled() && this.handKickY.settled();
    }

    pose(into: MovePose) {
        into.bodyX += this.bodyKick.pos;
        into.bodyRot -= this.climb.pos;
        into.squash += this.squash;
        // The gun lifts around the grip and the off hand stays on it
        into.gunRot -= this.gunSnap;
        into.handLY -= this.gunSnap * bodyPpu;

        // World (y up) into the body frame, which is screen space (y down) turned by the aim
        const cos = Math.cos(this.body.rotation);
        const sin = Math.sin(this.body.rotation);
        const kickX = this.hitKickX.pos * bodyPpu;
        const kickY = -this.hitKickY.pos * bodyPpu;
        into.bodyX += kickX * cos + kickY * sin;
        into.bodyY += kickY * cos - kickX * sin;
        into.bodyRot -= this.hitTwist.pos;

        const handX = this.handKickX.pos;
        const handY = -this.handKickY.pos;
        const handLocalX = handX * cos + handY * sin;
        const handLocalY = handY * cos - handX * sin;
        into.handLX += handLocalX;
        into.handLY += handLocalY;
        into.handRX += handLocalX;
        into.handRY += handLocalY;

        // Squashes along the line of the blow, bulges across it
        const along = this.hitDirX * cos - this.hitDirY * sin;
        const across = 1 - along * along;
        into.squash += this.hitSquash.pos * (along * along - 0.6 * across);
    }
}
