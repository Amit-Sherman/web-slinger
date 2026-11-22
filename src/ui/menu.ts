// Click-to-play overlay, pause screen, controls list and settings (SPEC §12.2).

import { ACTION_LABELS } from '../input/actions';
import type { GraphicsPreset, Settings } from '../config/settings';
import { PRESETS } from '../config/settings';

type Field =
  | { key: keyof Settings; label: string; kind: 'range'; min: number; max: number; step: number; fmt: (v: number) => string }
  | { key: keyof Settings; label: string; kind: 'check' }
  | { key: keyof Settings; label: string; kind: 'preset' };

const FIELDS: Field[] = [
  { key: 'preset', label: 'Graphics preset', kind: 'preset' },
  { key: 'renderScale', label: 'Render scale', kind: 'range', min: 0.5, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fov', label: 'Field of view', kind: 'range', min: 70, max: 110, step: 1, fmt: (v) => `${v}°` },
  { key: 'sensitivity', label: 'Mouse sensitivity', kind: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'invertY', label: 'Invert Y', kind: 'check' },
  { key: 'motionEffects', label: 'Motion effects (FOV, speed lines, shake)', kind: 'check' },
  { key: 'cameraRoll', label: 'Camera roll on turns', kind: 'check' },
  { key: 'masterVolume', label: 'Master volume', kind: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'sfxVolume', label: 'SFX volume', kind: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

export class Menu {
  private start = document.getElementById('start')!;
  private pause = document.getElementById('pause')!;
  private settingsEl = document.getElementById('settings-form')!;
  private controlsEl = document.getElementById('controls-list')!;
  private tabs = document.querySelectorAll<HTMLButtonElement>('[data-tab]');
  onPlay: (() => void) | null = null;
  onSettingsChange: ((s: Settings) => void) | null = null;

  constructor(private settings: Settings) {
    this.start.addEventListener('click', () => this.onPlay?.());
    document.getElementById('resume')!.addEventListener('click', () => this.onPlay?.());
    this.tabs.forEach((t) => t.addEventListener('click', () => this.showTab(t.dataset.tab!)));
    this.controlsEl.innerHTML = ACTION_LABELS.map(([k, a]) => `<div class="row"><kbd>${k}</kbd><span>${a}</span></div>`).join('');
    this.buildSettings();
  }

  setLoading(text: string | null): void {
    const el = document.getElementById('start-hint')!;
    el.textContent = text ?? 'Click to play';
    this.start.classList.toggle('loading', !!text);
  }

  showStart(): void {
    this.start.style.display = 'flex';
    this.pause.style.display = 'none';
  }

  showPause(): void {
    this.start.style.display = 'none';
    this.pause.style.display = 'flex';
  }

  hideAll(): void {
    this.start.style.display = 'none';
    this.pause.style.display = 'none';
  }

  private showTab(name: string): void {
    this.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => {
      p.style.display = p.id === `tab-${name}` ? 'block' : 'none';
    });
  }

  private buildSettings(): void {
    const s = this.settings;
    this.settingsEl.innerHTML = '';
    for (const f of FIELDS) {
      const row = document.createElement('label');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = f.label;
      row.appendChild(name);
      if (f.kind === 'range') {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(f.min);
        input.max = String(f.max);
        input.step = String(f.step);
        input.value = String(s[f.key]);
        const out = document.createElement('output');
        out.textContent = f.fmt(Number(s[f.key]));
        input.addEventListener('input', () => {
          (s[f.key] as number) = Number(input.value);
          out.textContent = f.fmt(Number(input.value));
          this.onSettingsChange?.(s);
        });
        row.append(input, out);
      } else if (f.kind === 'check') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(s[f.key]);
        input.addEventListener('change', () => {
          (s[f.key] as boolean) = input.checked;
          this.onSettingsChange?.(s);
        });
        row.appendChild(input);
      } else {
        const sel = document.createElement('select');
        for (const p of Object.keys(PRESETS) as GraphicsPreset[]) {
          const o = document.createElement('option');
          o.value = p;
          o.textContent = p[0].toUpperCase() + p.slice(1);
          sel.appendChild(o);
        }
        sel.value = s.preset;
        sel.addEventListener('change', () => {
          s.preset = sel.value as GraphicsPreset;
          s.renderScale = PRESETS[s.preset].renderScale;
          this.onSettingsChange?.(s);
          this.buildSettings();
        });
        row.appendChild(sel);
      }
      this.settingsEl.appendChild(row);
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Webcam head-tracking arrives in milestone M3.';
    this.settingsEl.appendChild(note);
  }
}
