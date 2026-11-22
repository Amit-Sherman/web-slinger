// Gradient sky dome + sun, and the sun light whose shadow follows the player (SPEC §8, §13).

import * as THREE from 'three';
import type { PresetValues } from '../config/settings';
import { FOG, SKY_HORIZON, SKY_TOP } from '../world/palette';

export class Sky {
  readonly dome: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3(0.45, 0.75, 0.35).normalize();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
        sunDir: { value: this.sunDir },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.55));
          float s = dot(normalize(vDir), sunDir);
          col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.9965, 0.998, s));
          col += vec3(1.0, 0.85, 0.6) * pow(max(s, 0.0), 40.0) * 0.25;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xfff3dc, 0x9a8a74, 1.1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = new THREE.Fog(FOG, 200, 1200);
  }

  applyPreset(p: PresetValues, scene: THREE.Scene): void {
    const s = this.sun.shadow;
    if (s.mapSize.x !== p.shadowMapSize) {
      s.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      s.map?.dispose();
      s.map = null;
    }
    const cam = s.camera;
    cam.left = cam.bottom = -p.shadowExtent;
    cam.right = cam.top = p.shadowExtent;
    cam.near = 1;
    cam.far = 900;
    cam.updateProjectionMatrix();
    const fog = scene.fog as THREE.Fog;
    fog.near = p.drawDistance * 0.3;
    fog.far = p.drawDistance;
  }

  /** Keep the dome centred on the camera and the shadow frustum centred on the player. */
  update(cameraPos: THREE.Vector3, focus: THREE.Vector3, far: number): void {
    this.dome.position.copy(cameraPos);
    this.dome.scale.setScalar(far * 0.9);
    // Snap the shadow centre to texel-ish increments to reduce shimmering
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, Math.max(0, focus.y - 30), fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 450);
  }
}
