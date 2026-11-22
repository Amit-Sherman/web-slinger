// Movement SFX (SPEC §8.1), synthesised with the Web Audio API: no audio files, no licensing.

import type { GameEvent, Hand, LineState } from '../player/state';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private reels: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }[] = [];
  private streams: GainNode[] = [];

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Wind: looping noise through a band-pass, louder and brighter with speed
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfx);
    src.start();
    this.wind = { gain, filter };

    // Reel motors, one per hand, panned left/right
    for (const pan of [-0.6, 0.6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 90;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      osc.connect(f).connect(g).connect(p).connect(this.sfx);
      osc.start();
      this.reels.push({ osc, gain: g, filter: f });

      // Web stream hiss while a hand is firing
      const ns = ctx.createBufferSource();
      ns.buffer = this.noise;
      ns.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 4200;
      nf.Q.value = 1.4;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      const np = ctx.createStereoPanner();
      np.pan.value = pan;
      ns.connect(nf).connect(ng).connect(np).connect(this.sfx);
      ns.start(0, pan > 0 ? 1 : 0);
      this.streams.push(ng);
    }
  }

  setVolume(master: number, sfx: number): void {
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.sfx.gain.value = sfx;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  private panFor(hand: Hand): number {
    return hand === 0 ? -0.6 : 0.6;
  }

  private burst(opts: {
    dur: number; gain: number; type: BiquadFilterType; f0: number; f1: number; q?: number; pan?: number; delay?: number;
  }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(opts.f0, t);
    f.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(f).connect(g).connect(p).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(opts: { dur: number; gain: number; type: OscillatorType; f0: number; f1: number; pan?: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.f0, t);
    o.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  play(e: GameEvent): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    switch (e.type) {
      case 'fire': // whip-crack launch
        this.burst({ dur: 0.14, gain: 0.5, type: 'bandpass', f0: 1800, f1: 7000, q: 2, pan: this.panFor(e.hand) });
        break;
      case 'attach': // metallic clack
        this.tone({ dur: 0.07, gain: 0.25, type: 'square', f0: 1400, f1: 420, pan: this.panFor(e.hand) });
        this.burst({ dur: 0.05, gain: 0.35, type: 'highpass', f0: 3000, f1: 2000, pan: this.panFor(e.hand) });
        break;
      case 'release': // snap
        this.tone({ dur: 0.06, gain: 0.18, type: 'triangle', f0: 900, f1: 1700, pan: this.panFor(e.hand) });
        break;
      case 'land': {
        const k = Math.min(1, e.impact / 40);
        if (k < 0.1) {
          this.burst({ dur: 0.06, gain: 0.15, type: 'lowpass', f0: 1200, f1: 400 });
          break;
        }
        this.tone({ dur: 0.18 + k * 0.25, gain: 0.25 + k * 0.6, type: 'sine', f0: 140, f1: 35 });
        this.burst({ dur: 0.12 + k * 0.3, gain: 0.2 + k * 0.5, type: 'lowpass', f0: 1500, f1: 120 });
        break;
      }
      case 'step':
        this.burst({ dur: 0.045, gain: e.sprint ? 0.12 : 0.08, type: 'bandpass', f0: 1100, f1: 600, q: 1.5, pan: (Math.random() - 0.5) * 0.3 });
        break;
      case 'jump':
        this.burst({ dur: 0.18, gain: 0.12, type: 'bandpass', f0: 500, f1: 1100 });
        break;
      case 'wallJump':
        this.burst({ dur: 0.28, gain: 0.25, type: 'bandpass', f0: 400, f1: 1400, q: 1.2 });
        break;
      case 'wallStick':
        this.burst({ dur: 0.07, gain: 0.12 + Math.min(0.3, Math.max(0, e.impact) / 60), type: 'lowpass', f0: 1800, f1: 500 });
        break;
      case 'stagger':
        this.tone({ dur: 0.35, gain: 0.6, type: 'sine', f0: 110, f1: 30 });
        this.burst({ dur: 0.3, gain: 0.5, type: 'lowpass', f0: 2500, f1: 150 });
        break;
      case 'webBall': // short wet thwip
        this.burst({ dur: 0.09, gain: 0.35, type: 'bandpass', f0: 2600, f1: 5200, q: 2.5, pan: this.panFor(e.hand) });
        break;
      case 'splat':
        this.burst({ dur: 0.16, gain: 0.3, type: 'lowpass', f0: 1800, f1: 350 });
        if (e.onProp) this.tone({ dur: 0.12, gain: 0.25, type: 'sine', f0: 220, f1: 90 });
        break;
      case 'pullFire':
        this.burst({ dur: 0.14, gain: 0.45, type: 'bandpass', f0: 1500, f1: 5500, q: 2, pan: 0.6 });
        break;
      case 'pullAttach':
        this.tone({ dur: 0.08, gain: 0.25, type: 'square', f0: 900, f1: 300, pan: 0.6 });
        break;
      case 'catch':
        this.tone({ dur: 0.12, gain: 0.3, type: 'sine', f0: 260, f1: 120, pan: 0.4 });
        break;
      case 'throw':
        this.burst({ dur: 0.3, gain: 0.35, type: 'bandpass', f0: 500, f1: 1800, q: 1.2, pan: 0.3 });
        break;
      case 'pullRelease':
        this.tone({ dur: 0.06, gain: 0.15, type: 'triangle', f0: 900, f1: 1600, pan: 0.6 });
        break;
      case 'wallScrape': // gritty brush against the facade
        this.burst({ dur: 0.14, gain: Math.min(0.22, 0.05 + e.speed / 200), type: 'bandpass', f0: 900, f1: 500, q: 0.8 });
        break;
      case 'splash':
        this.burst({ dur: 0.6, gain: 0.4, type: 'lowpass', f0: 3000, f1: 200 });
        break;
    }
  }

  /** Continuous sounds: wind by speed, reel motors by reel state. */
  update(speed: number, lines: [LineState, LineState]): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 60);
    this.wind.gain.gain.setTargetAtTime(k * k * 0.55, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(250 + k * 1600, t, 0.2);
    lines.forEach((l, i) => {
      const r = this.reels[i];
      const on = l.kind === 'attached' && l.reel !== 0;
      r.gain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.04);
      r.osc.frequency.setTargetAtTime(l.reel === 1 ? 140 : 95, t, 0.05);
      r.filter.frequency.setTargetAtTime(l.reel === 1 ? 1400 : 800, t, 0.05);
      this.streams[i].gain.setTargetAtTime(l.kind === 'firing' ? 0.12 : 0, t, l.kind === 'firing' ? 0.02 : 0.06);
    });
  }
}
