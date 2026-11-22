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

const REGION = 250;
const CYL_SEGS = 10;

// Unit box corners (±1) and its 12 triangles, outward CCW
const BOX_CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const BOX_TRIS = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];

// Cylinder: vertex 2k = bottom ring, 2k+1 = top ring, then bottom centre, top centre
const CYL_TRIS: number[] = (() => {
  const t: number[] = [];
  const bc = CYL_SEGS * 2, tc = bc + 1;
  for (let k = 0; k < CYL_SEGS; k++) {
    const b0 = 2 * k, t0 = b0 + 1, b1 = (2 * ((k + 1) % CYL_SEGS)), t1 = b1 + 1;
    t.push(b0, t0, b1, b1, t0, t1); // side
    t.push(tc, t1, t0); // top cap
    t.push(bc, b0, b1); // bottom cap
  }
  return t;
})();

// Cone: ring vertices, then apex, bottom centre
const CONE_TRIS: number[] = (() => {
  const t: number[] = [];
  const apex = CYL_SEGS, bc = CYL_SEGS + 1;
  for (let k = 0; k < CYL_SEGS; k++) {
    const a = k, b = (k + 1) % CYL_SEGS;
    t.push(a, apex, b, bc, a, b);
  }
  return t;
})();

// Icosahedron (unit radius)
const ICO = new THREE.IcosahedronGeometry(1, 0);
const ICO_VERTS = Array.from(ICO.getAttribute('position').array as Float32Array);
const ICO_TRIS = Array.from({ length: ICO_VERTS.length / 3 }, (_, k) => k);

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

  // ---- Static city geometry --------------------------------------------------------------
  // All static shapes are accumulated as triangles and baked into one triangle-mesh collider per
  // 250 m region in finalize(). Rapier's step cost grows ~0.36 ms per 1000 colliders even when
  // nothing moves; ~6700 separate boxes/cylinders cost ~4–7 ms per step, while the same geometry
  // as ~70 trimeshes costs ~0.05 ms (measured, SPEC §13).
  private regions = new Map<string, { v: number[]; i: number[] }>();

  private region(x: number, z: number): { v: number[]; i: number[] } {
    const key = `${Math.floor(x / REGION)},${Math.floor(z / REGION)}`;
    let r = this.regions.get(key);
    if (!r) {
      r = { v: [], i: [] };
      this.regions.set(key, r);
    }
    return r;
  }

  /** Append a convex shape given as vertices + triangle indices (outward CCW). */
  private addTris(cx: number, cz: number, verts: number[], tris: number[]): void {
    const r = this.region(cx, cz);
    const base = r.v.length / 3;
    for (let k = 0; k < verts.length; k++) r.v.push(verts[k]);
    for (let k = 0; k < tris.length; k++) r.i.push(tris[k] + base);
  }

  addCuboid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    const v: number[] = [];
    for (const [sx, sy, sz] of BOX_CORNERS) v.push(x + sx * hx, y + sy * hy, z + sz * hz);
    this.addTris(x, z, v, BOX_TRIS);
  }

  /**
   * Like addCuboid, but huge boxes are split into tiles (≤ `tile` m wide). The character
   * controller loses precision against very large shapes (the 2 km street slab made the player
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
    const v: number[] = [];
    for (let k = 0; k < CYL_SEGS; k++) {
      const a = (k / CYL_SEGS) * Math.PI * 2;
      const px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      v.push(px, y - halfHeight, pz, px, y + halfHeight, pz);
    }
    v.push(x, y - halfHeight, z, x, y + halfHeight, z);
    this.addTris(x, z, v, CYL_TRIS);
  }

  addBall(x: number, y: number, z: number, radius: number): void {
    const v: number[] = [];
    for (let k = 0; k < ICO_VERTS.length; k += 3) v.push(x + ICO_VERTS[k] * radius, y + ICO_VERTS[k + 1] * radius, z + ICO_VERTS[k + 2] * radius);
    this.addTris(x, z, v, ICO_TRIS);
  }

  addCone(x: number, y: number, z: number, radius: number, halfHeight: number): void {
    const v: number[] = [];
    for (let k = 0; k < CYL_SEGS; k++) {
      const a = (k / CYL_SEGS) * Math.PI * 2;
      v.push(x + Math.cos(a) * radius, y - halfHeight, z + Math.sin(a) * radius);
    }
    v.push(x, y + halfHeight, z, x, y - halfHeight, z);
    this.addTris(x, z, v, CONE_TRIS);
  }

  /** Number of baked static regions (for stats). */
  get staticRegions(): number {
    return this.regions.size;
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

  /**
   * Set when colliders are added/removed (tether strands) or when gameplay wakes a body (impulse,
   * setLinvel...): Rapier only lists a woken body as active after the next step, so without this
   * flag a push on a sleeping prop would never be simulated.
   */
  private dirty = true;

  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Advance movable props by one fixed tick, but only when something can change: Rapier's step
   * costs ~0.36 ms per 1000 colliders even when everything is asleep (measured). The player is a
   * parentless collider moved by the character controller, which only needs scene queries, and
   * static geometry never changes. So we step only while some body is awake (or after colliders
   * were added/removed). Returns whether a step ran.
   */
  step(): boolean {
    let active = this.dirty;
    if (!active) {
      this.world.forEachActiveRigidBody(() => {
        active = true;
      });
    }
    if (!active) return false;
    this.world.step();
    this.dirty = false;
    return true;
  }

  /** Bake the accumulated static geometry into trimesh colliders and build the query structure. */
  finalize(): void {
    for (const r of this.regions.values()) {
      if (r.i.length === 0) continue;
      this.world.createCollider(this.R.ColliderDesc.trimesh(new Float32Array(r.v), new Uint32Array(r.i)));
      r.v = [];
      r.i = [];
    }
    this.world.step();
  }
}
