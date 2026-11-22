// Web tethers (SPEC §5.4), key F: web two things together. Once joined you can't control the
// strand. It just holds: rest length = the distance at the moment it connects, elastic beyond that.
//
//   F         → a web stream (left launcher) flies to end A (anything: prop, wall, pole, street).
//   F again   → a second stream to end B; A and B are joined by one strand.
//   Shift+F   → (while A waits) tie A to yourself instead. F while tied cuts your tether.
//
// Prop ends get equal and opposite elastic forces (two-body); static ends don't move. A strand
// between two static points gets a thin collider: you can stand on it and anchor lines to it.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TETHER } from '../config/gameplay';
import type { Physics } from '../core/physics';
import type { InputSnapshot } from '../input/input';
import { type LineState, newLine, type PlayerState } from '../player/state';
import type { Props } from '../world/props';
import { launchVelocity, refreshAnchor, setAnchor, stepTip } from './ballistics';
import { hideStrip, makeStrip, setStrip, type Strip } from './lineVisuals';
import { solveLine } from './lines';

interface End {
  target: THREE.Vector3;
  anchorBody: number;
  anchorLocal: THREE.Vector3;
}

interface Tether {
  a: End;
  b: End;
  rest: number;
  collider: RAPIER.Collider | null; // static↔static strands are solid
  strip: Strip;
  fade: number; // >0 while fading out after removal
}

const SELF_LINE = { elasticity: TETHER.elasticity, dampingRatio: TETHER.dampingRatio, maxStretch: 1 };
const POINTS = 20;

const n = new THREE.Vector3();
const tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function copyEnd(src: End): End {
  return { target: src.target.clone(), anchorBody: src.anchorBody, anchorLocal: src.anchorLocal.clone() };
}

export class Tethers {
  /** The stream currently in flight (drawn by LineVisuals as the 4th line, from the left launcher). */
  readonly shot: LineState = newLine();
  /** First end, waiting for the second. */
  private pending: End | null = null;
  private pendingAge = 0;
  /** A tether from you to something (behaves like a swing line you can't reel or release). */
  readonly self: LineState = newLine();
  private tethers: Tether[] = [];
  private fading: Tether[] = [];
  private pendingStrip: Strip;
  private resolution = new THREE.Vector2(1, 1);

  constructor(private scene: THREE.Scene, private physics: Physics, private props: Props) {
    this.pendingStrip = makeStrip(scene);
  }

  get status(): string {
    if (this.self.kind === 'attached') return 'TIED · F to cut';
    if (this.pending) return 'TETHER · F: 2nd end · Shift+F: tie to you';
    if (this.shot.kind === 'firing') return 'TETHER';
    return '';
  }

  /** Fixed tick: input, stream flight, forces. */
  tick(p: PlayerState, input: InputSnapshot, eye: THREE.Vector3, aim: THREE.Vector3, self: RAPIER.Collider, dt: number): void {
    const shot = this.shot;

    if (input.pressed.tether) {
      if (this.self.kind === 'attached') {
        // Cut your own tether
        this.self.kind = 'idle';
        p.events.push({ type: 'tetherCut' });
      } else if (this.pending && input.down.modifier && shot.kind !== 'firing') {
        // Tie the waiting end to yourself
        const l = this.self;
        l.kind = 'attached';
        l.target.copy(this.pending.target);
        l.anchorBody = this.pending.anchorBody;
        l.anchorLocal.copy(this.pending.anchorLocal);
        l.length = Math.max(1, p.pos.distanceTo(l.target));
        l.holding = false;
        this.pending = null;
        shot.noStrand = true;
        shot.kind = 'idle';
        p.events.push({ type: 'tetherConnect' });
      } else if (shot.kind !== 'firing') {
        shot.noStrand = shot.kind === 'attached'; // the A strand stays (drawn by us), no falling copy
        shot.kind = 'firing';
        shot.target.copy(eye).addScaledVector(aim, 0.4);
        launchVelocity(shot.tipVel, aim, p.vel);
        shot.flightTime = 0;
        p.events.push({ type: 'tetherFire' });
      }
    }

    if (shot.kind === 'firing') {
      shot.flightTime += dt;
      const hit = stepTip(shot.target, shot.tipVel, dt, this.physics, self);
      if (hit) {
        const end: End = { target: new THREE.Vector3(), anchorBody: -1, anchorLocal: new THREE.Vector3() };
        setAnchor(end, hit, this.physics);
        if (!this.pending) {
          // First end stuck: show a strand from your hand to it while you pick the second end
          this.pending = end;
          this.pendingAge = 0;
          shot.kind = 'attached';
          shot.target.copy(end.target);
          shot.anchorBody = end.anchorBody;
          shot.anchorLocal.copy(end.anchorLocal);
          shot.length = p.pos.distanceTo(end.target);
          p.events.push({ type: 'tetherEnd' });
        } else {
          this.connect(this.pending, end);
          this.pending = null;
          shot.noStrand = true;
          shot.kind = 'idle';
          p.events.push({ type: 'tetherConnect' });
        }
      }
    } else if (shot.kind === 'attached' && this.pending) {
      // Waiting strand follows its end and never pulls (it's slack line paying out from the launcher)
      refreshAnchor(shot, this.physics);
      shot.length = Math.max(shot.length, p.pos.distanceTo(shot.target));
      this.pendingAge += dt;
      if (this.pendingAge > TETHER.pendingTimeout) {
        this.pending = null;
        shot.kind = 'idle'; // leaves a falling strand like any released line
      }
    }

    // Your own tether acts like a swing line you can't reel
    if (this.self.kind === 'attached') {
      refreshAnchor(this.self, this.physics);
      solveLine(p, this.self, SELF_LINE, this.physics, dt);
    }

    for (const t of this.tethers) this.applyForces(t, dt);
  }

  private connect(a: End, b: End): void {
    const ea = copyEnd(a), eb = copyEnd(b);
    const rest = Math.max(0.5, ea.target.distanceTo(eb.target));
    let collider: RAPIER.Collider | null = null;
    if (ea.anchorBody < 0 && eb.anchorBody < 0 && rest > 1) {
      // Static ↔ static: a solid strand (stand on it, anchor lines to it)
      const R = this.physics.R;
      const mid = tmp.addVectors(ea.target, eb.target).multiplyScalar(0.5);
      n.subVectors(eb.target, ea.target).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
      collider = this.physics.world.createCollider(
        R.ColliderDesc.capsule(rest / 2, TETHER.strandRadius)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
    }
    if (this.tethers.length >= TETHER.maxTethers) this.remove(this.tethers[0]);
    const strip = makeStrip(this.scene);
    strip.core.material.resolution.copy(this.resolution);
    strip.glow.material.resolution.copy(this.resolution);
    this.tethers.push({ a: ea, b: eb, rest, collider, strip, fade: 0 });
  }

  private remove(t: Tether): void {
    this.tethers.splice(this.tethers.indexOf(t), 1);
    if (t.collider) this.physics.world.removeCollider(t.collider, false);
    t.fade = TETHER.fadeTime;
    this.fading.push(t);
  }

  private massOf(body: RAPIER.RigidBody | null): number {
    if (!body || !body.isDynamic()) return Infinity;
    return this.props.get(body)?.mass ?? body.mass();
  }

  /** Two-body elastic pull between the ends (static ends don't move). */
  private applyForces(t: Tether, dt: number): void {
    const ba = refreshAnchor(t.a, this.physics);
    const bb = refreshAnchor(t.b, this.physics);
    const ma = this.massOf(ba), mb = this.massOf(bb);
    if (ma === Infinity && mb === Infinity) return;
    n.subVectors(t.b.target, t.a.target);
    const d = n.length();
    if (d <= t.rest || d < 1e-4) return;
    n.divideScalar(d);
    const va = ma < Infinity ? ba!.linvel() : { x: 0, y: 0, z: 0 };
    const vb = mb < Infinity ? bb!.linvel() : { x: 0, y: 0, z: 0 };
    const vrel = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y + (vb.z - va.z) * n.z; // + = separating
    const mLight = Math.min(ma, mb);
    // Stiffness like a swing line, capped so very light props stay numerically stable
    const k = Math.min((TETHER.elasticity * TETHER.forceMass) / t.rest, (0.25 * mLight) / (dt * dt));
    const c = 2 * TETHER.dampingRatio * Math.sqrt(k * mLight);
    const f = Math.max(0, k * (d - t.rest) + c * vrel);
    const imp = f * dt;
    if (ma < Infinity) ba!.applyImpulseAtPoint({ x: n.x * imp, y: n.y * imp, z: n.z * imp }, t.a.target, true);
    if (mb < Infinity) bb!.applyImpulseAtPoint({ x: -n.x * imp, y: -n.y * imp, z: -n.z * imp }, t.b.target, true);
  }

  /** Render frame: draw joined strands (sag when slack, thin when stretched), the waiting strand, fades. */
  render(nozzle: THREE.Vector3, dt: number): void {
    for (const t of this.tethers) this.drawStrand(t.strip, t.a.target, t.b.target, t.rest, 1);
    for (const t of [...this.fading]) {
      t.fade -= dt;
      if (t.fade <= 0) {
        hideStrip(t.strip);
        this.scene.remove(t.strip.core, t.strip.glow);
        this.fading.splice(this.fading.indexOf(t), 1);
      } else {
        this.drawStrand(t.strip, t.a.target, t.b.target, t.rest, t.fade / TETHER.fadeTime);
      }
    }
    // While the second stream flies, keep showing the first end's strand from your hand
    if (this.pending && this.shot.kind === 'firing') {
      const len = nozzle.distanceTo(this.pending.target);
      this.drawStrand(this.pendingStrip, nozzle, this.pending.target, len * 1.05, 0.9);
    } else {
      hideStrip(this.pendingStrip);
    }
  }

  private drawStrand(strip: Strip, a: THREE.Vector3, b: THREE.Vector3, rest: number, opacity: number): void {
    const d = a.distanceTo(b);
    const slack = Math.max(0, rest - d);
    const sag = Math.min(Math.sqrt(slack * rest) * 0.5, d * 0.4);
    const strain = Math.max(0, (d - rest) / rest);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1);
      const p = a.clone().lerp(b, t);
      p.y -= sag * 4 * t * (1 - t);
      pts.push(p);
    }
    setStrip(strip, pts, opacity * 0.95, 0.85 * (1 - Math.min(0.55, strain * 3)));
  }

  setResolution(w: number, h: number): void {
    this.resolution.set(w, h);
    for (const s of [this.pendingStrip, ...this.tethers.map((t) => t.strip)]) {
      s.core.material.resolution.set(w, h);
      s.glow.material.resolution.set(w, h);
    }
  }
}
