// Render pipeline (SPEC §8): scene → offscreen target → ink-outline + speed-line pass → screen,
// then glowing lines drawn on top with correct depth (the post pass writes scene depth).

import * as THREE from 'three';
import { INK } from '../world/palette';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3 inkColor;
uniform float fogFar;
uniform float speed;
uniform float time;
varying vec2 vUv;

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}
float invDepth(vec2 uv) { return 1.0 / linDepth(texture2D(tDepth, uv).r); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float rawDepth = texture2D(tDepth, vUv).r;
  vec3 col = texture2D(tColor, vUv).rgb;
  float z = linDepth(rawDepth);

  // Depth edges: Laplacian of inverse depth (zero on planes, large at silhouettes/creases)
  float c = 1.0 / z;
  float l = invDepth(vUv - vec2(texel.x, 0.0));
  float r = invDepth(vUv + vec2(texel.x, 0.0));
  float u = invDepth(vUv + vec2(0.0, texel.y));
  float d = invDepth(vUv - vec2(0.0, texel.y));
  float lap = abs(l + r + u + d - 4.0 * c) / max(c, 1e-6);
  float depthEdge = smoothstep(0.08, 0.2, lap);

  // Colour edges: separate toon bands / facade details, faded with distance
  float cl = luma(col);
  float ce = max(max(abs(luma(texture2D(tColor, vUv - vec2(texel.x, 0.0)).rgb) - cl),
                     abs(luma(texture2D(tColor, vUv + vec2(texel.x, 0.0)).rgb) - cl)),
                 max(abs(luma(texture2D(tColor, vUv + vec2(0.0, texel.y)).rgb) - cl),
                     abs(luma(texture2D(tColor, vUv - vec2(0.0, texel.y)).rgb) - cl)));
  float colorEdge = smoothstep(0.12, 0.25, ce) * (1.0 - smoothstep(30.0, 140.0, z));

  float edge = max(depthEdge, colorEdge * 0.8);
  edge *= 1.0 - smoothstep(fogFar * 0.35, fogFar * 0.95, z);
  col = mix(col, inkColor, edge * 0.92);

  // Speed lines at the screen edges
  if (speed > 0.0) {
    vec2 p = vUv - 0.5;
    p.x *= texel.y / texel.x;
    float ang = atan(p.y, p.x);
    float rad = length(p);
    float slot = floor(ang * 70.0);
    float streak = step(0.82, hash(slot + floor(time * 18.0) * 7.31));
    float mask = smoothstep(0.32, 0.75, rad) * streak * speed;
    col = mix(col, vec3(1.0), mask * 0.35);
  }

  gl_FragColor = vec4(col, 1.0);
  gl_FragDepth = rawDepth;
  #include <colorspace_fragment>
}`;

export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;
  readonly overlayScene = new THREE.Scene();
  private renderScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(1);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1),
    });

    this.postMat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        inkColor: { value: new THREE.Color(INK) },
        fogFar: { value: 1000 },
        speed: { value: 0 },
        time: { value: 0 },
      },
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  get gl(): WebGL2RenderingContext {
    return this.renderer.getContext() as WebGL2RenderingContext;
  }

  setSize(w: number, h: number, renderScale: number): void {
    this.renderScale = renderScale;
    this.renderer.setSize(w, h, false);
    const tw = Math.max(1, Math.round(w * renderScale));
    const th = Math.max(1, Math.round(h * renderScale));
    this.target.setSize(tw, th);
    (this.postMat.uniforms.texel.value as THREE.Vector2).set(1 / tw, 1 / th);
  }

  get scale(): number {
    return this.renderScale;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, fogFar: number, speed: number, time: number): void {
    const u = this.postMat.uniforms;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.fogFar.value = fogFar;
    u.speed.value = speed;
    u.time.value = time;

    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.autoClear = true;
    r.render(this.postScene, this.postCam);
    r.autoClear = false;
    r.render(this.overlayScene, camera);
    r.autoClear = true;
  }
}
