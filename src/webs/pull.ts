// Pull line (SPEC §5.3), middle mouse: a third web stream from the right launcher.
// - Hits a light movable prop → reeled in fast (two-body elastic line), caught and held in front
//   of you; releasing middle mouse throws it along your aim.
// - Hits something heavy (a car, a glued prop) or static city geometry → the same line yanks
//   *you* towards it instead (heavier side moves less, by real physics).

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PULL } from '../config/gameplay';
import type { Physics } from '../core/physics';
import type { InputSnapshot } from '../input/input';
import type { PlayerState } from '../player/state';
import type { Props } from '../world/props';
import { launchVelocity, refreshAnchor, setAnchor, stepTip } from './ballistics';
import { solveLine } from './lines';

const PULL_LINE = { elasticity: PULL.elasticity, dampingRatio: PULL.dampingRatio, maxStretch: 0.5 };

const hold = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const tmp = new THREE.Vector3();

/** Input + state machine for the pull line. Runs each tick before movement. */
export function updatePull(
  p: PlayerState, input: InputSnapshot, eye: THREE.Vector3, aim: THREE.Vector3, yaw: number,
  physics: Physics, props: Props, self: RAPIER.Collider, dt: number,
): void {
  const l = p.pull;
  l.reel = 0;

  if (input.pressed.pull && l.kind === 'idle') {
    l.kind = 'firing';
    l.holding = false;
    l.target.copy(eye).addScaledVector(aim, 0.4);
    launchVelocity(l.tipVel, aim, p.vel);
    l.flightTime = 0;
    p.events.push({ type: 'pullFire' });
  }

  if (!input.down.pull && l.kind !== 'idle') {
    const body = l.anchorBody >= 0 ? physics.world.getRigidBody(l.anchorBody) : null;
    if (l.holding && body) throwHeld(body, props, aim, p.vel);
    p.events.push({ type: l.holding ? 'throw' : 'pullRelease' });
    l.kind = 'idle';
    l.holding = false;
    return;
  }

  if (l.kind === 'firing') {
    l.flightTime += dt;
    const hit = stepTip(l.target, l.tipVel, dt, physics, self);
    if (hit) {
      l.kind = 'attached';
      setAnchor(l, hit, physics);
      l.length = Math.max(PULL.minLength, p.pos.distanceTo(l.target));
      p.events.push({ type: 'pullAttach' });
    }
    return;
  }

  if (l.kind !== 'attached') return;
  const body = refreshAnchor(l, physics);
  const info = props.get(body);

  if (l.holding) {
    if (!body || !info || info.glued) {
      // Lost it (glued by a web ball, etc.)
      l.holding = false;
      body?.setGravityScale(1, true);
      return;
    }
    // Drive the held object to a point in front of the right hand
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(right, aim).normalize();
    hold.copy(eye)
      .addScaledVector(right, PULL.holdOffset[0])
      .addScaledVector(up, PULL.holdOffset[1])
      .addScaledVector(aim, -PULL.holdOffset[2]);
    const t = body.translation();
    tmp.set(hold.x - t.x, hold.y - t.y, hold.z - t.z).multiplyScalar(PULL.holdStiffness).add(p.vel);
    body.setLinvel({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
    const av = body.angvel();
    body.setAngvel({ x: av.x * 0.8, y: av.y * 0.8, z: av.z * 0.8 }, true);
    l.target.set(t.x, t.y, t.z);
    return;
  }

  // Reel in fast; the two-body line does the yanking (see solvePull)
  l.length = Math.max(PULL.minLength, l.length - PULL.reelSpeed * dt);
  l.reel = 1;

  // Catch light, free props when they reach your hands
  if (body && info && !info.glued && info.mass <= PULL.maxHoldMass && body.isDynamic()) {
    const t = body.translation();
    if (tmp.set(t.x, t.y, t.z).distanceTo(eye) < PULL.holdDistance) {
      l.holding = true;
      body.setGravityScale(0, true);
      p.events.push({ type: 'catch' });
    }
  }
}

/** Line forces for the pull line (after movement input, like swing lines). */
export function solvePull(p: PlayerState, physics: Physics, dt: number): void {
  solveLine(p, p.pull, PULL_LINE, physics, dt);
}

function throwHeld(body: RAPIER.RigidBody, props: Props, aim: THREE.Vector3, playerVel: THREE.Vector3): void {
  body.setGravityScale(1, true);
  const mass = props.get(body)?.mass ?? 30;
  const speed = THREE.MathUtils.clamp(PULL.throwSpeed * Math.sqrt(30 / mass), PULL.minThrowSpeed, PULL.maxThrowSpeed);
  body.setLinvel({ x: aim.x * speed + playerVel.x, y: aim.y * speed + playerVel.y, z: aim.z * speed + playerVel.z }, true);
  body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
}
