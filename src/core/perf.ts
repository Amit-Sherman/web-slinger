// Performance overlay (SPEC §13): per-frame CPU timings by system, FPS, worst frame, GPU workload.
// Toggle with P (or start with ?perf in the URL).

export class Perf {
  enabled = false;
  private el: HTMLElement;
  private t0 = new Map<string, number>();
  private acc = new Map<string, number>();
  private frames = 0;
  private frameMsSum = 0;
  private frameMsMax = 0;
  private lastPrint = 0;
  extra: Record<string, string | number> = {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    Object.assign(this.el.style, {
      position: 'fixed', top: '8px', left: '8px', padding: '6px 8px', whiteSpace: 'pre',
      font: '11px ui-monospace, monospace', color: '#5ff4ff', background: 'rgba(0,0,0,0.6)',
      zIndex: '50', pointerEvents: 'none', display: 'none',
    });
    document.body.appendChild(this.el);
    this.enabled = new URLSearchParams(location.search).has('perf');
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) this.enabled = !this.enabled;
    });
  }

  begin(name: string): void {
    if (this.enabled) this.t0.set(name, performance.now());
  }

  end(name: string): void {
    if (!this.enabled) return;
    const t = this.t0.get(name);
    if (t !== undefined) this.acc.set(name, (this.acc.get(name) ?? 0) + performance.now() - t);
  }

  /** Call once per frame with the real frame time (ms). Prints twice a second. */
  frame(frameMs: number, now: number): void {
    this.el.style.display = this.enabled ? 'block' : 'none';
    if (!this.enabled) return;
    this.frames++;
    this.frameMsSum += frameMs;
    this.frameMsMax = Math.max(this.frameMsMax, frameMs);
    if (now - this.lastPrint < 500) return;
    const n = this.frames || 1;
    const lines = [
      `FPS ${(1000 / (this.frameMsSum / n)).toFixed(0)}  frame ${(this.frameMsSum / n).toFixed(1)} ms  worst ${this.frameMsMax.toFixed(1)} ms`,
      ...[...this.acc.entries()].map(([k, v]) => `${k.padEnd(10)} ${(v / n).toFixed(2)} ms`),
      ...Object.entries(this.extra).map(([k, v]) => `${k.padEnd(10)} ${v}`),
    ];
    this.el.textContent = lines.join('\n');
    (window as unknown as { __perf: string }).__perf = this.el.textContent;
    this.acc.clear();
    this.frames = 0;
    this.frameMsSum = 0;
    this.frameMsMax = 0;
    this.lastPrint = now;
  }
}
