// Movable physics props (SPEC §7.1): street furniture, parked cars, rooftop crates/barrels/AC units.
// Each prop is a Rapier dynamic body (starts asleep) drawn with instanced meshes. Web balls can
// glue a prop in place for a while (it becomes a fixed body, then is released again).

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PROPS } from '../config/gameplay';
import type { Physics } from '../core/physics';
import { toon } from '../render/materials';
import type { CityData, PropKind, PropSpec } from './cityGen';

interface PartDef {
  geo: THREE.BufferGeometry;
  /** local transform relative to the body (before the prop's per-instance scale) */
  pos: [number, number, number];
  rotX?: number;
  rotZ?: number;
  /** fixed colour; omit to use the prop's own colour */
  color?: number;
}

interface KindDef {
  shape: 'box' | 'cyl' | 'cone';
  /** half extents (box) or [radius, halfHeight] (cyl/cone), before per-instance scale */
  size: [number, number, number];
  /** kg; for 'ac' this is per m³ (scaled with volume) */
  mass: number;
  friction: number;
  parts: PartDef[];
}

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(r, r, h, seg);

const KINDS: Record<PropKind, KindDef> = {
  trash: {
    shape: 'cyl', size: [0.32, 0.48, 0], mass: 15, friction: 0.7,
    parts: [{ geo: cyl(0.32, 0.9), pos: [0, -0.03, 0] }, { geo: cyl(0.34, 0.08), pos: [0, 0.46, 0], color: 0x2a3a2e }],
  },
  newsbox: {
    shape: 'box', size: [0.26, 0.55, 0.24], mass: 25, friction: 0.8,
    parts: [{ geo: box(0.52, 0.8, 0.48), pos: [0, 0.15, 0] }, { geo: box(0.1, 0.3, 0.1), pos: [0, -0.4, 0], color: 0x3d3a37 }],
  },
  cone: {
    shape: 'cone', size: [0.2, 0.36, 0], mass: 3, friction: 0.8,
    parts: [{ geo: new THREE.ConeGeometry(0.2, 0.72, 12), pos: [0, 0, 0] }, { geo: box(0.4, 0.04, 0.4), pos: [0, -0.34, 0], color: 0x2b2b2e }],
  },
  bench: {
    shape: 'box', size: [0.9, 0.42, 0.3], mass: 40, friction: 0.8,
    parts: [
      { geo: box(1.8, 0.08, 0.5), pos: [0, 0.02, 0.05] },
      { geo: box(1.8, 0.4, 0.06), pos: [0, 0.28, -0.24] },
      { geo: box(0.08, 0.42, 0.5), pos: [-0.8, -0.21, 0.05], color: 0x3d3a37 },
      { geo: box(0.08, 0.42, 0.5), pos: [0.8, -0.21, 0.05], color: 0x3d3a37 },
    ],
  },
  car: {
    // length along local Z
    shape: 'box', size: [0.95, 0.72, 2.2], mass: 1200, friction: 0.9,
    parts: [
      { geo: box(1.9, 0.75, 4.4), pos: [0, -0.1, 0] },
      { geo: box(1.7, 0.6, 2.3), pos: [0, 0.55, -0.2], color: 0x3a4a58 },
      { geo: cyl(0.36, 0.26, 14), pos: [0.85, -0.38, 1.35], rotZ: Math.PI / 2, color: 0x1e1e20 },
      { geo: cyl(0.36, 0.26, 14), pos: [-0.85, -0.38, 1.35], rotZ: Math.PI / 2, color: 0x1e1e20 },
      { geo: cyl(0.36, 0.26, 14), pos: [0.85, -0.38, -1.35], rotZ: Math.PI / 2, color: 0x1e1e20 },
      { geo: cyl(0.36, 0.26, 14), pos: [-0.85, -0.38, -1.35], rotZ: Math.PI / 2, color: 0x1e1e20 },
    ],
  },
  crate: {
    shape: 'box', size: [0.5, 0.5, 0.5], mass: 30, friction: 0.7,
    parts: [{ geo: box(1, 1, 1), pos: [0, 0, 0] }, { geo: box(1.02, 0.12, 1.02), pos: [0, 0, 0], color: 0x7a5a34 }],
  },
  barrel: {
    shape: 'cyl', size: [0.35, 0.55, 0], mass: 50, friction: 0.6,
    parts: [{ geo: cyl(0.35, 1.1), pos: [0, 0, 0] }, { geo: cyl(0.36, 0.06), pos: [0, 0.3, 0], color: 0x3d3a37 }],
  },
  ac: {
    // unit box scaled per instance by its generated size
    shape: 'box', size: [0.5, 0.5, 0.5], mass: 45, friction: 0.8,
    parts: [{ geo: box(1, 1, 1), pos: [0, 0, 0] }, { geo: box(0.7, 0.04, 0.7), pos: [0, 0.51, 0], color: 0x6f6a63 }],
  },
};

interface Prop {
  spec: PropSpec;
  body: RAPIER.RigidBody;
  mass: number;
  /** [kindPartIndex] → instance index in that part's mesh */
  instance: number;
  dirty: boolean;
  sticky: number; // seconds left to settle and glue (0 = not sticky)
  glued: number; // seconds left glued (0 = not glued)
}

export class Props {
  private props: Prop[] = [];
  private byHandle = new Map<number, Prop>();
  private meshes = new Map<PropKind, THREE.InstancedMesh[]>();
  private partMatrices = new Map<PropKind, THREE.Matrix4[]>();
  private m = new THREE.Matrix4();
  private bodyM = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(city: CityData, scene: THREE.Scene, private physics: Physics) {
    const R = physics.R;
    const counts = new Map<PropKind, number>();
    for (const spec of city.props) counts.set(spec.kind, (counts.get(spec.kind) ?? 0) + 1);

    // Instanced meshes per kind & part
    const color = new THREE.Color();
    for (const [kind, n] of counts) {
      const def = KINDS[kind];
      const meshes = def.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geo, toon(), n);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false; // instances move; the merged bounds would go stale
        scene.add(mesh);
        return mesh;
      });
      this.meshes.set(kind, meshes);
      this.partMatrices.set(kind, def.parts.map((part) => new THREE.Matrix4().compose(
        new THREE.Vector3(...part.pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotX ?? 0, 0, part.rotZ ?? 0)),
        new THREE.Vector3(1, 1, 1),
      )));
    }

    const next = new Map<PropKind, number>();
    for (const spec of city.props) {
      const def = KINDS[spec.kind];
      const instance = next.get(spec.kind) ?? 0;
      next.set(spec.kind, instance + 1);
      const [a, b, c] = def.size;
      const volumeScale = spec.sx * spec.sy * spec.sz;
      const mass = spec.kind === 'ac' ? def.mass * volumeScale : def.mass;

      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.rotY);
      const body = physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(spec.x, spec.y + 0.01, spec.z) // 1 cm gap: no contact (and no wake) at spawn
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setCanSleep(true)
          .setSleeping(true)
          .setLinearDamping(0.05)
          .setAngularDamping(0.3)
          .setCcdEnabled(spec.kind !== 'car'),
      );
      const shape = def.shape === 'box'
        ? (spec.kind === 'ac' ? R.ColliderDesc.cuboid(a * spec.sx, b * spec.sy, c * spec.sz) : R.ColliderDesc.cuboid(a, b, c))
        : def.shape === 'cyl' ? R.ColliderDesc.cylinder(b, a) : R.ColliderDesc.cone(b, a);
      physics.world.createCollider(shape.setMass(mass).setFriction(def.friction).setRestitution(0.15), body);
      body.sleep(); // attaching a collider wakes the body; props start asleep until disturbed

      const prop: Prop = { spec, body, mass, instance, dirty: true, sticky: 0, glued: 0 };
      this.props.push(prop);
      this.byHandle.set(body.handle, prop);

      const meshes = this.meshes.get(spec.kind)!;
      def.parts.forEach((part, j) => meshes[j].setColorAt(instance, color.setHex(part.color ?? spec.color)));
    }
    for (const meshes of this.meshes.values()) for (const mesh of meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.sync(true);
  }

  /**
   * Put every prop to sleep. Call once after the first physics step: Rapier wakes bodies when it
   * first computes their mass properties, which would make ~5000 props simulate for seconds.
   */
  sleepAll(): void {
    for (const p of this.props) p.body.sleep();
  }

  get count(): number {
    return this.props.length;
  }

  /** Prop info for a body (null for city geometry or the player). */
  get(body: RAPIER.RigidBody | null): { mass: number; glued: boolean } | null {
    if (!body) return null;
    const p = this.byHandle.get(body.handle);
    return p ? { mass: p.mass, glued: p.glued > 0 } : null;
  }

  /** A web ball hit this body: it becomes sticky and glues in place once it settles. */
  makeSticky(body: RAPIER.RigidBody): void {
    const p = this.byHandle.get(body.handle);
    if (!p) return;
    if (p.glued > 0) {
      p.glued = PROPS.glueDuration; // refresh
      return;
    }
    p.sticky = PROPS.stickySettleTime;
  }

  /** Per simulation tick: glue sticky props that have settled, release expired glue. */
  tick(dt: number): void {
    const R = this.physics.R;
    for (const p of this.props) {
      if (p.sticky > 0) {
        p.sticky -= dt;
        const v = p.body.linvel();
        const settled = Math.hypot(v.x, v.y, v.z) < PROPS.glueSpeed;
        if (settled || p.sticky <= 0) {
          p.sticky = 0;
          p.glued = PROPS.glueDuration;
          p.body.setBodyType(R.RigidBodyType.Fixed, false);
          p.dirty = true;
        }
      } else if (p.glued > 0) {
        p.glued -= dt;
        if (p.glued <= 0) {
          p.glued = 0;
          p.body.setBodyType(R.RigidBodyType.Dynamic, true);
        }
      }
    }
  }

  /** Copy body transforms into instance matrices (only for awake / changed props). */
  sync(all = false): void {
    const touched = new Set<THREE.InstancedMesh>();
    for (const p of this.props) {
      const awake = !p.body.isSleeping() && !p.body.isFixed();
      if (!all && !awake && !p.dirty) continue;
      p.dirty = awake; // one more update after falling asleep
      const t = p.body.translation();
      const r = p.body.rotation();
      const s = p.spec.kind === 'ac' ? this.sc.set(p.spec.sx, p.spec.sy, p.spec.sz) : this.sc.set(1, 1, 1);
      this.bodyM.compose(this.p.set(t.x, t.y, t.z), this.q.set(r.x, r.y, r.z, r.w), s);
      const meshes = this.meshes.get(p.spec.kind)!;
      const parts = this.partMatrices.get(p.spec.kind)!;
      for (let j = 0; j < meshes.length; j++) {
        meshes[j].setMatrixAt(p.instance, this.m.multiplyMatrices(this.bodyM, parts[j]));
        touched.add(meshes[j]);
      }
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }
}
