// A stand in for the renderer SmartSpectraSDK: records calls, lets a test fire SDK events by hand.
// Nothing here talks to Presage; no session, no credits.
import type { LiveDeps, SdkLike } from '../../src/renderer/signals/live';

export class FakeSdk implements SdkLike {
  handlers = new Map<string, (...a: unknown[]) => void>();
  started = 0;
  stopped = 0;
  destroyed = false;
  startImpl: () => Promise<void> = async () => {};
  constructor(readonly opts: { apiKey: string; requestedMetrics: number[] }) {}
  on(ev: string, cb: (...a: never[]) => void): this { this.handlers.set(ev, cb as (...a: unknown[]) => void); return this; }
  emit(ev: string, ...a: unknown[]): void { this.handlers.get(ev)?.(...a); }
  async start(): Promise<void> { this.started++; await this.startImpl(); }
  async stop(): Promise<void> { this.stopped++; }
  destroy(): void { this.destroyed = true; }
  /** A session is live (billing) while started and not yet stopped or destroyed. */
  get live(): boolean { return this.started > 0 && this.stopped === 0 && !this.destroyed; }
}

/** Metrics payloads are passed through as already decoded objects. */
export function fakeDeps(clock: { t: number }, onCreate?: (s: FakeSdk) => void): LiveDeps & { made: FakeSdk[] } {
  const made: FakeSdk[] = [];
  return {
    made,
    create: (o) => { const s = new FakeSdk(o); made.push(s); onCreate?.(s); return s; },
    decode: (b) => b,
    now: () => clock.t,
  };
}

/** A decoded metrics payload with chest samples at the given SDK times (µs). */
export function chestMetrics(tsUs: number[]): Uint8Array {
  return { breathing: { upperTrace: tsUs.map((t) => ({ value: Math.sin(t / 1e6), stable: true, timestamp: t })) } } as unknown as Uint8Array;
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
