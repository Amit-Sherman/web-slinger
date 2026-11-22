// Thin wrapper around Rapier: static world colliders + scene queries.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Rapier = typeof RAPIER;

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  /** The movable prop body that was hit, or null for static city geometry. */
  body: RAPIER.RigidBody | null;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Physics {
  readonly world: RAPIER.World;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  private constructor(readonly R: Rapier, dt: number) {
    // Rapier simulates movable props (real gravity). The player's gravity, ropes and movement are
    // our own code; the player is a kinematic body driven by a character controller.
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = dt;
  }

  static async create(dt: number): Promise<Physics> {
    await RAPIER.init();
    return new Physics(RAPIER, dt);
  }

  addCuboid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
  }

  /**
   * Like addCuboid, but huge boxes are split into tiles (≤ `tile` m wide). The character
   * controller loses precision against very large cuboids (the 2 km street slab made the player
   * sink a few cm and get stuck when running), so the ground is built from tiles.
   */
  addCuboidTiled(x: number, y: number, z: number, hx: number, hy: number, hz: number, tile = 100): void {
    const nx = Math.max(1, Math.ceil((hx * 2) / tile));
    const nz = Math.max(1, Math.ceil((hz * 2) / tile));
    const tx = hx / nx, tz = hz / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        this.addCuboid(x - hx + tx * (2 * i + 1), y, z - hz + tz * (2 * j + 1), tx, hy, tz);
      }
    }
  }

  addCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): void {
    this.world.createCollider(this.R.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z));
  }

  addBall(x: number, y: number, z: number, radius: number): void {
    this.world.createCollider(this.R.ColliderDesc.ball(radius).setTranslation(x, y, z));
  }

  addCone(x: number, y: number, z: number, radius: number, halfHeight: number): void {
    this.world.createCollider(this.R.ColliderDesc.cone(halfHeight, radius).setTranslation(x, y, z));
  }

  /** Raycast against the world, ignoring `exclude` (the player). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.Collider): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, undefined, exclude);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: t,
      body: hit.collider.parent(),
    };
  }

  /** World point → body-local point. */
  toLocal(body: RAPIER.RigidBody, world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const t = body.translation();
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    return out.copy(world).sub(_v.set(t.x, t.y, t.z)).applyQuaternion(_q);
  }

  /** Body-local point → world point. */
  toWorld(body: RAPIER.RigidBody, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const t = body.translation();
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    return out.copy(local).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
  }

  /** Advance movable props by one fixed tick. */
  step(): void {
    this.world.step();
  }

  /** Rebuild the query acceleration structure after adding static colliders. */
  finalize(): void {
    this.world.step();
  }
}
