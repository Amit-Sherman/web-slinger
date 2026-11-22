// Procedural city layout (SPEC §7). Pure data: no Three.js, no physics.
// Same seed always produces the same city.

import { Rng } from '../core/rng';
import * as P from './palette';

export interface Box {
  /** centre */
  x: number; y: number; z: number;
  /** half extents */
  hx: number; hy: number; hz: number;
  color: number;
  roofColor: number;
  windows: boolean;
  /** window cell size in metres (horizontal, vertical) */
  cellW: number; cellH: number;
  collide: boolean;
}

export interface Cylinder {
  x: number; y: number; z: number; // centre
  radius: number; halfHeight: number;
  color: number;
}

export interface PropInstance {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rotY: number;
  color: number;
}

export type PropKind = 'trash' | 'newsbox' | 'cone' | 'bench' | 'car' | 'crate' | 'barrel' | 'ac';

/** A movable physics prop (SPEC §7.1). Position = collider centre; s* scale the kind's base size. */
export interface PropSpec {
  kind: PropKind;
  x: number; y: number; z: number;
  rotY: number;
  sx: number; sy: number; sz: number;
  color: number;
}

export interface BlockInfo { x0: number; x1: number; z0: number; z1: number; park: boolean }

export interface CityData {
  seed: number;
  halfSize: number;
  buildings: Box[];
  slabs: Box[]; // ground, sidewalks, bridge decks, embankments
  structures: Box[]; // bridge towers, cranes, AC units (plain-coloured collidable boxes)
  cylinders: Cylinder[]; // water towers, lamp posts, trunks, antennas
  foliage: PropInstance[]; // tree crowns (spheres)
  cones: PropInstance[]; // water tower roofs
  cables: [number, number, number, number, number, number][]; // decorative bridge cables
  props: PropSpec[];
  blocks: BlockInfo[];
  roofs: Box[]; // top box of every building (for rooftop props)
  river: { z0: number; z1: number; bedY: number; waterY: number };
  spawn: { x: number; y: number; z: number; yaw: number };
}

const HALF = 1000;
const STREET = 18;
const RIVER_Z0 = 410;
const RIVER_Z1 = 510;
const DOWNTOWN = { x: -150, z: -180 };
const PARK = { x0: 180, x1: 520, z0: -620, z1: -340 };

function splitAxis(rng: Rng, from: number, to: number, minBlock: number, maxBlock: number): [number, number][] {
  // Returns block extents [a, b] along an axis, separated by streets.
  const blocks: [number, number][] = [];
  let p = from + STREET / 2;
  while (p < to - STREET / 2 - minBlock) {
    let size = rng.range(minBlock, maxBlock);
    if (p + size > to - STREET / 2 - minBlock) size = to - STREET / 2 - p;
    blocks.push([p, p + size]);
    p += size + STREET;
  }
  return blocks;
}

export function generateCity(seed: number): CityData {
  const rng = new Rng(seed);
  const city: CityData = {
    seed,
    halfSize: HALF,
    buildings: [],
    slabs: [],
    structures: [],
    cylinders: [],
    foliage: [],
    cones: [],
    cables: [],
    props: [],
    blocks: [],
    roofs: [],
    river: { z0: RIVER_Z0, z1: RIVER_Z1, bedY: -4, waterY: -0.8 },
    spawn: { x: 0, y: 50, z: 0, yaw: 0 },
  };

  // --- Ground: two land masses either side of a recessed river channel.
  const slab = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number): Box => ({
    x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
    hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2,
    color, roofColor: color, windows: false, cellW: 4, cellH: 4, collide: true,
  });
  city.slabs.push(slab(-HALF, HALF, -10, 0, -HALF, RIVER_Z0, P.ASPHALT));
  city.slabs.push(slab(-HALF, HALF, -10, 0, RIVER_Z1, HALF, P.ASPHALT));
  city.slabs.push(slab(-HALF, HALF, -12, city.river.bedY, RIVER_Z0, RIVER_Z1, P.EMBANKMENT));

  const xBlocks = splitAxis(rng, -HALF, HALF, 60, 105);
  const zNorth = splitAxis(rng, -HALF, RIVER_Z0 - 6, 55, 95);
  const zSouth = splitAxis(rng, RIVER_Z1 + 6, HALF, 55, 95);
  const zBlocks = [...zNorth, ...zSouth];

  let tallest = { h: 0, x: 0, z: 0, top: 0 };

  for (const [x0, x1] of xBlocks) {
    for (const [z0, z1] of zBlocks) {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const isPark = cx > PARK.x0 && cx < PARK.x1 && cz > PARK.z0 && cz < PARK.z1;
      city.blocks.push({ x0, x1, z0, z1, park: isPark });
      // Sidewalk / park slab
      city.slabs.push(slab(x0, x1, 0, 0.2, z0, z1, isPark ? P.GRASS : P.SIDEWALK));

      // Lamp posts along the block edge
      const lampInset = 1.2;
      for (const [ax, az, bx, bz] of [
        [x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0],
      ] as const) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.floor(len / 30));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const lx = ax + (bx - ax) * t + Math.sign(cx - (ax + (bx - ax) * t)) * lampInset * (ax === bx ? 1 : 0);
          const lz = az + (bz - az) * t + Math.sign(cz - (az + (bz - az) * t)) * lampInset * (az === bz ? 1 : 0);
          city.cylinders.push({ x: lx, y: 0.2 + 3.5, z: lz, radius: 0.12, halfHeight: 3.5, color: P.LAMP });
        }
      }

      if (isPark) {
        const area = (x1 - x0) * (z1 - z0);
        const trees = Math.floor(area / 160);
        for (let i = 0; i < trees; i++) {
          const tx = rng.range(x0 + 3, x1 - 3);
          const tz = rng.range(z0 + 3, z1 - 3);
          const h = rng.range(3, 5.5);
          city.cylinders.push({ x: tx, y: 0.2 + h / 2, z: tz, radius: 0.35, halfHeight: h / 2, color: P.TRUNK });
          const r = rng.range(2.5, 4.5);
          city.foliage.push({ x: tx, y: 0.2 + h + r * 0.6, z: tz, sx: r, sy: r * rng.range(0.85, 1.15), sz: r, rotY: 0, color: rng.pick(P.FOLIAGE) });
        }
        continue;
      }

      const d = Math.hypot(cx - DOWNTOWN.x, cz - DOWNTOWN.z);
      const nearRiver = Math.min(Math.abs(cz - RIVER_Z0), Math.abs(cz - RIVER_Z1)) < 160;
      const district = d < 380 ? 'downtown' : nearRiver ? 'industrial' : d < 700 ? 'midtown' : 'residential';

      const nx = district === 'industrial' ? 1 : rng.int(1, x1 - x0 > 85 ? 3 : 2);
      const nz = district === 'industrial' ? rng.int(1, 2) : rng.int(1, z1 - z0 > 80 ? 3 : 2);
      const margin = rng.range(1.5, 3);
      const lotW = (x1 - x0 - margin * 2) / nx;
      const lotD = (z1 - z0 - margin * 2) / nz;

      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          if (district !== 'downtown' && rng.chance(0.06)) continue; // empty lot / plaza
          const gap = district === 'downtown' ? rng.range(0, 4) : rng.range(1, 6);
          const lx0 = x0 + margin + i * lotW + (i > 0 ? gap / 2 : 0);
          const lx1 = x0 + margin + (i + 1) * lotW - (i < nx - 1 ? gap / 2 : 0);
          const lz0 = z0 + margin + j * lotD + (j > 0 ? gap / 2 : 0);
          const lz1 = z0 + margin + (j + 1) * lotD - (j < nz - 1 ? gap / 2 : 0);

          let h: number;
          if (district === 'downtown') h = rng.range(90, 160) + (1 - d / 380) * rng.range(40, 140);
          else if (district === 'midtown') h = rng.range(40, 120);
          else if (district === 'industrial') h = rng.range(9, 22);
          else h = rng.range(12, 35);

          const color = rng.pick(P.BUILDING_COLORS);
          const roofColor = rng.pick(P.ROOF_COLORS);
          const cellW = rng.range(3.2, 4.8);
          const cellH = district === 'industrial' ? rng.range(5, 7) : rng.range(3.3, 4.0);
          const mk = (ax0: number, ax1: number, y0: number, y1: number, az0: number, az1: number): Box => ({
            x: (ax0 + ax1) / 2, y: (y0 + y1) / 2, z: (az0 + az1) / 2,
            hx: (ax1 - ax0) / 2, hy: (y1 - y0) / 2, hz: (az1 - az0) / 2,
            color, roofColor, windows: true, cellW, cellH, collide: true,
          });

          let top = mk(lx0, lx1, 0.2, 0.2 + h, lz0, lz1);
          city.buildings.push(top);
          // Setbacks on tall buildings
          if (h > 60 && rng.chance(0.7)) {
            const tiers = h > 150 ? rng.int(1, 2) : 1;
            let bx0 = lx0, bx1 = lx1, bz0 = lz0, bz1 = lz1, bh = h;
            top.hy = (bh * rng.range(0.5, 0.7)) / 2;
            top.y = 0.2 + top.hy;
            let base = top.y + top.hy;
            for (let t = 0; t < tiers; t++) {
              const inX = (bx1 - bx0) * rng.range(0.1, 0.22);
              const inZ = (bz1 - bz0) * rng.range(0.1, 0.22);
              bx0 += inX; bx1 -= inX; bz0 += inZ; bz1 -= inZ;
              const tierTop = t === tiers - 1 ? 0.2 + bh : base + (0.2 + bh - base) * rng.range(0.5, 0.7);
              top = mk(bx0, bx1, base, tierTop, bz0, bz1);
              city.buildings.push(top);
              base = tierTop;
            }
          }

          const roofY = top.y + top.hy;
          if (roofY > tallest.top && Math.hypot(top.x - DOWNTOWN.x, top.z - DOWNTOWN.z) < 200) {
            tallest = { h: roofY, x: top.x, z: top.z, top: roofY };
          }
          addRooftopProps(rng, city, top, district);
        }
      }
    }
  }

  addBridges(rng, city, xBlocks);
  addCranes(rng, city);
  // Movable props use their own RNG stream so the city layout stays identical for a given seed
  addMovableProps(new Rng((seed ^ 0x5bd1e995) >>> 0), city);

  city.spawn = { x: tallest.x, y: tallest.top + 2, z: tallest.z, yaw: Math.atan2(-(DOWNTOWN.x + 400 - tallest.x), -(DOWNTOWN.z + 400 - tallest.z)) };
  return city;
}

function addRooftopProps(rng: Rng, city: CityData, top: Box, district: string): void {
  const roofY = top.y + top.hy;
  city.roofs.push(top);
  const w = top.hx * 2;
  const d = top.hz * 2;
  // AC units
  const acCount = rng.int(0, Math.min(4, Math.floor((w * d) / 150)));
  for (let k = 0; k < acCount; k++) {
    const sx = rng.range(1.5, 3), sz = rng.range(1.5, 3), sy = rng.range(1, 1.8);
    // Loose AC units are movable props (SPEC §7.1)
    city.props.push({
      kind: 'ac', x: top.x + rng.range(-top.hx + sx, top.hx - sx), y: roofY + sy / 2 + 0.01,
      z: top.z + rng.range(-top.hz + sz, top.hz - sz), rotY: 0, sx, sy, sz, color: P.AC_UNIT,
    });
  }
  // Water towers: on legs, with a cone roof
  if ((district === 'midtown' || district === 'residential') && rng.chance(0.35) && w > 10 && d > 10) {
    const r = rng.range(2, 3);
    const legH = rng.range(3, 4.5);
    const tankH = rng.range(4, 5.5);
    const tx = top.x + rng.range(-top.hx + r + 1, top.hx - r - 1);
    const tz = top.z + rng.range(-top.hz + r + 1, top.hz - r - 1);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      city.cylinders.push({ x: tx + ox * r * 0.6, y: roofY + legH / 2, z: tz + oz * r * 0.6, radius: 0.15, halfHeight: legH / 2, color: P.LAMP });
    }
    city.cylinders.push({ x: tx, y: roofY + legH + tankH / 2, z: tz, radius: r, halfHeight: tankH / 2, color: P.WATER_TOWER });
    city.cones.push({ x: tx, y: roofY + legH + tankH + 1, z: tz, sx: r * 1.08, sy: 2, sz: r * 1.08, rotY: 0, color: P.WATER_TOWER });
  }
  // Antennas on tall towers
  if (district === 'downtown' && rng.chance(0.45)) {
    const ah = rng.range(8, 25);
    city.cylinders.push({ x: top.x, y: roofY + ah / 2, z: top.z, radius: 0.3, halfHeight: ah / 2, color: P.STEEL });
  }
}

function addBridges(rng: Rng, city: CityData, xBlocks: [number, number][]): void {
  const { z0, z1 } = city.river;
  const streetXs: number[] = [];
  for (let i = 0; i < xBlocks.length - 1; i++) streetXs.push((xBlocks[i][1] + xBlocks[i + 1][0]) / 2);
  const picks = [streetXs[Math.floor(streetXs.length * 0.2)], streetXs[Math.floor(streetXs.length * 0.5)], streetXs[Math.floor(streetXs.length * 0.8)]];
  for (const bx of picks) {
    const deck: Box = {
      x: bx, y: -0.6, z: (z0 + z1) / 2, hx: 9, hy: 0.8, hz: (z1 - z0) / 2 + 6,
      color: P.BRIDGE, roofColor: P.ASPHALT, windows: false, cellW: 4, cellH: 4, collide: true,
    };
    city.slabs.push(deck);
    const towerH = rng.range(45, 65);
    const towerZs = [z0 + (z1 - z0) * 0.25, z0 + (z1 - z0) * 0.75];
    for (const tz of towerZs) {
      for (const side of [-1, 1]) {
        city.structures.push({
          x: bx + side * 10, y: towerH / 2 - 4, z: tz, hx: 1.5, hy: towerH / 2 + 4, hz: 1.5,
          color: P.BRIDGE, roofColor: P.BRIDGE, windows: false, cellW: 4, cellH: 4, collide: true,
        });
      }
      // Cross beam at the top
      city.structures.push({
        x: bx, y: towerH - 3, z: tz, hx: 11.5, hy: 1, hz: 1.2,
        color: P.BRIDGE, roofColor: P.BRIDGE, windows: false, cellW: 4, cellH: 4, collide: true,
      });
    }
    // Decorative cables: tower tops to deck ends and to each other
    for (const side of [-1, 1]) {
      const x = bx + side * 10;
      const tA = towerZs[0], tB = towerZs[1];
      city.cables.push([x, towerH - 2, tA, x, 0.3, z0 - 6]);
      city.cables.push([x, towerH - 2, tA, x, 2, (tA + tB) / 2]);
      city.cables.push([x, towerH - 2, tB, x, 2, (tA + tB) / 2]);
      city.cables.push([x, towerH - 2, tB, x, 0.3, z1 + 6]);
    }
  }
}

function addCranes(rng: Rng, city: CityData): void {
  const { z0, z1 } = city.river;
  for (let i = 0; i < 4; i++) {
    const x = rng.range(-850, 850);
    const z = i % 2 === 0 ? z0 - rng.range(15, 30) : z1 + rng.range(15, 30);
    const h = rng.range(35, 50);
    city.structures.push({ x, y: h / 2, z, hx: 1.6, hy: h / 2, hz: 1.6, color: P.HERO_ORANGE, roofColor: P.HERO_ORANGE, windows: false, cellW: 4, cellH: 4, collide: true });
    const armLen = rng.range(25, 40);
    const dir = z < z0 ? 1 : -1;
    city.structures.push({ x, y: h + 1, z: z + dir * (armLen / 2 - 6), hx: 1, hy: 1, hz: armLen / 2, color: P.HERO_ORANGE, roofColor: P.HERO_ORANGE, windows: false, cellW: 4, cellH: 4, collide: true });
  }
}

const CAR_COLORS = [0xc8402e, 0x2f5d9e, 0xe8b830, 0xeeeae0, 0x2b2b2e, 0x3e7a4a, 0x8a8f96] as const;
const NEWSBOX_COLORS = [0x2f5d9e, 0xc8402e, 0x3e7a4a] as const;
const BARREL_COLORS = [0x9e3b2e, 0x2f5d9e, 0x5f6b3a] as const;

/** Street props on sidewalks, parked cars at curbs, crates/barrels on roofs (SPEC §7.1). */
function addMovableProps(rng: Rng, city: CityData): void {
  const push = (p: Omit<PropSpec, 'sx' | 'sy' | 'sz'> & Partial<PropSpec>): void => {
    city.props.push({ sx: 1, sy: 1, sz: 1, ...p });
  };
  for (const b of city.blocks) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const nearCentre = Math.hypot(cx - DOWNTOWN.x, cz - DOWNTOWN.z) < 900;
    const edges: [number, number, number, number, number][] = [
      // ax, az, bx, bz, outward normal angle (rotY so local +z faces the street)
      [b.x0, b.z0, b.x1, b.z0, Math.PI], [b.x1, b.z0, b.x1, b.z1, Math.PI / 2],
      [b.x1, b.z1, b.x0, b.z1, 0], [b.x0, b.z1, b.x0, b.z0, -Math.PI / 2],
    ];
    for (const [ax, az, bx, bz, rot] of edges) {
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const nx = Math.sin(rot), nz = Math.cos(rot); // outward (towards the street)
      // Sidewalk props, 0.9 m inside the curb, kept away from lamp posts
      if (!b.park) {
        for (let d = 14; d < len - 10; d += rng.range(30, 50)) {
          const px = ax + ux * d - nx * 0.9, pz = az + uz * d - nz * 0.9;
          const roll = rng.next();
          if (roll < 0.4) push({ kind: 'trash', x: px, y: 0.2 + 0.48, z: pz, rotY: 0, color: 0x3d5a45 });
          else if (roll < 0.62) push({ kind: 'newsbox', x: px, y: 0.2 + 0.55, z: pz, rotY: rot, color: rng.pick(NEWSBOX_COLORS) });
          else if (roll < 0.85) push({ kind: 'bench', x: px - nx * 0.3, y: 0.2 + 0.42, z: pz - nz * 0.3, rotY: rot, color: 0x8a5a3a });
        }
      } else {
        for (let d = 20; d < len - 15; d += rng.range(25, 40)) {
          push({ kind: 'bench', x: ax + ux * d - nx * 2, y: 0.2 + 0.42, z: az + uz * d - nz * 2, rotY: rot, color: 0x8a5a3a });
        }
      }
      // Parked cars in the curb lane, parallel to the street
      if (nearCentre) {
        for (let d = 10; d < len - 10; d += 7) {
          if (!rng.chance(0.07)) continue;
          push({
            kind: 'car', x: ax + ux * d + nx * 2.4, y: 0.76, z: az + uz * d + nz * 2.4,
            rotY: Math.atan2(ux, uz) + (rng.chance(0.5) ? Math.PI : 0), color: rng.pick(CAR_COLORS),
          });
          d += 6;
        }
      }
    }
    // A few traffic cones near some corners
    if (rng.chance(0.15)) {
      const k = rng.int(0, 3);
      const corner = [[b.x0, b.z0, -1, -1], [b.x1, b.z0, 1, -1], [b.x1, b.z1, 1, 1], [b.x0, b.z1, -1, 1]][k];
      for (let i = 0; i < 3; i++) {
        push({ kind: 'cone', x: corner[0] + corner[2] * (2 + i * 1.2), y: 0.36, z: corner[1] + corner[3] * 3, rotY: 0, color: 0xf07a24 });
      }
    }
  }
  // Rooftop crates and barrels
  for (const top of city.roofs) {
    if (!rng.chance(0.3) || top.hx < 4 || top.hz < 4) continue;
    const roofY = top.y + top.hy;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const x = top.x + rng.range(-top.hx + 1.5, top.hx - 1.5);
      const z = top.z + rng.range(-top.hz + 1.5, top.hz - 1.5);
      if (rng.chance(0.55)) push({ kind: 'crate', x, y: roofY + 0.5, z, rotY: rng.range(0, Math.PI), color: 0xa9824f });
      else push({ kind: 'barrel', x, y: roofY + 0.55, z, rotY: 0, color: rng.pick(BARREL_COLORS) });
    }
  }
}
