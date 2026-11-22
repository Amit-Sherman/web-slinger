// Turns CityData into Three.js meshes and Rapier colliders.

import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { buildingMaterial, toon } from '../render/materials';
import { buildBoxesGeometry } from './boxGeometry';
import type { Box, CityData, PropInstance } from './cityGen';
import { STEEL, WATER_COLOR } from './palette';

const REGION = 250; // merge buildings into regions this size for frustum culling

export function buildCity(city: CityData, scene: THREE.Scene, physics: Physics, anisotropy: number): void {
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
    if (b.collide) physics.addCuboid(b.x, b.y, b.z, b.hx, b.hy, b.hz);
  }

  // Cylinders: lamp posts, trunks, water tanks, antennas
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const cyl = new THREE.InstancedMesh(cylGeo, toon(), city.cylinders.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  city.cylinders.forEach((c, i) => {
    m.compose(p.set(c.x, c.y, c.z), q.identity(), s.set(c.radius, c.halfHeight * 2, c.radius));
    cyl.setMatrixAt(i, m);
    cyl.setColorAt(i, color.setHex(c.color));
    physics.addCylinder(c.x, c.y, c.z, Math.max(c.radius, 0.2), c.halfHeight);
  });
  cyl.castShadow = cyl.receiveShadow = true;
  scene.add(cyl);

  const instanced = (geo: THREE.BufferGeometry, items: PropInstance[]): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, toon(), Math.max(1, items.length));
    mesh.count = items.length;
    items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY);
      m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setHex(it.color));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  instanced(new THREE.IcosahedronGeometry(1, 1), city.foliage);
  for (const f of city.foliage) physics.addBall(f.x, f.y, f.z, f.sx * 0.9);
  instanced(new THREE.ConeGeometry(1, 1, 12), city.cones);
  for (const c of city.cones) physics.addCone(c.x, c.y, c.z, c.sx, c.sy / 2);

  // Lamp heads: small glowing boxes on top of each lamp post (posts are 0.12 m radius)
  const lamps = city.cylinders.filter((c) => c.radius === 0.12);
  const lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }), lamps.length);
  lamps.forEach((c, i) => {
    m.compose(p.set(c.x, c.y + c.halfHeight + 0.1, c.z), q.identity(), s.set(1, 1, 1));
    lampHead.setMatrixAt(i, m);
  });
  scene.add(lampHead);

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
}
