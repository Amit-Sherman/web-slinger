// Builds merged box geometry with world-scale facade UVs and per-face colours.

import * as THREE from 'three';
import type { Box } from './cityGen';

const FLAT_UV = 0.02; // a texel of the window mask with no glass/ledge

export function buildBoxesGeometry(boxes: Box[], includeBottom = false): THREE.BufferGeometry {
  const faces = includeBottom ? 6 : 5;
  const n = boxes.length * faces * 4;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const idx = new Uint32Array(boxes.length * faces * 6);
  const c = new THREE.Color();
  const rc = new THREE.Color();
  let v = 0;
  let i = 0;

  const quad = (
    corners: number[][], normal: number[], uvs: number[][], color: THREE.Color,
  ): void => {
    for (let k = 0; k < 4; k++) {
      pos.set(corners[k], (v + k) * 3);
      nor.set(normal, (v + k) * 3);
      uv.set(uvs[k], (v + k) * 2);
      col[(v + k) * 3] = color.r;
      col[(v + k) * 3 + 1] = color.g;
      col[(v + k) * 3 + 2] = color.b;
    }
    idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i);
    v += 4;
    i += 6;
  };

  for (const b of boxes) {
    c.setHex(b.color);
    rc.setHex(b.roofColor);
    const x0 = b.x - b.hx, x1 = b.x + b.hx;
    const y0 = b.y - b.hy, y1 = b.y + b.hy;
    const z0 = b.z - b.hz, z1 = b.z + b.hz;
    const wall = (ha: number, hb: number): number[][] => {
      if (!b.windows) return [[FLAT_UV, FLAT_UV], [FLAT_UV, FLAT_UV], [FLAT_UV, FLAT_UV], [FLAT_UV, FLAT_UV]];
      const u0 = ha / b.cellW, u1 = hb / b.cellW;
      const v0 = y0 / b.cellH, v1 = y1 / b.cellH;
      return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    };
    // +X (counter-clockwise when viewed from outside)
    quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], wall(-z1, -z0), c);
    // -X
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], wall(z0, z1), c);
    // +Z
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], wall(x0, x1), c);
    // -Z
    quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], wall(-x1, -x0), c);
    // +Y roof
    const flat = [[FLAT_UV, FLAT_UV], [FLAT_UV, FLAT_UV], [FLAT_UV, FLAT_UV], [FLAT_UV, FLAT_UV]];
    quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], flat, rc);
    if (includeBottom) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], flat, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
