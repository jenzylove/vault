/**
 * One place that listens to whatever SignalSource the App picked (live, replay or simulated) and turns
 * frames into what the overlay and the scene need: a breath line, a heartbeat envelope, a quality read,
 * and timed recording windows measured in signal time (so a stalled camera never ends a peek early).
 */
import type { SignalFrame, SignalSource } from '../signals/types';

const KEEP_MS = 45_000;
const BREATH_MS = 10_000;
const BREATH_POINTS = 200;

interface Recorder { ms: number; t0: number | null; frames: SignalFrame[]; done: (f: SignalFrame[]) => void; }

export function goodFrame(f: SignalFrame): boolean { return f.conf >= 0.5 && f.stable; }

export class SignalBus {
  private frames: SignalFrame[] = [];
  private unsub: (() => void) | null = null;
  private recs = new Set<Recorder>();
  private env = 0;
  private lastBeatT = -1e9;
  private cardioMean = 0;
  private cardioVar = 0.01;
  private prev: number[] = [];
  lastFrameAt = 0; // performance.now() of the newest frame

  constructor(readonly source: SignalSource) {}

  attach(): void {
    if (this.unsub) return;
    this.unsub = this.source.subscribe((f) => this.push(f));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** Drop every buffered sample (the session's signal numbers live only in memory). */
  clear(): void {
    this.frames = [];
    this.prev = [];
    this.env = 0;
    for (const r of this.recs) r.done([]);
    this.recs.clear();
  }

  private push(f: SignalFrame): void {
    this.lastFrameAt = performance.now();
    const last = this.frames[this.frames.length - 1];
    const dt = last ? Math.max(0, f.t - last.t) : 33;
    this.frames.push(f);
    const cut = f.t - KEEP_MS;
    let i = 0;
    while (i < this.frames.length && (this.frames[i] as SignalFrame).t < cut) i++;
    if (i > 0) this.frames.splice(0, i);

    // heartbeat: peak of the beat waveform above its running level, with a 300 ms refractory
    this.env *= Math.exp((-dt / 1000) * 7);
    if (typeof f.cardio === 'number') {
      const a = Math.min(1, dt / 2000);
      this.cardioMean += (f.cardio - this.cardioMean) * a;
      this.cardioVar += ((f.cardio - this.cardioMean) ** 2 - this.cardioVar) * a;
      const p = this.prev;
      p.push(f.cardio);
      if (p.length > 3) p.shift();
      if (p.length === 3) {
        const [x0, x1, x2] = p as [number, number, number];
        const peak = x1 > x0 && x1 >= x2 && x1 > this.cardioMean + 0.8 * Math.sqrt(this.cardioVar);
        if (peak && f.t - this.lastBeatT > 300) { this.env = 1; this.lastBeatT = f.t; }
      }
    } else if (typeof f.pulse === 'number' && f.pulse > 30) {
      // no waveform from this source: pace the lamp from the averaged pulse instead
      if (f.t - this.lastBeatT > 60000 / f.pulse) { this.env = 1; this.lastBeatT = f.t; }
    }

    for (const r of this.recs) {
      if (r.t0 === null) r.t0 = f.t;
      r.frames.push(f);
      if (f.t - r.t0 >= r.ms) { this.recs.delete(r); r.done(r.frames); }
    }
  }

  /** Collect the next `ms` of signal time. Resolves with the frames (empty if cancelled). */
  record(ms: number): { promise: Promise<SignalFrame[]>; cancel: () => void; progress: () => number } {
    let rec!: Recorder;
    const promise = new Promise<SignalFrame[]>((done) => { rec = { ms, t0: null, frames: [], done }; });
    this.recs.add(rec);
    return {
      promise,
      cancel: () => { if (this.recs.delete(rec)) rec.done([]); },
      progress: () => {
        const last = rec.frames[rec.frames.length - 1];
        return rec.t0 === null || !last ? 0 : Math.min(1, (last.t - rec.t0) / ms);
      },
    };
  }

  /** Last ~10 s of the chest trace, normalized to -1..1 against its own recent swing. */
  breath(): number[] {
    const fr = this.frames;
    const last = fr[fr.length - 1];
    if (!last) return [];
    const from = last.t - BREATH_MS;
    const xs: number[] = [];
    for (let i = fr.length - 1; i >= 0; i--) {
      const f = fr[i] as SignalFrame;
      if (f.t < from) break;
      if (typeof f.chest === 'number') xs.push(f.chest);
    }
    xs.reverse();
    if (xs.length < 4) return [];
    const sorted = [...xs].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.03)] as number;
    const hi = sorted[Math.floor(sorted.length * 0.97)] as number;
    const mid = (lo + hi) / 2;
    const half = Math.max((hi - lo) / 2, 1e-6);
    const step = Math.max(1, xs.length / BREATH_POINTS);
    const out: number[] = [];
    for (let i = 0; i < xs.length; i += step) {
      const v = ((xs[Math.floor(i)] as number) - mid) / half;
      out.push(Math.max(-1, Math.min(1, v * 0.9)));
    }
    return out;
  }

  heartbeat(): number { return this.env; }

  /** Share of good samples over the last 2 s of signal; null before any signal arrives. */
  quality(): number | null {
    const fr = this.frames;
    const last = fr[fr.length - 1];
    if (!last) return null;
    let n = 0, good = 0;
    for (let i = fr.length - 1; i >= 0; i--) {
      const f = fr[i] as SignalFrame;
      if (f.t < last.t - 2000) break;
      n++;
      if (goodFrame(f)) good++;
    }
    return n ? good / n : null;
  }

  pulse(): number | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const p = (this.frames[i] as SignalFrame).pulse;
      if (typeof p === 'number') return p;
    }
    return null;
  }

  talking(): boolean {
    const last = this.frames[this.frames.length - 1];
    return !!last?.talking;
  }
}
