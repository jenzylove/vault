// SdkLike backed by the main process native camera session (window.vault.native).
// The SDK reads the camera itself there, so no frames cross IPC; only metrics, status and errors do.
// The self view preview is a separate, small getUserMedia stream opened after the native session, and is
// optional: if Windows will not share the camera, the lineup still works from the SDK's hints.
import type { SdkLike } from './live';

export interface NativeBridge {
  start(metrics: number[]): Promise<void>;
  stop(): Promise<void>;
  on(cb: (type: string, ...args: unknown[]) => void): () => void;
}

export function nativeBridge(): NativeBridge | null {
  const v = (globalThis as { vault?: { native?: NativeBridge } }).vault;
  return v?.native ?? null;
}

export function nativeSdk(bridge: NativeBridge, opts: { requestedMetrics: number[] }): SdkLike {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  let off: (() => void) | null = null;
  let preview: MediaStream | null = null;
  let dead = false;
  const dropPreview = () => { if (preview) { for (const t of preview.getTracks()) { try { t.stop(); } catch { /* gone */ } } preview = null; } };
  return {
    on(event, cb) { handlers.set(event, cb as (...a: unknown[]) => void); return this; },
    async start() {
      off = bridge.on((type, ...args) => { if (!dead) handlers.get(type)?.(...args); });
      await bridge.start(opts.requestedMetrics);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } }, audio: false });
        if (dead) { for (const t of s.getTracks()) t.stop(); return; }
        preview = s;
        handlers.get('streamAvailable')?.(s);
      } catch (e) {
        console.warn('[vault] self view preview unavailable (camera not shared); playing on hints only', e);
      }
    },
    async stop() { dropPreview(); await bridge.stop(); },
    destroy() { dead = true; dropPreview(); off?.(); off = null; },
  };
}
