// Minimal visor-styled HUD (SPEC §12.1): crosshair + two rope gauges.

import * as THREE from 'three';
import type { LineState } from '../player/state';

const GAUGE_FULL_LENGTH = 120; // metres shown as a full gauge

/** Write a DOM property only when it changes (avoids style/layout work every frame). */
const last = new WeakMap<object, Map<string, string>>();
function set(el: HTMLElement | CSSStyleDeclaration, key: string, value: string): void {
  let m = last.get(el);
  if (!m) last.set(el, (m = new Map()));
  if (m.get(key) === value) return;
  m.set(key, value);
  (el as unknown as Record<string, string>)[key] = value;
}

export class Hud {
  private root = document.getElementById('hud')!;
  private crosshair = document.getElementById('crosshair')!;
  private dist = document.getElementById('crosshair-dist')!;
  private gauges = [document.getElementById('gauge-left')!, document.getElementById('gauge-right')!];
  private extra = document.getElementById('hud-extra')!;
  private marker = document.getElementById('impact-marker')!;
  private pullEl = document.getElementById('pull-state')!;
  private headEl = document.getElementById('head-state')!;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();

  show(visible: boolean): void {
    set(this.root.style, 'display', visible ? 'block' : 'none');
  }

  /** `impact`: where a stream fired now would land (ballistic prediction), shown as a marker. */
  update(
    impact: { point: THREE.Vector3; distance: number } | null, camera: THREE.Camera,
    lines: [LineState, LineState], bodyDist: [number, number], speed: number, altitude: number,
    pull: LineState, tetherStatus: string, aimPoint: THREE.Vector3, headStatus: string,
  ): void {
    // Crosshair sits where the (mouse) aim points; centred unless head-tracking moves the view
    const a = this.v.copy(aimPoint).project(camera);
    const onScreen = a.z < 1 && Math.abs(a.x) < 1 && Math.abs(a.y) < 1;
    set(this.crosshair.style, 'display', onScreen ? 'block' : 'none');
    set(this.crosshair.style, 'left', `${((a.x + 1) / 2) * 100}%`);
    set(this.crosshair.style, 'top', `${((1 - a.y) / 2) * 100}%`);
    set(this.headEl, 'textContent', headStatus);
    set(this.headEl, 'className', headStatus === 'HEAD' ? 'ok' : '');
    set(this.pullEl.style, 'left', this.crosshair.style.left);
    set(this.pullEl.style, 'top', `calc(${this.crosshair.style.top} + 26px)`);
    this.pullEl.textContent = tetherStatus || (pull.holding ? 'HOLDING · release middle mouse to throw'
      : pull.kind === 'attached' ? 'PULLING' : pull.kind === 'firing' ? 'PULL' : '');
    this.crosshair.classList.toggle('lock', !!impact);
    if (impact) {
      const p = this.v.copy(impact.point).project(camera);
      const inFront = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      set(this.marker.style, 'display', inFront ? 'block' : 'none');
      set(this.marker.style, 'left', `${((p.x + 1) / 2) * 100}%`);
      set(this.marker.style, 'top', `${((1 - p.y) / 2) * 100}%`);
      set(this.dist, 'textContent', `${impact.point.distanceTo(camera.getWorldPosition(this.w)).toFixed(0)}m`);
    } else {
      set(this.marker.style, 'display', 'none');
      set(this.dist, 'textContent', '');
    }

    lines.forEach((l, i) => {
      const g = this.gauges[i];
      const label = g.querySelector('.state') as HTMLElement;
      const fill = g.querySelector('.fill') as HTMLElement;
      const len = g.querySelector('.len') as HTMLElement;
      if (g.dataset.state !== l.kind) g.dataset.state = l.kind;
      if (l.kind === 'attached') {
        set(label, 'textContent', l.reel === 1 ? 'REEL IN' : l.reel === -1 ? 'LET OUT' : bodyDist[i] >= l.length * 0.99 ? 'TAUT' : 'SLACK');
        set(fill.style, 'width', `${Math.min(100, (l.length / GAUGE_FULL_LENGTH) * 100)}%`);
        set(len, 'textContent', `${l.length.toFixed(1)}m`);
      } else {
        set(label, 'textContent', l.kind === 'firing' ? 'STREAM' : 'IDLE');
        set(fill.style, 'width', '0%');
        set(len, 'textContent', l.kind === 'firing' ? `${bodyDist[i].toFixed(0)}m` : '--');
      }
    });

    set(this.extra, 'textContent', `${speed.toFixed(0)} m/s · ALT ${altitude.toFixed(0)} m`);
  }
}
