// Live SignalSource on the Presage SmartSpectra renderer SDK.
//
// Credits: Presage bills by session wall time, so a session exists only between start() and stop().
// Every error either retries once (network, metric not authorized) or ends the session at once.
// The camera stream is exposed through status().stream so the UI can show a consented self view.
import { SmartSpectraSDK, breathingMetrics, cardioMetrics } from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { framesFromMetrics, type MetricsLike } from './decode';
import { nativeBridge, nativeSdk } from './native';
import { E_NETWORK, E_NOT_AUTHORIZED, E_PROCESSING, StatusHub, sdkError } from './status';
import type { ProcessingState, SignalFrame, SignalSource, SourceStatus } from './types';

// BLINKING, TALKING, EXPRESSIONS. FACE_LANDMARKS (11) is left out: the game does not use it and it slows the pipeline.
export const FACE_METRICS = [12, 13, 14];
/** Metric sets, richest first. A "metric not authorized" error steps down one set and tries again. */
export const METRIC_TIERS: number[][] = [
  [...(breathingMetrics as readonly number[]), ...(cardioMetrics as readonly number[]), ...FACE_METRICS],
  [...(breathingMetrics as readonly number[]), ...(cardioMetrics as readonly number[])],
  [...(breathingMetrics as readonly number[])],
];

const PROCESSING: Record<number, ProcessingState> = { 0: 'idle', 1: 'idle', 2: 'starting', 3: 'running', 4: 'stopping', 5: 'error' };
const STOP_WAIT_MS = 4000;

/** The slice of the renderer SDK this source uses (lets tests hand in a fake). */
export interface SdkLike {
  on(event: string, cb: (...args: never[]) => void): unknown;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
}
export interface LiveDeps {
  create(opts: { apiKey: string; requestedMetrics: number[] }): SdkLike;
  decode(buf: Uint8Array): unknown;
  now(): number;
}
const realDeps: LiveDeps = {
  // Prefer the native camera session in the main process (keeps 30 fps); fall back to the renderer SDK.
  create: (o) => { const b = nativeBridge(); return b ? nativeSdk(b, o) : (new SmartSpectraSDK(o) as unknown as SdkLike); },
  decode: (b) => decodeMetrics(b),
  now: () => performance.now(),
};

export class LiveSource implements SignalSource {
  readonly kind = 'live' as const;
  private sdk: SdkLike | null = null;
  private gen = 0;                 // bumps on every close; events from an older session are ignored
  private starting: Promise<void> | null = null;
  private retriedNetwork = false;
  private tier = 0;
  private subs = new Set<(f: SignalFrame) => void>();
  private seen = new Set<string>();
  private originUs: number | null = null;
  private offset = 0;              // keeps frame time running forward across sessions
  private lastT = 0;
  private hub = new StatusHub();

  constructor(private apiKey: string, private deps: LiveDeps = realDeps) {}

  subscribe(cb: (f: SignalFrame) => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  status(): SourceStatus { return this.hub.get(); }
  onStatus(cb: (s: SourceStatus) => void): () => void { return this.hub.on(cb); }
  /** Metric set in use (0 = breathing, cardio and face). */
  get metricTier(): number { return this.tier; }
  get running(): boolean { return this.sdk !== null; }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.sdk) return;
    this.retriedNetwork = false;
    return this.launch();
  }

  async stop(): Promise<void> {
    // Let a pending start land first, so a stop can never race ahead of it and orphan a session.
    if (this.starting) { try { await this.starting; } catch { /* already reported */ } }
    await this.close();
    this.hub.set({ processing: 'idle', validation: null });
  }

  private launch(): Promise<void> {
    const p = this.open().finally(() => { if (this.starting === p) this.starting = null; });
    this.starting = p;
    return p;
  }

  private async open(): Promise<void> {
    const gen = ++this.gen;
    this.hub.set({ processing: 'starting', validation: null, error: null });
    const sdk = this.deps.create({ apiKey: this.apiKey, requestedMetrics: METRIC_TIERS[this.tier] as number[] });
    this.sdk = sdk;
    this.originUs = null;
    this.seen.clear();
    this.offset = this.lastT > 0 ? this.lastT + 1000 : 0;
    const mine = () => gen === this.gen;

    sdk.on('streamAvailable', ((stream: MediaStream) => { if (mine()) this.hub.set({ stream }); }) as never);
    sdk.on('processingStatus', ((st: number) => {
      if (!mine()) return;
      const kind = PROCESSING[st] ?? this.hub.get().processing;
      if (kind === 'error') {
        // The SDK normally follows this with an 'error' event; if it does not, end the session anyway.
        setTimeout(() => { if (mine()) void this.fail(gen, E_PROCESSING, 'processing status error', true); }, 400);
        return;
      }
      this.hub.set({ processing: kind });
    }) as never);
    sdk.on('validationStatus', ((code: number, _ts: number, hint: string) => {
      if (mine()) this.hub.set({ validation: { code: code | 0, hint: hint ?? '', at: this.deps.now() } });
    }) as never);
    sdk.on('error', ((code: number, message: string, retryable: boolean) => {
      if (mine()) void this.fail(gen, code, message, retryable);
    }) as never);
    sdk.on('metrics', ((buf: Uint8Array, tsUs: number) => {
      if (!mine()) return;
      if (this.originUs == null) this.originUs = Number(tsUs);
      let m: MetricsLike;
      try { m = this.deps.decode(buf) as MetricsLike; } catch (e) { console.warn('[vault] metrics decode failed', e); return; }
      for (const f of framesFromMetrics(m, this.originUs, this.seen)) {
        f.t += this.offset;
        if (f.t > this.lastT) this.lastT = f.t;
        for (const cb of this.subs) cb(f);
      }
    }) as never);

    try {
      await sdk.start();
    } catch (e) {
      const err = e as { code?: unknown; message?: string; retryable?: boolean };
      const code = typeof err?.code === 'number' ? err.code : 'camera';
      if (!mine()) return; // stopped or replaced while starting
      const r = await this.fail(gen, code, err?.message ?? String(e), !!err?.retryable);
      if (r === 'retry' && this.starting) return this.starting;
      if (r === 'stale') return;
      throw new Error(this.hub.get().error?.say ?? 'The camera did not start.');
    }
    if (mine() && this.hub.get().processing === 'starting') this.hub.set({ processing: 'running' });
  }

  /**
   * Handle a session error. Network: retry once. Metric not authorized: drop to a smaller metric set.
   * Anything else: end the session now (credits) and report it.
   */
  private async fail(gen: number, code: number | string, message: string, retryable: boolean): Promise<'retry' | 'fatal' | 'stale'> {
    if (gen !== this.gen) return 'stale';
    console.warn(`[vault] SmartSpectra error ${String(code)}: ${message}`);
    if (code === E_NETWORK && !this.retriedNetwork) {
      this.retriedNetwork = true;
      return this.retry();
    }
    if (code === E_NOT_AUTHORIZED && this.tier < METRIC_TIERS.length - 1) {
      this.tier++;
      return this.retry();
    }
    await this.close();
    this.hub.set({ processing: 'error', error: sdkError(code, message, retryable), validation: null });
    return 'fatal';
  }

  private async retry(): Promise<'retry'> {
    await this.close();
    this.launch().catch(() => { /* a failed retry is reported through status */ });
    return 'retry';
  }

  private async close(): Promise<void> {
    const sdk = this.sdk;
    this.sdk = null;
    this.gen++;
    if (!sdk) return;
    try {
      await Promise.race([sdk.stop(), new Promise((r) => setTimeout(r, STOP_WAIT_MS))]);
    } catch (e) {
      console.warn('[vault] SmartSpectra stop failed', e);
    } finally {
      try { sdk.destroy(); } catch { /* already gone */ }
      this.hub.set({ stream: null });
    }
  }
}
