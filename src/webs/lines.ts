// Two independent lines (SPEC §4.2, §5.1): ballistic web stream / attach / release, per-hand reel,
// elastic rope.

import * as THREE from 'three';
import { LINES } from '../config/gameplay';
import type { Physics } from '../core/physics';
import type { InputSnapshot } from '../input/input';
import type { Hand, PlayerState } from '../player/state';
import type RAPIER from '@dimforge/rapier3d-compat';
import { launchVelocity, stepTip } from './ballistics';

const FIRE: ['fireLeft', 'fireRight'] = ['fireLeft', 'fireRight'];
const REEL: ['reelLeft', 'reelRight'] = ['reelLeft', 'reelRight'];

const radial = new THREE.Vector3();

export function anyAttached(p: PlayerState): boolean {
  return p.lines[0].kind === 'attached' || p.lines[1].kind === 'attached';
}

export function isTaut(p: PlayerState, hand: Hand): boolean {
  const l = p.lines[hand];
  return l.kind === 'attached' && p.pos.distanceTo(l.target) >= l.length * 0.995;
}

/** Fire/hold/release + reel input. Runs before movement each tick. */
export function updateLines(
  p: PlayerState, input: InputSnapshot, eye: THREE.Vector3, aim: THREE.Vector3,
  physics: Physics, self: RAPIER.Collider, dt: number,
): void {
  for (const hand of [0, 1] as Hand[]) {
    const l = p.lines[hand];
    l.reel = 0;

    if (input.pressed[FIRE[hand]] && l.kind === 'idle') {
      // Start a stream: the tip leaves just in front of the eyes and flies ballistically
      l.kind = 'firing';
      l.target.copy(eye).addScaledVector(aim, 0.4);
      launchVelocity(l.tipVel, aim, p.vel);
      l.flightTime = 0;
      p.events.push({ type: 'fire', hand });
    }

    if (!input.down[FIRE[hand]] && l.kind !== 'idle') {
      if (l.kind === 'attached') releaseBoost(p, hand);
      l.kind = 'idle';
      p.events.push({ type: 'release', hand });
      continue;
    }

    switch (l.kind) {
      case 'firing': {
        l.flightTime += dt;
        if (l.flightTime > LINES.maxFlightTime) break; // keeps streaming visually, no more hit tests
        const hit = stepTip(l.target, l.tipVel, dt, physics, self);
        if (hit) {
          l.kind = 'attached';
          l.target.copy(hit.point);
          l.length = THREE.MathUtils.clamp(p.pos.distanceTo(l.target) * LINES.attachLengthFactor, LINES.minLength, LINES.maxLength);
          p.events.push({ type: 'attach', hand });
        }
        break;
      }
      case 'attached':
        if (input.down[REEL[hand]]) {
          if (input.down.modifier) {
            l.length = Math.min(LINES.maxLength, l.length + LINES.letOutSpeed * dt);
            l.reel = -1;
          } else {
            const dL = Math.min(LINES.reelInSpeed * dt, l.length - LINES.minLength);
            if (dL > 0) {
              l.length -= dL;
              l.reel = 1;
            }
          }
        }
        break;
    }
  }
}

function releaseBoost(p: PlayerState, hand: Hand): void {
  const other = p.lines[hand === 0 ? 1 : 0];
  if (other.kind === 'attached' || p.vel.lengthSq() < 4) return;
  const speed = p.vel.length();
  p.vel.multiplyScalar((speed + LINES.releaseBoost) / speed);
  if (p.vel.y > 0) p.vel.y += LINES.releaseUpBoost;
}

/**
 * Elastic lines (SPEC §4.2): each attached line is a one-sided spring-damper. It pulls only when
 * stretched beyond its rest length, never pushes. Stiffness scales with 1/length (like a real
 * elastic cord), so a given load gives the same *percentage* stretch on long and short lines.
 * The forces are central, so angular momentum is conserved and reeling a loaded line in still
 * spins you faster. A hard velocity-level stop at `maxStretch` keeps lines from stretching forever.
 */
export function solveRopes(p: PlayerState, dt: number): void {
  for (const hand of [0, 1] as Hand[]) {
    const l = p.lines[hand];
    l.tension = 0;
    if (l.kind !== 'attached') continue;
    radial.subVectors(p.pos, l.target);
    const d = radial.length();
    if (d <= l.length || d < 1e-4) continue; // slack
    radial.divideScalar(d);
    const vr = p.vel.dot(radial); // + = moving away from the anchor

    // Spring-damper pull
    const k = LINES.elasticity / l.length;
    const c = 2 * LINES.dampingRatio * Math.sqrt(k);
    const accel = Math.max(0, k * (d - l.length) + c * vr);
    p.vel.addScaledVector(radial, -accel * dt);
    l.tension = accel;

    // Hard stop: never stretch past maxStretch
    const limit = l.length * (1 + LINES.maxStretch);
    if (d > limit) {
      const bias = Math.min(((d - limit) * LINES.driftCorrection) / dt, LINES.maxCorrectionSpeed);
      const v = p.vel.dot(radial);
      if (v > -bias) p.vel.addScaledVector(radial, -bias - v);
    }
  }
}
