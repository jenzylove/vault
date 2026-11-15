// Live SignalSource on the Presage SmartSpectra renderer SDK.
// The camera stream is exposed so the UI can show a consented self view.
import { SmartSpectraSDK, breathingMetrics, cardioMetrics, faceMetrics } from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { framesFromMetrics, type MetricsLike } from './decode';
import type { SignalFrame, SignalSource } from './types';

export type LiveStatus = { kind: 'idle' | 'starting' | 'running' | 'stopping' | 'error'; hint?: string; validation?: number };

// FACE_LANDMARKS is not needed by the game; requesting fewer metrics keeps the pipeline light.
const FACE_NO_LANDMARKS = (faceMetrics as number[]).slice();

export class LiveSource implements SignalSource {
  readonly kind = 'live' as const;
  private sdk: SmartSpectraSDK | null = null;
  private subs = new Set<(f: SignalFrame) => void>();
  private seen = new Set<string>();
  private originUs: number | null = null;
  status: LiveStatus = { kind: 'idle' };
  onStatus?: (s: LiveStatus) => void;
  onStream?: (s: MediaStream) => void;

  constructor(private apiKey: string) {}

  subscribe(cb: (f: SignalFrame) => void): () => void { this.subs.add(cb); return () => this.subs.delete(cb); }

  private set(s: LiveStatus) { this.status = s; this.onStatus?.(s); }

  async start(): Promise<void> {
    if (this.sdk) return;
    this.set({ kind: 'starting' });
    const sdk = new SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics: [...(breathingMetrics as number[]), ...(cardioMetrics as number[]), ...FACE_NO_LANDMARKS],
    });
    this.sdk = sdk;
    sdk.on('streamAvailable' as never, ((stream: MediaStream) => this.onStream?.(stream)) as never);
    sdk.on('processingStatus', (st) => {
      const map: Record<number, LiveStatus['kind']> = { 1: 'idle', 2: 'starting', 3: 'running', 4: 'stopping', 5: 'error' };
      this.set({ ...this.status, kind: map[st as number] ?? this.status.kind });
    });
    sdk.on('validationStatus', (code, _ts, hint) => this.set({ ...this.status, validation: code as number, hint }));
    sdk.on('error', (_code, message) => this.set({ kind: 'error', hint: message }));
    sdk.on('metrics', (buf, tsUs) => {
      if (this.originUs == null) this.originUs = Number(tsUs);
      const m = decodeMetrics(buf) as unknown as MetricsLike;
      for (const f of framesFromMetrics(m, this.originUs, this.seen)) for (const cb of this.subs) cb(f);
    });
    await sdk.start();
  }

  async stop(): Promise<void> {
    const sdk = this.sdk; this.sdk = null;
    if (!sdk) return;
    try { await sdk.stop(); } finally { sdk.destroy(); this.seen.clear(); this.originUs = null; this.set({ kind: 'idle' }); }
  }
}
