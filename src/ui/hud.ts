// Minimal visor-styled HUD (SPEC §12.1): crosshair + two rope gauges.

import { LINES } from '../config/gameplay';
import type { LineState } from '../player/state';

export class Hud {
  private root = document.getElementById('hud')!;
  private crosshair = document.getElementById('crosshair')!;
  private dist = document.getElementById('crosshair-dist')!;
  private gauges = [document.getElementById('gauge-left')!, document.getElementById('gauge-right')!];
  private extra = document.getElementById('hud-extra')!;

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(target: { distance: number } | null, lines: [LineState, LineState], bodyDist: [number, number], speed: number, altitude: number): void {
    this.crosshair.classList.toggle('lock', !!target);
    this.dist.textContent = target ? `${target.distance.toFixed(0)}m` : '';

    lines.forEach((l, i) => {
      const g = this.gauges[i];
      const label = g.querySelector('.state')!;
      const fill = g.querySelector('.fill') as HTMLElement;
      const len = g.querySelector('.len')!;
      g.dataset.state = l.kind;
      if (l.kind === 'attached') {
        label.textContent = l.reel === 1 ? 'REEL IN' : l.reel === -1 ? 'LET OUT' : bodyDist[i] >= l.length * 0.99 ? 'TAUT' : 'SLACK';
        fill.style.width = `${Math.min(100, (l.length / LINES.maxRange) * 100)}%`;
        len.textContent = `${l.length.toFixed(1)}m`;
      } else {
        label.textContent = l.kind === 'firing' ? 'FIRING' : l.kind === 'missed' ? 'MISS' : 'IDLE';
        fill.style.width = '0%';
        len.textContent = '--';
      }
    });

    this.extra.textContent = `${speed.toFixed(0)} m/s · ALT ${altitude.toFixed(0)} m`;
  }
}
