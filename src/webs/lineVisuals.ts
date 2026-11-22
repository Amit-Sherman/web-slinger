// Web visuals (SPEC §5.1, §9): glowing cyan strands.
// - Firing: a continuous stream of particles leaves the launcher nozzle and falls under gravity,
//   like water from a hose; the far end is the gameplay tip.
// - Attached: an elastic line (sags when slack, thins when stretched, twangs on tension spikes).
//   On attach, the curved stream blends into the line shape.
// - Released: the strand detaches, lingers and falls under gravity (hanging from its anchor if it
//   was attached), fades out and is removed. A capped pool keeps the cost bounded.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LINES } from '../config/gameplay';
import type { Hand, LineState } from '../player/state';
import { LINE_CYAN } from '../world/palette';
import { launchVelocity } from './ballistics';

const ROPE_POINTS = 25;
const STRAND_POINTS = 24;
const MAX_STREAM_PARTICLES = 160;
// Every strip is allocated once at this many points and updated in place. three.js locks an
// instanced geometry's drawable count the first time it renders, so growing a line by calling
// setPositions() with a longer array silently truncates it (this hid the web stream).
const STRIP_CAPACITY = MAX_STREAM_PARTICLES + 8;
const BLEND_TIME = 0.15;
const FLASH_TIME = 0.14;
const SPLAT_TIME = 0.5;
const PULSE_SPEED = 45; // m/s the dash pattern flows outward along a stream

/** Soft round glow texture shared by the tip, muzzle flash and splat sprites. */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(200,255,255,0.95)');
  grad.addColorStop(0.55, 'rgba(95,244,255,0.45)');
  grad.addColorStop(1, 'rgba(95,244,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowSprite(tex: THREE.Texture, screenSpace: boolean): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: !screenSpace,
  }));
  s.visible = false;
  s.frustumCulled = false;
  return s;
}

interface Particle { p: THREE.Vector3; v: THREE.Vector3 }

interface Strip {
  core: Line2;
  glow: Line2;
}

interface HandVisual {
  strip: Strip;
  tip: THREE.Sprite; // bright glob leading the stream (constant screen size)
  flash: THREE.Sprite; // muzzle flash at the nozzle when firing starts
  splat: THREE.Sprite; // burst where the stream catches
  flashT: number;
  splatT: number;
  pulse: number;
  particles: Particle[]; // oldest first
  points: THREE.Vector3[]; // what was drawn last frame (for release / blend)
  vels: THREE.Vector3[]; // matching velocities (for release)
  blendFrom: THREE.Vector3[] | null;
  blendT: number;
  lastKind: LineState['kind'];
  vibration: number;
  lastTension: number;
}

interface Strand {
  strip: Strip;
  pos: THREE.Vector3[];
  vel: THREE.Vector3[];
  old: THREE.Vector3[];
  rest: number[];
  pinned: boolean;
  age: number;
}

function makeStrip(scene: THREE.Scene): Strip {
  const geo = new LineGeometry();
  geo.setPositions(new Float32Array(STRIP_CAPACITY * 3));
  geo.instanceCount = 0;
  const core = new Line2(geo, new LineMaterial({ color: 0xe8ffff, linewidth: 2.2, worldUnits: false, transparent: true }));
  const glow = new Line2(geo, new LineMaterial({
    color: LINE_CYAN, linewidth: 7, worldUnits: false, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  for (const l of [core, glow]) {
    l.frustumCulled = false;
    l.visible = false;
    scene.add(l);
  }
  return { core, glow };
}

function setDashed(strip: Strip, dashed: boolean): void {
  const m = strip.core.material;
  if (m.dashed === dashed) return;
  m.dashed = dashed;
  m.dashSize = 3;
  m.gapSize = 1.2;
  m.needsUpdate = true;
}

/** Write a polyline into the strip's fixed-capacity segment buffer (start/end pairs). */
function writePoints(geo: LineGeometry, pts: THREE.Vector3[]): void {
  const n = Math.min(pts.length, STRIP_CAPACITY);
  const start = geo.attributes.instanceStart as THREE.InterleavedBufferAttribute;
  const buf = start.data;
  const a = buf.array as Float32Array;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const o = i * 6;
    a[o] = p.x; a[o + 1] = p.y; a[o + 2] = p.z;
    a[o + 3] = q.x; a[o + 4] = q.y; a[o + 5] = q.z;
  }
  buf.needsUpdate = true;
  geo.instanceCount = Math.max(0, n - 1);
}

function setStrip(strip: Strip, pts: THREE.Vector3[], opacity: number, width: number, glow = 0.45): void {
  writePoints(strip.core.geometry, pts);
  strip.core.visible = strip.glow.visible = true;
  strip.core.material.opacity = opacity;
  strip.glow.material.opacity = glow * opacity;
  strip.core.material.linewidth = 2.2 * width;
  strip.glow.material.linewidth = 7 * width;
}

function hideStrip(strip: Strip): void {
  strip.core.visible = strip.glow.visible = false;
}

/** Resample a polyline (and optional per-point velocities) to n points evenly spaced by arc length. */
function resample(pts: THREE.Vector3[], vels: THREE.Vector3[] | null, n: number): { p: THREE.Vector3[]; v: THREE.Vector3[] } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1] || 1;
  const outP: THREE.Vector3[] = [];
  const outV: THREE.Vector3[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (j < pts.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = THREE.MathUtils.clamp((target - cum[j]) / seg, 0, 1);
    const j1 = Math.min(j + 1, pts.length - 1);
    outP.push(pts[j].clone().lerp(pts[j1], t));
    outV.push(vels ? vels[j].clone().lerp(vels[j1], t) : new THREE.Vector3());
  }
  return { p: outP, v: outV };
}

export class LineVisuals {
  private hands: [HandVisual, HandVisual];
  private strands: Strand[] = [];
  private spare: Strip[] = [];
  private t = 0;
  private resolution = new THREE.Vector2(1, 1);
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const tex = glowTexture();
    const mk = (): HandVisual => {
      const tip = glowSprite(tex, true);
      const flash = glowSprite(tex, true);
      const splat = glowSprite(tex, false);
      scene.add(tip, flash, splat);
      return {
        strip: makeStrip(scene), tip, flash, splat, flashT: 0, splatT: 0, pulse: 0,
        particles: [], points: [], vels: [], blendFrom: null, blendT: 0,
        lastKind: 'idle', vibration: 0, lastTension: 0,
      };
    };
    this.hands = [mk(), mk()];
  }

  setResolution(w: number, h: number): void {
    this.resolution.set(w, h);
    const all = [...this.hands.map((h) => h.strip), ...this.strands.map((s) => s.strip), ...this.spare];
    for (const s of all) {
      s.core.material.resolution.copy(this.resolution);
      s.glow.material.resolution.copy(this.resolution);
    }
  }

  update(
    lines: [LineState, LineState], nozzles: [THREE.Vector3, THREE.Vector3], body: THREE.Vector3,
    aim: THREE.Vector3, playerVel: THREE.Vector3, dt: number,
  ): void {
    this.t += dt;
    for (const hand of [0, 1] as Hand[]) this.updateHand(hand, lines[hand], nozzles[hand], body, aim, playerVel, dt);
    this.updateStrands(dt);
  }

  private updateHand(
    hand: Hand, l: LineState, nozzle: THREE.Vector3, body: THREE.Vector3,
    aim: THREE.Vector3, playerVel: THREE.Vector3, dt: number,
  ): void {
    const h = this.hands[hand];

    // State transitions
    if (l.kind !== h.lastKind) {
      if (l.kind === 'firing') {
        h.particles.length = 0;
        h.flashT = FLASH_TIME;
        setDashed(h.strip, true);
      } else {
        setDashed(h.strip, false);
      }
      if (l.kind === 'attached') {
        h.splatT = SPLAT_TIME;
        h.splat.position.copy(l.target);
      }
      if (l.kind === 'attached' && h.points.length > 1) {
        h.blendFrom = resample(h.points, null, ROPE_POINTS).p;
        h.blendT = BLEND_TIME;
        h.vibration = 0.6;
      }
      if (l.kind === 'idle' && h.points.length > 1) this.spawnStrand(h, h.lastKind === 'attached');
      if (l.kind === 'idle') h.particles.length = 0;
      h.lastKind = l.kind;
    }

    this.updateSprites(h, nozzle, dt);
    h.tip.visible = l.kind === 'firing';
    if (l.kind === 'firing') {
      h.tip.position.copy(l.target);
      const flicker = 1 + Math.sin(this.t * 90 + hand * 2) * 0.12;
      h.tip.scale.setScalar(0.034 * flicker);
    }

    if (l.kind === 'idle') {
      hideStrip(h.strip);
      h.points = [];
      h.vels = [];
      return;
    }

    if (l.kind === 'firing') {
      // Integrate stream particles, emit a new one at the nozzle each frame
      for (const p of h.particles) {
        p.v.y -= LINES.webGravity * dt;
        p.p.addScaledVector(p.v, dt);
      }
      h.particles.push({ p: nozzle.clone(), v: launchVelocity(new THREE.Vector3(), aim, playerVel) });
      if (h.particles.length > MAX_STREAM_PARTICLES) {
        // Thin out the oldest half so an endless stream stays cheap
        const half = Math.floor(h.particles.length / 2);
        h.particles = h.particles.filter((_, i) => i >= half || i % 2 === 0);
      }
      const pts = [nozzle.clone()];
      const vels = [launchVelocity(new THREE.Vector3(), aim, playerVel)];
      for (let i = h.particles.length - 1; i >= 0; i--) {
        pts.push(h.particles[i].p.clone());
        vels.push(h.particles[i].v.clone());
      }
      pts.push(l.target.clone());
      vels.push(l.tipVel.clone());
      h.points = pts;
      h.vels = vels;
      // Streams are brighter and thicker than attached lines, with pulses flowing outward
      setStrip(h.strip, pts, 1, 1.35, 0.75);
      h.strip.core.computeLineDistances();
      h.pulse -= PULSE_SPEED * dt;
      h.strip.core.material.dashOffset = h.pulse;
      return;
    }

    // Attached: elastic line from the nozzle to the anchor
    const dist = body.distanceTo(l.target);
    const slack = Math.max(0, l.length - dist);
    const sag = Math.min(Math.sqrt(slack * l.length) * 0.5, dist * 0.4);
    const strain = Math.max(0, (dist - l.length) / l.length);
    const thin = 1 - Math.min(0.55, strain * 3);
    const jump = l.tension - h.lastTension;
    if (jump > 4) h.vibration = Math.min(1, h.vibration + jump * 0.015);
    h.lastTension = l.tension;
    h.vibration = Math.max(0, h.vibration - dt * 3);

    const len = nozzle.distanceTo(l.target);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < ROPE_POINTS; i++) {
      const t = i / (ROPE_POINTS - 1);
      const p = nozzle.clone().lerp(l.target, t);
      const env = 4 * t * (1 - t);
      p.y -= sag * env;
      if (h.vibration > 0) {
        const amp = h.vibration * Math.min(0.35, len * 0.01) * env;
        p.x += Math.sin(t * 18 + this.t * 70) * amp;
        p.y += Math.cos(t * 15 + this.t * 63) * amp;
      }
      pts.push(p);
    }
    if (h.blendFrom && h.blendT > 0) {
      h.blendT = Math.max(0, h.blendT - dt);
      const k = 1 - h.blendT / BLEND_TIME;
      const from = h.blendFrom;
      pts.forEach((p, i) => p.lerpVectors(from[i], p, k));
      if (h.blendT === 0) h.blendFrom = null;
    }
    h.points = pts;
    // Hand end moves with the player, anchor end is still
    h.vels = pts.map((_, i) => playerVel.clone().multiplyScalar(1 - i / (ROPE_POINTS - 1)));
    setStrip(h.strip, pts, 1, thin);
  }

  /** Muzzle flash at the nozzle and catch splat at the anchor, both short fades. */
  private updateSprites(h: HandVisual, nozzle: THREE.Vector3, dt: number): void {
    h.flashT = Math.max(0, h.flashT - dt);
    h.flash.visible = h.flashT > 0;
    if (h.flash.visible) {
      const k = h.flashT / FLASH_TIME;
      h.flash.position.copy(nozzle);
      h.flash.scale.setScalar(0.05 + 0.06 * (1 - k));
      h.flash.material.opacity = k;
    }
    h.splatT = Math.max(0, h.splatT - dt);
    h.splat.visible = h.splatT > 0;
    if (h.splat.visible) {
      const k = h.splatT / SPLAT_TIME;
      // World-space burst that grows and fades; never smaller than ~1.5% of the distance so far catches read
      const d = h.splat.position.distanceTo(nozzle);
      h.splat.scale.setScalar(Math.max(0.8, d * 0.03) * (1.6 - k * 0.8));
      h.splat.material.opacity = k * k;
    }
  }

  /** Detach the current strand: it lingers, falls under gravity and fades out. */
  private spawnStrand(h: HandVisual, wasAttached: boolean): void {
    const { p, v } = resample(h.points, h.vels.length === h.points.length ? h.vels : null, STRAND_POINTS);
    if (this.strands.length >= LINES.maxStrands) this.recycle(this.strands.shift()!);
    const strip = this.spare.pop() ?? makeStrip(this.scene);
    strip.core.material.resolution.copy(this.resolution);
    strip.glow.material.resolution.copy(this.resolution);
    const rest: number[] = [];
    for (let i = 1; i < p.length; i++) rest.push(p[i].distanceTo(p[i - 1]));
    this.strands.push({
      strip,
      pos: p,
      vel: v,
      old: p.map((pp) => pp.clone()),
      rest,
      pinned: wasAttached, // a released attached line still hangs from its anchor (last point)
      age: 0,
    });
  }

  private recycle(s: Strand): void {
    hideStrip(s.strip);
    this.spare.push(s.strip);
  }

  /** Position-based strand sim with explicit velocities (correct for any frame time). */
  private updateStrands(dt: number): void {
    const tmp = this.tmp;
    for (const s of this.strands) {
      s.age += dt;
      const last = s.pos.length - 1;
      if (dt > 1e-5) {
        const damp = Math.max(0, 1 - 0.8 * dt);
        for (let i = 0; i <= last; i++) {
          s.old[i].copy(s.pos[i]);
          if (s.pinned && i === last) continue;
          const v = s.vel[i];
          v.y -= LINES.webGravity * dt;
          v.multiplyScalar(damp);
          s.pos[i].addScaledVector(v, dt);
          if (s.pos[i].y < 0.25) s.pos[i].y = 0.25; // rest on the street rather than vanishing into it
        }
        for (let it = 0; it < 4; it++) {
          for (let i = 0; i < last; i++) {
            const a = s.pos[i], b = s.pos[i + 1];
            tmp.subVectors(b, a);
            const d = tmp.length() || 1e-6;
            const diff = (d - s.rest[i]) / d;
            if (s.pinned && i + 1 === last) {
              a.addScaledVector(tmp, diff);
            } else {
              a.addScaledVector(tmp, diff * 0.5);
              b.addScaledVector(tmp, -diff * 0.5);
            }
          }
        }
        for (let i = 0; i <= last; i++) s.vel[i].subVectors(s.pos[i], s.old[i]).divideScalar(dt);
      }
      const fadeStart = LINES.strandLifetime - LINES.strandFade;
      const opacity = s.age < fadeStart ? 0.85 : 0.85 * Math.max(0, 1 - (s.age - fadeStart) / LINES.strandFade);
      setStrip(s.strip, s.pos, opacity, 0.8);
    }
    for (const s of this.strands) if (s.age >= LINES.strandLifetime) this.recycle(s);
    this.strands = this.strands.filter((s) => s.age < LINES.strandLifetime);
  }
}
