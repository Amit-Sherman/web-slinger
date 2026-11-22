// Ballistic web-stream tip (SPEC §5.1): shared by the gameplay tip and the HUD impact prediction.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { LINES } from '../config/gameplay';
import type { Physics, RayHit } from '../core/physics';

const dir = new THREE.Vector3();

/** Initial stream velocity: along the aim plus part of the player's own velocity. */
export function launchVelocity(out: THREE.Vector3, aim: THREE.Vector3, playerVel: THREE.Vector3): THREE.Vector3 {
  return out.copy(aim).multiplyScalar(LINES.launchSpeed).addScaledVector(playerVel, LINES.inheritVelocity);
}

/**
 * Advance a tip by dt (semi-implicit Euler) and sweep the segment for a hit.
 * Mutates pos/vel when nothing is hit; returns the hit otherwise.
 */
export function stepTip(
  pos: THREE.Vector3, vel: THREE.Vector3, dt: number, physics: Physics, exclude?: RAPIER.Collider,
): RayHit | null {
  vel.y -= LINES.webGravity * dt;
  dir.copy(vel).multiplyScalar(dt);
  const len = dir.length();
  if (len < 1e-6) return null;
  dir.divideScalar(len);
  const hit = physics.raycast(pos, dir, len, exclude);
  if (hit) return hit;
  pos.addScaledVector(dir, len);
  return null;
}

const pPos = new THREE.Vector3();
const pVel = new THREE.Vector3();

/** Where would a stream fired now land? Used for the HUD marker. */
export function predictImpact(
  origin: THREE.Vector3, vel: THREE.Vector3, physics: Physics, exclude?: RAPIER.Collider,
): (RayHit & { time: number }) | null {
  pPos.copy(origin);
  pVel.copy(vel);
  const dt = 1 / 30;
  for (let t = 0; t < LINES.predictionTime; t += dt) {
    const hit = stepTip(pPos, pVel, dt, physics, exclude);
    if (hit) return { ...hit, time: t };
  }
  return null;
}
