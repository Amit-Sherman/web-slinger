// Thin wrapper around Rapier: static world colliders + scene queries.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Rapier = typeof RAPIER;

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

export class Physics {
  readonly world: RAPIER.World;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  private constructor(readonly R: Rapier, dt: number) {
    // Gravity is applied by our own controllers; the Rapier world is used for collisions and queries.
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = dt;
  }

  static async create(dt: number): Promise<Physics> {
    await RAPIER.init();
    return new Physics(RAPIER, dt);
  }

  addCuboid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
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
    };
  }

  /** Rebuild the query acceleration structure after adding static colliders. */
  finalize(): void {
    this.world.step();
  }
}
