import { util } from "@survev/shared/utils/util.ts";
import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import type { ParticleBarn } from "./particles.ts";
import type { Player } from "./player.ts";

/*
 * Body effects in survev's own particle language: a few flat, simple particles plus
 * motion, holding full alpha and fading at the end. A white flare is on screen for a
 * frame or two at the moment of impact.
 */

function emit(
    particleBarn: ParticleBarn,
    type: string,
    player: Player,
    pos: Vec2,
    dir: Vec2,
    count: number,
    speed: [number, number],
    spread: number,
    zOrd: number,
    color?: number,
) {
    for (let i = 0; i < count; i++) {
        const vel = v2.mul(v2.rotate(dir, (Math.random() - 0.5) * spread), util.random(speed[0], speed[1]));
        const particle = particleBarn.addParticle(
            type,
            player.layer,
            pos,
            vel,
            1,
            Math.random() * Math.PI * 2,
            null,
            zOrd,
        );
        if (color !== undefined) particle.setColor(color);
    }
}

/**
 * Where a bullet or blade lands on a body: a chip of skin, or steel sparks off a
 * blade, flying back along the blow, and the impact flare.
 */
export function playBodyHitFx(particleBarn: ParticleBarn, player: Player, at: Vec2, dir: Vec2, blade: boolean) {
    const zOrd = player.renderZOrd + 1;
    const back = v2.neg(dir);
    if (blade) {
        emit(particleBarn, "bodyHitSpark", player, at, back, util.randomInt(2, 3), [8, 12], Math.PI / 3.5, zOrd);
    } else {
        emit(
            particleBarn,
            "bodyHitChip",
            player,
            at,
            back,
            util.randomInt(1, 2),
            [9.5, 9.5],
            Math.PI / 3,
            zOrd,
            player.skinTint,
        );
    }
    particleBarn.addParticle("bodyHitFlash", player.layer, at, v2.create(0, 0), blade ? 0.8 : 1, 0, null, zOrd);
}

/** A body breaking like an obstacle does: torn skin and blood thrown mostly along the killing blow */
export function playDeathPopFx(particleBarn: ParticleBarn, player: Player, dir: Vec2) {
    const pos = player.m_visualPos;
    const zOrd = player.renderZOrd + 1;
    particleBarn.addParticle(
        "deathPopSplat",
        player.layer,
        pos,
        v2.create(0, 0),
        1,
        Math.random() * Math.PI * 2,
        null,
        player.renderZOrd - 1,
    );
    emit(
        particleBarn,
        "deathPopScrap",
        player,
        pos,
        dir,
        util.randomInt(6, 8),
        [6, 15],
        Math.PI * 1.4,
        zOrd,
        player.skinTint,
    );
    emit(particleBarn, "deathPopChip", player, pos, dir, util.randomInt(3, 4), [6, 12], Math.PI * 1.4, zOrd);
    particleBarn.addParticle("deathPopFlash", player.layer, pos, v2.create(0, 0), 1, 0, null, zOrd);
}

export function playStepDustFx(particleBarn: ParticleBarn, player: Player, moveDir: Vec2) {
    emit(
        particleBarn,
        "stepDust",
        player,
        player.m_visualPos,
        v2.neg(moveDir),
        2,
        [0.6, 1.2],
        1.2,
        player.renderZOrd - 1,
    );
}
