// SdkLike backed by the main process native camera session (window.vault.native).
// The SDK reads the camera itself there, so no frames cross IPC; only metrics, status and errors do.
// The self view is built from small frame copies the main process forwards ('preview'); if none arrive,
// the lineup still works from the SDK's hints.
import type { SdkLike } from './live';

export interface NativeBridge {
  start(metrics: number[], opts?: { fed?: boolean }): Promise<void>;
  stop(): Promise<void>;
  /** one camera frame from the page (page fed sessions); fmt 2 = RGBA */
  frame?(buf: Uint8Array, w: number, h: number, fmt: number): void;
  on(cb: (type: string, ...args: unknown[]) => void): () => void;
}

export function nativeBridge(): NativeBridge | null {
  const v = (globalThis as { vault?: { native?: NativeBridge } }).vault;
  return v?.native ?? null;
}

/**
 * Who opens the camera. The SDK's own camera path locks exposure, white balance and focus once it runs,
 * and on some laptop cameras that lock collapses the picture to near black (SDK log: "lock collapsed
 * image brightness"), which means no read. So by default the page opens the camera itself, where the
 * camera keeps its own auto exposure, and feeds every frame to the SDK in the main process
 * (useCustomInput + sendFrame). If the page cannot open the camera, or the SDK says the fed frame rate
 * is too low, the next session falls back to the SDK's own camera.
 */
let preferSdkCamera = false;
// SDK errors that mean the page could not feed frames steadily: kTimestampGap (11), kSustainedLowFrameRate (14)
const FED_TROUBLE = new Set([11, 14]);

async function openCamera(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } } });
  } catch { return null; }
}

type Frame = { visibleRect: { width: number; height: number } | null; displayWidth: number; displayHeight: number; copyTo(b: Uint8Array, o: object): Promise<unknown>; close(): void };
type Proc = new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<Frame> };

/** Read camera frames and hand each one (RGBA) to the bridge until stopped. One frame in flight at a time. */
function pumpFrames(track: MediaStreamTrack, send: (b: Uint8Array, w: number, h: number) => void): () => void {
  const P = (globalThis as { MediaStreamTrackProcessor?: Proc }).MediaStreamTrackProcessor;
  if (!P) return () => undefined;
  let on = true;
  const reader = new P({ track }).readable.getReader();
  void (async () => {
    while (on) {
      let f: Frame | undefined;
      try {
        const r = await reader.read();
        if (r.done) break;
        f = r.value;
        const w = f.visibleRect?.width ?? f.displayWidth;
        const h = f.visibleRect?.height ?? f.displayHeight;
        const buf = new Uint8Array(w * h * 4);
        await f.copyTo(buf, { format: 'RGBA' });
        if (on) send(buf, w, h);
        keepRate();
      } catch { /* a dropped frame */ } finally { try { f?.close(); } catch { /* closed */ } }
    }
  })();
  // In dim light a laptop camera on auto exposure slows to about 15 frames a second to gather light,
  // and the SDK stops below its frame rate floor. Watch the rate; when it sags, hold the camera at the
  // longest exposure that still fits 30 frames a second (exposureTime is in 100 microsecond units).
  let count = 0;
  let since = performance.now();
  let held = false;
  function keepRate(): void {
    count++;
    const now = performance.now();
    if (now - since < 1500) return;
    const fps = (count * 1000) / (now - since);
    count = 0; since = now;
    if (fps >= 24 || held) { if (fps < 24) console.warn(`[vault] camera at ${fps.toFixed(1)} frames a second`); return; }
    held = true;
    console.warn(`[vault] camera slowed to ${fps.toFixed(1)} frames a second: holding a 30 fps exposure`);
    try {
      const caps = (track.getCapabilities?.() ?? {}) as { exposureMode?: string[]; exposureTime?: { max: number } };
      if (caps.exposureMode?.includes('manual') && caps.exposureTime) {
        void track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: Math.min(caps.exposureTime.max, 312) } as MediaTrackConstraintSet] }).catch(() => undefined);
      }
    } catch { /* no exposure control on this camera */ }
  }
  return () => { on = false; void reader.cancel().catch(() => undefined); };
}

export function nativeSdk(bridge: NativeBridge, opts: { requestedMetrics: number[] }): SdkLike {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  let off: (() => void) | null = null;
  let preview: MediaStream | null = null;
  let dead = false;
  let canvas: HTMLCanvasElement | null = null;
  let cam: MediaStream | null = null;
  let stopPump: (() => void) | null = null;
  const dropPreview = () => { if (preview) { for (const t of preview.getTracks()) { try { t.stop(); } catch { /* gone */ } } preview = null; } canvas = null; };
  const dropCamera = () => {
    stopPump?.(); stopPump = null;
    if (cam) { for (const t of cam.getTracks()) { try { t.stop(); } catch { /* gone */ } } cam = null; }
  };
  // SDK camera sessions: the main process sends small RGBA copies of the SDK's frames, drawn here onto a
  // canvas whose captureStream() becomes the self view the lineup shows.
  const showPreview = (data: Uint8ClampedArray, w: number, h: number) => {
    if (cam) return; // page fed: the self view is the page's own camera
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
        if (type === 'error' && FED_TROUBLE.has(args[0] as number) && cam) preferSdkCamera = true;
        handlers.get(type)?.(...args);
      });
      const track = !preferSdkCamera && bridge.frame && 'MediaStreamTrackProcessor' in globalThis ? (cam = await openCamera())?.getVideoTracks()[0] : undefined;
      if (!track) { dropCamera(); await bridge.start(opts.requestedMetrics); return; }
      handlers.get('streamAvailable')?.(cam);
      try { await bridge.start(opts.requestedMetrics, { fed: true }); } catch (err) { dropCamera(); throw err; }
      if (dead || !cam) { dropCamera(); return; }
      const frame = bridge.frame!.bind(bridge);
      stopPump = pumpFrames(track, (b, w, h) => frame(b, w, h, 2));
    },
    async stop() { dropCamera(); dropPreview(); await bridge.stop(); },
    destroy() { dead = true; dropCamera(); dropPreview(); off?.(); off = null; },
  };
}
