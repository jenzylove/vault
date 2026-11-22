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

/**
 * The SDK locks the camera's exposure, white balance and focus once its graph runs. On many laptop
 * cameras that lock lands on a dark fixed exposure, so the picture (and the read) goes dark a moment
 * after it starts. Open the same camera here as a second, tiny shared client and turn auto exposure and
 * auto white balance back on, a few times in the first seconds. Best effort: a camera that refuses a
 * second client or has no such control is left as the SDK set it. Returns a stop function.
 */
function keepAutoExposure(): () => void {
  let stream: MediaStream | null = null;
  let stopped = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const apply = async (): Promise<void> => {
    try {
      if (stopped) return;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { ideal: 5 } } });
        if (stopped) { for (const t of stream.getTracks()) t.stop(); stream = null; return; }
      }
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const caps = (track.getCapabilities?.() ?? {}) as { exposureMode?: string[]; whiteBalanceMode?: string[] };
      const want: Record<string, string> = {};
      if (caps.exposureMode?.includes('continuous')) want.exposureMode = 'continuous';
      if (caps.whiteBalanceMode?.includes('continuous')) want.whiteBalanceMode = 'continuous';
      if (Object.keys(want).length) await track.applyConstraints({ advanced: [want as MediaTrackConstraintSet] });
    } catch { /* no second client or no control: leave the camera as it is */ }
  };
  // the lock lands when the SDK graph reports running, a second or two after start
  for (const ms of [1200, 2500, 4500, 8000, 15000]) timers.push(setTimeout(() => { void apply(); }, ms));
  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    if (stream) { for (const t of stream.getTracks()) { try { t.stop(); } catch { /* gone */ } } stream = null; }
  };
}

export function nativeSdk(bridge: NativeBridge, opts: { requestedMetrics: number[] }): SdkLike {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  let off: (() => void) | null = null;
  let preview: MediaStream | null = null;
  let dead = false;
  let canvas: HTMLCanvasElement | null = null;
  let stopAe: (() => void) | null = null;
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
      stopAe?.();
      stopAe = keepAutoExposure();
    },
    async stop() { stopAe?.(); stopAe = null; dropPreview(); await bridge.stop(); },
    destroy() { dead = true; stopAe?.(); stopAe = null; dropPreview(); off?.(); off = null; },
  };
}
