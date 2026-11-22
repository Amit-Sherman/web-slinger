// One-Euro filter (Casiez et al. 2012): smooths jitter when the head is still, stays responsive
// when it moves fast. Used for every head-pose channel (SPEC §3.2).

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  get last(): number | null {
    return this.y;
  }
  reset(): void {
    this.y = null;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;

  constructor(private minCutoff = 1.0, private beta = 0.02, private dCutoff = 1.0) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** `t` in seconds. */
  filter(value: number, t: number): number {
    const dt = this.lastT === null ? 1 / 30 : Math.max(1e-4, t - this.lastT);
    this.lastT = t;
    const prev = this.x.last;
    const d = prev === null ? 0 : (value - prev) / dt;
    const edx = this.dx.filter(d, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastT = null;
  }
}
