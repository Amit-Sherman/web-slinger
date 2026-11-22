// Cel-shaded materials (SPEC §8).

import * as THREE from 'three';
import { GLASS_COLOR } from '../world/palette';

let gradient: THREE.DataTexture | null = null;

/** 3-step light ramp shared by every toon material. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = new Uint8Array([110, 185, 255]);
  gradient = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}

/**
 * Window mask texture for one facade cell (tiles via world-scale UVs).
 * R = glass, G = floor ledge. Data texture, not colour.
 */
function windowMaskTexture(anisotropy: number): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(0,0,0)';
  g.fillRect(0, 0, size, size);
  // ledge (bottom of the cell, canvas y is flipped vs UV v)
  g.fillStyle = 'rgb(0,255,0)';
  g.fillRect(0, size - 14, size, 14);
  // glass
  g.fillStyle = 'rgb(255,0,0)';
  g.fillRect(size * 0.18, size * 0.22, size * 0.64, size * 0.56);
  // mullion
  g.fillStyle = 'rgb(0,0,0)';
  g.fillRect(size * 0.49, size * 0.22, size * 0.02, size * 0.56);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** Toon material for buildings: vertex colour = facade/roof tint, map = window mask. */
export function buildingMaterial(anisotropy: number): THREE.MeshToonMaterial {
  const mat = toon({ vertexColors: true, map: windowMaskTexture(anisotropy) });
  const glass = new THREE.Color(GLASS_COLOR);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.glassColor = { value: glass };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 glassColor;\nvoid main() {')
      .replace('#include <map_fragment>', '')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_MAP
  vec4 wm = texture2D( map, vMapUv );
  diffuseColor.rgb *= 1.0 - 0.18 * wm.g;
  diffuseColor.rgb = mix( diffuseColor.rgb, glassColor, wm.r );
  totalEmissiveRadiance += glassColor * 0.22 * wm.r;
#endif`,
      );
  };
  return mat;
}
