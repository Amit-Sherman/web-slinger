// Glowing cyan cable visuals (SPEC §9): taut lines vibrate, slack lines sag, misses fall limp.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LINES } from '../config/gameplay';
import type { Hand, LineState } from '../player/state';
import { LINE_CYAN } from '../world/palette';

const SEGMENTS = 24;

interface Visual {
  core: Line2;
  glow: Line2;
  geo: LineGeometry;
  positions: Float32Array;
  missStart: THREE.Vector3;
  retractFrom: THREE.Vector3;
  lastKind: LineState['kind'];
  vibration: number;
}

export class LineVisuals {
  private visuals: [Visual, Visual];
  private t = 0;
  private p = new THREE.Vector3();
  private end = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.visuals = [this.make(scene), this.make(scene)];
  }

  private make(scene: THREE.Scene): Visual {
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const geo = new LineGeometry();
    geo.setPositions(positions);
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
    return { core, glow, geo, positions, missStart: new THREE.Vector3(), retractFrom: new THREE.Vector3(), lastKind: 'idle', vibration: 0 };
  }

  setResolution(w: number, h: number): void {
    for (const v of this.visuals) {
      v.core.material.resolution.set(w, h);
      v.glow.material.resolution.set(w, h);
    }
  }

  update(lines: [LineState, LineState], wrists: [THREE.Vector3, THREE.Vector3], body: THREE.Vector3, dt: number): void {
    this.t += dt;
    for (const hand of [0, 1] as Hand[]) {
      const v = this.visuals[hand];
      const l = lines[hand];
      const start = wrists[hand];

      if (l.kind !== v.lastKind) {
        if (l.kind === 'missed') v.missStart.copy(l.target);
        if (l.kind === 'retracting') v.retractFrom.copy(v.lastKind === 'firing' ? this.end.copy(start).lerp(l.target, l.progress) : l.target);
        if (l.kind === 'attached') v.vibration = 1;
        v.lastKind = l.kind;
      }
      if (l.kind === 'idle') {
        v.core.visible = v.glow.visible = false;
        continue;
      }
      v.core.visible = v.glow.visible = true;

      let sag = 0;
      let opacity = 1;
      const end = this.end;
      switch (l.kind) {
        case 'firing':
          end.copy(start).lerp(l.target, l.progress);
          break;
        case 'attached': {
          end.copy(l.target);
          const dist = body.distanceTo(l.target);
          const slack = Math.max(0, l.length - dist);
          sag = Math.min(Math.sqrt(slack * l.length) * 0.5, dist * 0.4);
          if (l.tension > 8) v.vibration = Math.min(1, v.vibration + l.tension * 0.01);
          break;
        }
        case 'missed': {
          const k = 1 - l.timer / LINES.missFallTime; // 0 → 1
          end.copy(v.missStart);
          end.y -= 18 * k * k;
          sag = start.distanceTo(end) * 0.25 * k;
          opacity = 1 - k;
          break;
        }
        case 'retracting': {
          const k = 1 - l.timer / LINES.retractTime;
          end.copy(v.retractFrom).lerp(start, k);
          opacity = 1 - k * 0.6;
          break;
        }
      }
      v.vibration = Math.max(0, v.vibration - dt * 3);

      const pos = v.positions;
      const len = start.distanceTo(end);
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        this.p.copy(start).lerp(end, t);
        const env = 4 * t * (1 - t);
        this.p.y -= sag * env;
        if (v.vibration > 0) {
          const amp = v.vibration * Math.min(0.35, len * 0.01) * env;
          this.p.x += Math.sin(t * 18 + this.t * 70) * amp;
          this.p.y += Math.cos(t * 15 + this.t * 63) * amp;
        }
        pos[i * 3] = this.p.x;
        pos[i * 3 + 1] = this.p.y;
        pos[i * 3 + 2] = this.p.z;
      }
      v.geo.setPositions(pos);
      v.core.material.opacity = opacity;
      v.glow.material.opacity = 0.45 * opacity;
    }
  }
}
