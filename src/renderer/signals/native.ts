// SdkLike backed by the main process native camera session (window.vault.native).
// The SDK reads the camera itself there, so no frames cross IPC; only metrics, status and errors do.
// The self view is built from small frame copies the main process forwards ('preview'); if none arrive,
// the lineup still works from the SDK's hints.
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
  let canvas: HTMLCanvasElement | null = null;
  const dropPreview = () => { if (preview) { for (const t of preview.getTracks()) { try { t.stop(); } catch { /* gone */ } } preview = null; } canvas = null; };
  // The SDK holds the camera in the main process; it sends small RGBA copies of its frames, drawn here
  // onto a canvas whose captureStream() becomes the self view the lineup shows.
  const showPreview = (data: Uint8ClampedArray, w: number, h: number) => {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      preview = canvas.captureStream(15);
      handlers.get('streamAvailable')?.(preview);
    }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  };
  return {
    on(event, cb) { handlers.set(event, cb as (...a: unknown[]) => void); return this; },
    async start() {
      off = bridge.on((type, ...args) => {
        if (dead) return;
        if (type === 'preview') { showPreview(args[0] as Uint8ClampedArray, args[1] as number, args[2] as number); return; }
        handlers.get(type)?.(...args);
      });
      await bridge.start(opts.requestedMetrics);
    },
    async stop() { dropPreview(); await bridge.stop(); },
    destroy() { dead = true; dropPreview(); off?.(); off = null; },
  };
}
