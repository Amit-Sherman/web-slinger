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
const BLEND_TIME = 0.15;

interface Particle { p: THREE.Vector3; v: THREE.Vector3 }

interface Strip {
  core: Line2;
  glow: Line2;
}

interface HandVisual {
  strip: Strip;
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
  prev: THREE.Vector3[];
  rest: number[];
  pinned: boolean;
  age: number;
}

function makeStrip(scene: THREE.Scene): Strip {
  const geo = new LineGeometry();
  geo.setPositions([0, 0, 0, 0, 0, 0]);
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

function setStrip(strip: Strip, pts: THREE.Vector3[], opacity: number, width: number): void {
  const flat = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => flat.set([p.x, p.y, p.z], i * 3));
  strip.core.geometry.setPositions(flat);
  strip.core.visible = strip.glow.visible = true;
  strip.core.material.opacity = opacity;
  strip.glow.material.opacity = 0.45 * opacity;
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
    const mk = (): HandVisual => ({
      strip: makeStrip(scene), particles: [], points: [], vels: [], blendFrom: null, blendT: 0,
      lastKind: 'idle', vibration: 0, lastTension: 0,
    });
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
      if (l.kind === 'firing') h.particles.length = 0;
      if (l.kind === 'attached' && h.points.length > 1) {
        h.blendFrom = resample(h.points, null, ROPE_POINTS).p;
        h.blendT = BLEND_TIME;
        h.vibration = 0.6;
      }
      if (l.kind === 'idle' && h.points.length > 1) this.spawnStrand(h, h.lastKind === 'attached');
      if (l.kind === 'idle') h.particles.length = 0;
      h.lastKind = l.kind;
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
      setStrip(h.strip, pts, 1, 1);
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

  /** Detach the current strand: it lingers, falls under gravity and fades out. */
  private spawnStrand(h: HandVisual, wasAttached: boolean): void {
    const { p, v } = resample(h.points, h.vels.length === h.points.length ? h.vels : null, STRAND_POINTS);
    if (this.strands.length >= LINES.maxStrands) this.recycle(this.strands.shift()!);
    const strip = this.spare.pop() ?? makeStrip(this.scene);
    strip.core.material.resolution.copy(this.resolution);
    strip.glow.material.resolution.copy(this.resolution);
    const dt0 = 1 / 60;
    const rest: number[] = [];
    for (let i = 1; i < p.length; i++) rest.push(p[i].distanceTo(p[i - 1]));
    this.strands.push({
      strip,
      pos: p,
      prev: p.map((pp, i) => pp.clone().addScaledVector(v[i], -dt0)),
      rest,
      pinned: wasAttached, // a released attached line still hangs from its anchor (last point)
      age: 0,
    });
  }

  private recycle(s: Strand): void {
    hideStrip(s.strip);
    this.spare.push(s.strip);
  }

  private updateStrands(dt: number): void {
    const step = Math.min(dt, 1 / 30);
    const g = LINES.webGravity * step * step;
    const damp = 1 - 0.8 * step;
    const tmp = this.tmp;
    for (const s of this.strands) {
      s.age += dt;
      const last = s.pos.length - 1;
      for (let i = 0; i <= last; i++) {
        if (s.pinned && i === last) continue;
        const p = s.pos[i];
        tmp.subVectors(p, s.prev[i]).multiplyScalar(damp);
        s.prev[i].copy(p);
        p.add(tmp);
        p.y -= g;
        if (p.y < 0.25) p.y = 0.25; // rest on the street rather than vanishing into it
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
      const fadeStart = LINES.strandLifetime - LINES.strandFade;
      const opacity = s.age < fadeStart ? 0.85 : 0.85 * Math.max(0, 1 - (s.age - fadeStart) / LINES.strandFade);
      setStrip(s.strip, s.pos, opacity, 0.8);
    }
    for (const s of this.strands) if (s.age >= LINES.strandLifetime) this.recycle(s);
    this.strands = this.strands.filter((s) => s.age < LINES.strandLifetime);
  }
}
