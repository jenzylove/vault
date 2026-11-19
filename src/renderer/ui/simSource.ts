/**
 * SIMULATED BODY as a SignalSource. Wraps the engine's labelled SimBody so the full game runs with no
 * camera and no key. Every frame is synthetic; the UI badges this mode "Simulated body" on screen.
 */
import { SimBody, makeSimPlayer, type Strategy } from '../engine';
import type { BoxKind } from '../engine';
import type { SignalFrame, SignalSource, SourceStatus } from '../signals/types';
import { StatusHub } from '../signals/status';

/** A source that can be told what the player just saw (only a simulated body needs this). */
export interface PeekAware { onPeek(kind: BoxKind): void }
export function isPeekAware(s: SignalSource): s is SignalSource & PeekAware {
  return typeof (s as Partial<PeekAware>).onPeek === 'function';
}

export class SimulatedSource implements SignalSource, PeekAware {
  readonly kind = 'simulated' as const;
  readonly label = 'Simulated body';
  private body: SimBody;
  private subs = new Set<(f: SignalFrame) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private carry = 0;
  private beatPhase = 0;
  private readonly fps = 30;
  private hub = new StatusHub(); // no camera: no stream, no validation packets, never an SDK error

  /** speed > 1 runs simulated time faster than the wall clock (screenshots and tests only). */
  constructor(seed = Date.now() % 100000, strategy: Strategy = 'honest', private speed = 1) {
    this.body = new SimBody(makeSimPlayer(strategy, seed), seed, this.fps);
  }

  subscribe(cb: (f: SignalFrame) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  onPeek(kind: BoxKind): void { this.body.react(kind); }

  status(): SourceStatus { return this.hub.get(); }
  onStatus(cb: (s: SourceStatus) => void): () => void { return this.hub.on(cb); }

  async start(): Promise<void> {
    if (this.timer) return;
    this.last = performance.now();
    this.carry = 0;
    this.timer = setInterval(() => this.tick(), 1000 / this.fps);
    this.hub.set({ processing: 'running' });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hub.set({ processing: 'idle' });
  }

  private tick(): void {
    const now = performance.now();
    // simulated ms owed since the last tick; cap so a stalled tab doesn't flood the bus
    this.carry = Math.min(this.carry + (now - this.last) * this.speed, 2000);
    this.last = now;
    const dt = 1000 / this.fps;
    while (this.carry >= dt) {
      this.carry -= dt;
      const f = this.body.frame();
      // SimBody has no beat waveform: synthesize one from its simulated pulse (labelled, like the rest)
      const bpm = f.pulse ?? 70;
      this.beatPhase = (this.beatPhase + (bpm / 60) * (dt / 1000)) % 1;
      const p = this.beatPhase;
      f.cardio = Math.exp(-((p - 0.12) ** 2) / 0.0025) + 0.35 * Math.exp(-((p - 0.38) ** 2) / 0.006);
      for (const cb of this.subs) cb(f);
    }
  }
}
