// Two independent lines (SPEC §4.2): fire / attach / miss / release, per-hand reel, rope constraint.

import * as THREE from 'three';
import { LINES } from '../config/gameplay';
import type { Physics } from '../core/physics';
import type { InputSnapshot } from '../input/input';
import type { Hand, PlayerState } from '../player/state';
import type RAPIER from '@dimforge/rapier3d-compat';

const FIRE: ['fireLeft', 'fireRight'] = ['fireLeft', 'fireRight'];
const REEL: ['reelLeft', 'reelRight'] = ['reelLeft', 'reelRight'];

const tmp = new THREE.Vector3();
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

    if (input.pressed[FIRE[hand]] && (l.kind === 'idle' || l.kind === 'missed' || l.kind === 'retracting')) {
      const hit = physics.raycast(eye, aim, LINES.maxRange, self);
      l.kind = 'firing';
      l.hit = !!hit;
      l.target.copy(hit ? hit.point : tmp.copy(aim).multiplyScalar(LINES.maxRange).add(eye));
      l.progress = 0;
      l.travelTime = Math.max(0.02, eye.distanceTo(l.target) / LINES.travelSpeed);
      p.events.push({ type: 'fire', hand });
    }

    if (!input.down[FIRE[hand]] && (l.kind === 'firing' || l.kind === 'attached')) {
      if (l.kind === 'attached') releaseBoost(p, hand);
      l.kind = 'retracting';
      l.timer = LINES.retractTime;
      p.events.push({ type: 'release', hand });
      continue;
    }

    switch (l.kind) {
      case 'firing':
        l.progress += dt / l.travelTime;
        if (l.progress >= 1) {
          l.progress = 1;
          if (l.hit) {
            l.kind = 'attached';
            l.length = THREE.MathUtils.clamp(p.pos.distanceTo(l.target) * LINES.attachLengthFactor, LINES.minLength, LINES.maxLength);
            p.events.push({ type: 'attach', hand });
          } else {
            l.kind = 'missed';
            l.timer = LINES.missFallTime;
            p.events.push({ type: 'miss', hand });
          }
        }
        break;
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
      case 'missed':
      case 'retracting':
        l.timer -= dt;
        if (l.timer <= 0) l.kind = 'idle';
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
 * Velocity-level rope constraint (one-sided: ropes pull, never push). For every taut line the
 * outward radial velocity is clamped to the line's length rate (reel in / let out), plus a small,
 * capped correction for drift. Central impulses conserve angular momentum, so reeling a taut
 * line in naturally spins you faster around the anchor.
 */
export function solveRopes(p: PlayerState, dt: number): void {
  const tension = [0, 0];
  for (let it = 0; it < LINES.solverIterations; it++) {
    for (const hand of [0, 1] as Hand[]) {
      const l = p.lines[hand];
      if (l.kind !== 'attached') continue;
      radial.subVectors(p.pos, l.target);
      const d = radial.length();
      if (d < l.length - 1e-3 || d < 1e-4) continue; // slack
      radial.divideScalar(d);
      const err = d - l.length;
      const lengthRate = l.reel === 1 ? -LINES.reelInSpeed : l.reel === -1 ? LINES.letOutSpeed : 0;
      const bias = Math.min((err * LINES.driftCorrection) / dt, LINES.maxCorrectionSpeed);
      const vMax = lengthRate - bias;
      const vr = p.vel.dot(radial);
      if (vr > vMax) {
        p.vel.addScaledVector(radial, vMax - vr);
        tension[hand] += vr - vMax;
      }
    }
  }
  p.lines[0].tension = tension[0];
  p.lines[1].tension = tension[1];
}
