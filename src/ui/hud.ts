// Minimal visor-styled HUD (SPEC §12.1): crosshair + two rope gauges.

import * as THREE from 'three';
import type { LineState } from '../player/state';

const GAUGE_FULL_LENGTH = 120; // metres shown as a full gauge

export class Hud {
  private root = document.getElementById('hud')!;
  private crosshair = document.getElementById('crosshair')!;
  private dist = document.getElementById('crosshair-dist')!;
  private gauges = [document.getElementById('gauge-left')!, document.getElementById('gauge-right')!];
  private extra = document.getElementById('hud-extra')!;
  private marker = document.getElementById('impact-marker')!;
  private pullEl = document.getElementById('pull-state')!;
  private v = new THREE.Vector3();

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  /** `impact`: where a stream fired now would land (ballistic prediction), shown as a marker. */
  update(
    impact: { point: THREE.Vector3; distance: number } | null, camera: THREE.Camera,
    lines: [LineState, LineState], bodyDist: [number, number], speed: number, altitude: number,
    pull: LineState, tetherStatus: string,
  ): void {
    this.pullEl.textContent = tetherStatus || (pull.holding ? 'HOLDING · release middle mouse to throw'
      : pull.kind === 'attached' ? 'PULLING' : pull.kind === 'firing' ? 'PULL' : '');
    this.crosshair.classList.toggle('lock', !!impact);
    if (impact) {
      const p = this.v.copy(impact.point).project(camera);
      const inFront = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      this.marker.style.display = inFront ? 'block' : 'none';
      this.marker.style.left = `${((p.x + 1) / 2) * 100}%`;
      this.marker.style.top = `${((1 - p.y) / 2) * 100}%`;
      this.dist.textContent = `${impact.point.distanceTo(camera.position).toFixed(0)}m`;
    } else {
      this.marker.style.display = 'none';
      this.dist.textContent = '';
    }

    lines.forEach((l, i) => {
      const g = this.gauges[i];
      const label = g.querySelector('.state')!;
      const fill = g.querySelector('.fill') as HTMLElement;
      const len = g.querySelector('.len')!;
      g.dataset.state = l.kind;
      if (l.kind === 'attached') {
        label.textContent = l.reel === 1 ? 'REEL IN' : l.reel === -1 ? 'LET OUT' : bodyDist[i] >= l.length * 0.99 ? 'TAUT' : 'SLACK';
        fill.style.width = `${Math.min(100, (l.length / GAUGE_FULL_LENGTH) * 100)}%`;
        len.textContent = `${l.length.toFixed(1)}m`;
      } else {
        label.textContent = l.kind === 'firing' ? 'STREAM' : 'IDLE';
        fill.style.width = '0%';
        len.textContent = l.kind === 'firing' ? `${bodyDist[i].toFixed(0)}m` : '--';
      }
    });

    this.extra.textContent = `${speed.toFixed(0)} m/s · ALT ${altitude.toFixed(0)} m`;
  }
}
