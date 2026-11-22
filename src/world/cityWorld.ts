// Turns CityData into Three.js meshes and Rapier colliders.

import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { buildingMaterial, toon } from '../render/materials';
import { buildBoxesGeometry } from './boxGeometry';
import type { Box, CityData, PropInstance } from './cityGen';
import { STEEL, WATER_COLOR } from './palette';

const REGION = 250; // merge buildings into regions this size for frustum culling

export function buildCity(city: CityData, scene: THREE.Scene, physics: Physics, anisotropy: number): CityCull {
  const bMat = buildingMaterial(anisotropy);
  const plainMat = toon({ vertexColors: true });

  // Buildings, merged per region
  const regions = new Map<string, Box[]>();
  for (const b of city.buildings) {
    const key = `${Math.floor(b.x / REGION)},${Math.floor(b.z / REGION)}`;
    const list = regions.get(key) ?? [];
    list.push(b);
    regions.set(key, list);
  }
  for (const boxes of regions.values()) {
    const mesh = new THREE.Mesh(buildBoxesGeometry(boxes), bMat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  // Slabs (ground, sidewalks, bridge decks) – receive shadows only
  const slabs = new THREE.Mesh(buildBoxesGeometry(city.slabs, true), plainMat);
  slabs.receiveShadow = true;
  slabs.matrixAutoUpdate = false;
  scene.add(slabs);

  // Structures (AC units, bridge towers, cranes)
  const structures = new THREE.Mesh(buildBoxesGeometry(city.structures, true), plainMat);
  structures.castShadow = structures.receiveShadow = true;
  structures.matrixAutoUpdate = false;
  scene.add(structures);

  for (const b of [...city.buildings, ...city.slabs, ...city.structures]) {
    if (b.collide) physics.addCuboidTiled(b.x, b.y, b.z, b.hx, b.hy, b.hz);
  }

  // Static instanced props, split into 250 m chunks so frustum culling works, and small items
  // (lamp posts, trunks, tree crowns, lamp heads) hidden beyond a draw distance (SPEC §13).
  const cull = new CityCull();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  interface Item { x: number; y: number; z: number; m: THREE.Matrix4; color: number }
  const chunked = (geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], small: boolean, shadows: boolean): void => {
    const chunks = new Map<string, Item[]>();
    for (const it of items) {
      const key = `${Math.floor(it.x / REGION)},${Math.floor(it.z / REGION)}`;
      const list = chunks.get(key) ?? [];
      list.push(it);
      chunks.set(key, list);
    }
    for (const list of chunks.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, k) => {
        mesh.setMatrixAt(k, it.m);
        if (!(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) mesh.setColorAt(k, color.setHex(it.color));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      scene.add(mesh);
      cull.add(mesh, small);
    }
  };
  const toonMat = toon();

  // Cylinders: thin ones (lamp posts, legs, trunks) are small; tanks and antennas stay visible far away
  const thin: Item[] = [], thick: Item[] = [];
  for (const c of city.cylinders) {
    m.compose(p.set(c.x, c.y, c.z), q.identity(), s.set(c.radius, c.halfHeight * 2, c.radius));
    (c.radius <= 0.35 && c.halfHeight < 4 ? thin : thick).push({ x: c.x, y: c.y, z: c.z, m: m.clone(), color: c.color });
    physics.addCylinder(c.x, c.y, c.z, Math.max(c.radius, 0.2), c.halfHeight);
  }
  chunked(new THREE.CylinderGeometry(1, 1, 1, 6, 1), toonMat, thin, true, false); // thin posts: shadows not worth a draw call
  chunked(new THREE.CylinderGeometry(1, 1, 1, 10, 1), toonMat, thick, false, true);

  const fromInstances = (items: PropInstance[]): Item[] => items.map((it) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY);
    return { x: it.x, y: it.y, z: it.z, m: m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz)).clone(), color: it.color };
  });
  chunked(new THREE.IcosahedronGeometry(1, 1), toonMat, fromInstances(city.foliage), true, true);
  for (const f of city.foliage) physics.addBall(f.x, f.y, f.z, f.sx * 0.9);
  chunked(new THREE.ConeGeometry(1, 1, 10), toonMat, fromInstances(city.cones), false, true);
  for (const c of city.cones) physics.addCone(c.x, c.y, c.z, c.sx, c.sy / 2);

  // Lamp heads: small glowing boxes on top of each lamp post (posts are 0.12 m radius)
  const heads: Item[] = city.cylinders.filter((c) => c.radius === 0.12).map((c) => ({
    x: c.x, y: c.y, z: c.z, color: 0xfff1c9,
    m: m.compose(p.set(c.x, c.y + c.halfHeight + 0.1, c.z), q.identity(), s.set(1, 1, 1)).clone(),
  }));
  chunked(new THREE.BoxGeometry(0.5, 0.25, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }), heads, true, false);

  // Decorative bridge cables
  const cablePts: number[] = [];
  for (const c of city.cables) cablePts.push(...c);
  const cableGeo = new THREE.BufferGeometry();
  cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  scene.add(new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: STEEL })));

  // River water surface (visual only; swimming handled by the player controller)
  const { z0, z1, waterY } = city.river;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(city.halfSize * 2, z1 - z0),
    toon({ color: WATER_COLOR, transparent: true, opacity: 0.88 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, waterY, (z0 + z1) / 2);
  water.receiveShadow = true;
  scene.add(water);
  return cull;
}

/** Hides small static props beyond a distance (per 250 m chunk). Frustum culling does the rest. */
export class CityCull {
  private items: { mesh: THREE.InstancedMesh; small: boolean }[] = [];
  private distance = 600;

  add(mesh: THREE.InstancedMesh, small: boolean): void {
    this.items.push({ mesh, small });
  }

  setDistance(d: number): void {
    this.distance = d;
  }

  update(cam: THREE.Vector3): void {
    for (const { mesh, small } of this.items) {
      if (!small) continue;
      const bs = mesh.boundingSphere!;
      mesh.visible = bs.center.distanceTo(cam) - bs.radius < this.distance;
    }
  }
}
