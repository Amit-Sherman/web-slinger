// First-person camera (SPEC §3.1): mouse-look independent of velocity, speed FOV,
// camera roll on hard turns, landing/stagger shake.

import * as THREE from 'three';
import { CAMERA } from '../config/gameplay';
import type { Settings } from '../config/settings';

export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  private roll = 0;
  private trauma = 0;
  private dip = 0;
  private dipVel = 0;
  private lastVel = new THREE.Vector3();
  private shakeT = 0;
  readonly aim = new THREE.Vector3(0, 0, -1);

  constructor(aspect: number, far: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.baseFov, aspect, CAMERA.near, far);
    this.camera.rotation.order = 'YXZ';
  }

  look(dx: number, dy: number, s: Settings): void {
    const k = 0.0022 * s.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (s.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.updateAim();
  }

  updateAim(): void {
    const cp = Math.cos(this.pitch);
    this.aim.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Landing dip: pushes the view down then springs back. */
  addDip(amount: number): void {
    this.dipVel -= amount;
  }

  update(eye: THREE.Vector3, vel: THREE.Vector3, dt: number, s: Settings): void {
    const speed = vel.length();
    const effects = s.motionEffects;

    // FOV widens with speed
    const t = THREE.MathUtils.clamp((speed - CAMERA.fovSpeedStart) / (CAMERA.fovSpeedFull - CAMERA.fovSpeedStart), 0, 1);
    const targetFov = s.fov + (effects ? CAMERA.maxFovBoost * t : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);

    // Roll from lateral acceleration relative to the view
    let targetRoll = 0;
    if (effects && s.cameraRoll && dt > 0) {
      const acc = vel.clone().sub(this.lastVel).divideScalar(dt);
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const lateral = acc.dot(right);
      targetRoll = THREE.MathUtils.clamp(-lateral * 0.004, -1, 1) * THREE.MathUtils.degToRad(CAMERA.maxRollDeg);
    }
    this.lastVel.copy(vel);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 3);

    // Dip spring
    this.dipVel += (-this.dip * 120 - this.dipVel * 14) * dt;
    this.dip += this.dipVel * dt;

    // Shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeT += dt * 30;
    const sh = effects ? this.trauma * this.trauma : this.trauma * this.trauma * 0.3;
    const n = (o: number): number => Math.sin(this.shakeT * 1.3 + o) * Math.sin(this.shakeT * 0.7 + o * 2.1);

    this.camera.position.copy(eye);
    this.camera.position.y += this.dip + n(3) * sh * 0.15;
    this.camera.rotation.set(this.pitch + n(1) * sh * 0.06, this.yaw + n(2) * sh * 0.06, this.roll + n(4) * sh * 0.05);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
