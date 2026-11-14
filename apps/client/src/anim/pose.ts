import { math } from "@survev/shared/utils/math.ts";
import type * as PIXI from "pixi.js-legacy";
import type { Player } from "../objects/player.ts";
import type { MovePose } from "./move.ts";

/** Half a world unit, keeps the drawn body inside its hitbox */
const maxBodyOffset = 8;

function swingHand(hand: PIXI.Container, pose: MovePose, cos: number, sin: number) {
    const x = hand.position.x;
    const y = hand.position.y;
    hand.position.set(x * cos - y * sin + pose.rigX, x * sin + y * cos + pose.rigY);
    hand.rotation += pose.rigRot;
}

/**
 * Puts a pose onto a Player that updateRotation has already posed for this frame.
 * The hands, the body's rotation and the melee sprite while it's shown are set fresh
 * every frame by then, so those are added to. The body's position and scale and the guns' rotation
 * are not, so they are set from their rest values here; a zero pose puts them back.
 */
export function applyPose(player: Player, pose: MovePose) {
    const body = player.bodyContainer;
    const angle = body.rotation;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const offsetX = math.clamp(pose.bodyX, -maxBodyOffset, maxBodyOffset);
    const offsetY = math.clamp(pose.bodyY, -maxBodyOffset, maxBodyOffset);
    body.position.set(offsetX * cos - offsetY * sin, offsetX * sin + offsetY * cos);
    body.rotation += pose.bodyRot + pose.spin * Math.PI * 2;
    body.scale.set(player.bodyScale * (1 - pose.squash), player.bodyScale * (1 + pose.squash * 0.7));

    // Melee poses place hands with a pivot and a rotation, not just a position. Turning
    // the position and adding to the rotation swings the whole hand, and whatever it
    // holds, rigidly around the body's center either way.
    const rigCos = Math.cos(pose.rigRot);
    const rigSin = Math.sin(pose.rigRot);
    swingHand(player.handLContainer, pose, rigCos, rigSin);
    swingHand(player.handRContainer, pose, rigCos, rigSin);

    // The support hand stays on the gun as it flips around the grip
    if (pose.flip != 0) {
        const grip = player.handRContainer.position;
        const hand = player.handLContainer.position;
        const flipCos = Math.cos(pose.flip);
        const flipSin = Math.sin(pose.flip);
        const dx = hand.x - grip.x;
        const dy = hand.y - grip.y;
        hand.set(grip.x + dx * flipCos - dy * flipSin, grip.y + dx * flipSin + dy * flipCos);
    }
    player.handLContainer.position.x += pose.handLX;
    player.handLContainer.position.y += pose.handLY;
    player.handRContainer.position.x += pose.handRX;
    player.handRContainer.position.y += pose.handRY;

    const gunR = player.gunRSprites;
    const gunL = player.gunLSprites;
    gunR.container.rotation = gunR.restRotation + pose.flip + pose.gunRot;
    gunL.container.rotation = gunL.restRotation - pose.flip - pose.gunRot;
    player.meleeSprite.rotation += pose.gunRot;
}
