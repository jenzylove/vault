import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canEncrypt, cleanKey, forgetKey, savedKey, saveKey } from './keyStore';

// The Presage key, in this order: the PRESAGE_API_KEY environment variable, a .env file (development
// runs only, never the installed app), then the key the player pasted in the game (keyStore.ts).
// It stays in this process, goes only to the SDK constructor, and is never logged.
type KeyFrom = 'env' | 'file' | 'saved';
async function findKey(): Promise<{ key: string; from: KeyFrom } | null> {
  const fromEnv = process.env.PRESAGE_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, from: 'env' };
  if (!app.isPackaged) {
    for (const dir of [app.getAppPath(), process.cwd()]) {
      const file = join(dir, '.env');
      if (!existsSync(file)) continue;
      try {
        for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
          const m = /^\s*(?:export\s+)?PRESAGE_API_KEY\s*=\s*(.*)\s*$/.exec(line);
          if (!m) continue;
          const v = (m[1] ?? '').replace(/^(['"])(.*)\1$/, '$2').trim();
          if (v) return { key: v, from: 'file' };
        }
      } catch { /* unreadable .env: no key */ }
    }
  }
  const saved = await savedKey();
  return saved ? { key: saved, from: 'saved' } : null;
}

// Installed app: the Presage runtime DLLs sit unpacked beside app.asar (electron-builder.yml, asarUnpack).
// Windows cannot load a DLL from inside the archive, so point the SDK at the unpacked copy.
const CAPI: Partial<Record<NodeJS.Platform, string>> = { win32: 'smartspectra_capi.dll', darwin: 'libsmartspectra_capi.dylib', linux: 'libsmartspectra_capi.so' };
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH && CAPI[process.platform]) {
  const lib = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@smartspectra', `node-sdk-${process.platform}-${process.arch}`, CAPI[process.platform]!);
  if (existsSync(lib)) process.env.SMARTSPECTRA_CAPI_PATH = lib;
}

// Presage main process bridge. Loading it starts no session (and spends no credits); a session only
// exists while the renderer has called start(). VAULT_NO_SDK=1 skips it (simulated screenshots).
type Bind = (w: BrowserWindow, o?: { logger?: (level: 'info' | 'warn' | 'error', msg: string) => void }) => void;
let bindIpc: Bind | null = null;
if (process.env.VAULT_NO_SDK !== '1') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    bindIpc = (require('@smartspectra/node-sdk/main') as { bindSmartSpectraIpc: Bind }).bindSmartSpectraIpc;
  } catch (e) {
    console.error('[vault] SmartSpectra SDK could not load; live mode is off:', (e as Error)?.message ?? e);
    bindIpc = null;
  }
}

// What the page may know: whether live play can run and where the key comes from. Never the key itself.
ipcMain.handle('vault:presage', async () => {
  const k = bindIpc ? await findKey() : null;
  return { sdk: !!bindIpc, hasKey: !!k, from: k?.from ?? null, encrypted: await canEncrypt() };
});
// The player pasted a key: keep it (encrypted) for the SDK. Only our own page may set or clear it.
ipcMain.handle('vault:key:save', async (e, raw: unknown) => {
  if (!ownPage(e.senderFrame?.url ?? '')) throw new Error('not allowed');
  const key = cleanKey(raw);
  if (!key) return { ok: false, saved: false, encrypted: false };
  return { ok: true, ...(await saveKey(key)) };
});
ipcMain.handle('vault:key:forget', (e) => {
  if (!ownPage(e.senderFrame?.url ?? '')) throw new Error('not allowed');
  forgetKey();
});

// Native camera session. The renderer SDK copies every 1280x720 frame out of the page and over IPC,
// which cannot keep 30 fps on a busy laptop (SDK error "frame rate too low"). Here the SDK reads the
// camera itself in this process and only the small metrics packets cross to the page.
// One session per window; it is stopped on stop, on a new start, and when the window goes away.
type NativeSdk = {
  on(ev: string, cb: (...a: never[]) => void): unknown;
  useCamera(sel: unknown): unknown;
  useCustomInput(): unknown;
  sendFrame(buf: Buffer, w: number, h: number, stride: number, fmt: number, tsUs: number): boolean;
  start(): unknown;
  stopAsync(): Promise<void>;
  destroy(): unknown;
};
const natives = new Map<number, NativeSdk>();
// Page fed sessions: the page owns the camera (so the camera keeps its own auto exposure) and sends
// each frame here. The SDK's own camera path locks exposure once it runs, and on some laptop cameras
// that lock collapses the picture to near black (SDK log: "lock collapsed image brightness").
const fed = new Map<number, { lastTs: number; ready: boolean }>();
ipcMain.on('vault:native:frame', (e, buf: Uint8Array, w: number, h: number, fmt: number) => {
  const sdk = natives.get(e.sender.id);
  const f = fed.get(e.sender.id);
  if (!sdk || !f || !f.ready || !(buf instanceof Uint8Array)) return;
  // capture time in monotonic microseconds, strictly increasing
  let ts = Number(process.hrtime.bigint() / 1000n);
  if (ts <= f.lastTs) ts = f.lastTs + 1;
  f.lastTs = ts;
  const stride = fmt === 4 || fmt === 5 ? w : w * 4; // NV12/NV21: luma row stride; RGBA: 4 bytes a pixel
  try { sdk.sendFrame(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), w, h, stride, fmt, ts); } catch { /* session going away */ }
});

/** Nearest neighbour downscale of an SDK frame (RGB, BGR, RGBA, BGRA) to RGBA at `outW` wide. Other formats: null. */
function smallRgba(buf: Buffer, w: number, h: number, stride: number, fmt: number, outW: number): { data: Uint8ClampedArray; w: number; h: number } | null {
  const bpp = fmt === 0 || fmt === 1 ? 3 : fmt === 2 || fmt === 3 ? 4 : 0;
  if (!bpp || w <= 0 || h <= 0) return null;
  const bgr = fmt === 1 || fmt === 3;
  const ow = Math.min(outW, w), oh = Math.max(1, Math.round((h * ow) / w));
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const row = Math.floor((y * h) / oh) * stride;
    for (let x = 0; x < ow; x++) {
      const i = row + Math.floor((x * w) / ow) * bpp, o = (y * ow + x) * 4;
      out[o] = buf[bgr ? i + 2 : i]!; out[o + 1] = buf[i + 1]!; out[o + 2] = buf[bgr ? i : i + 2]!; out[o + 3] = 255;
    }
  }
  return { data: out, w: ow, h: oh };
}
async function stopNative(id: number): Promise<void> {
  const s = natives.get(id);
  natives.delete(id);
  fed.delete(id);
  if (!s) return;
  try { await Promise.race([s.stopAsync(), new Promise((r) => setTimeout(r, 4000))]); } catch { /* already stopped */ }
  try { await s.destroy(); } catch { /* already gone */ }
}
ipcMain.handle('vault:native:start', async (e, metrics: number[], opts?: { fed?: boolean }) => {
  const wc = e.sender;
  await stopNative(wc.id);
  const key = (await findKey())?.key;
  if (!bindIpc || !key) throw new Error('Live mode is off: no SDK or no Presage key.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@smartspectra/node-sdk') as {
    SmartSpectraSDK: { new (o: { apiKey: string; requestedMetrics: number[]; enableTelemetry?: boolean }): NativeSdk; availableCameras(): { id: string }[] };
    CameraSelection: { byId(id: string): unknown; default: unknown };
  };
  // SDK telemetry (session summaries, readiness reports) is opted out: the game sends Presage nothing beyond the SDK's own sign in
  const sdk = new mod.SmartSpectraSDK({ apiKey: key, requestedMetrics: metrics, enableTelemetry: false });
  natives.set(wc.id, sdk);
  const send = (type: string, ...args: unknown[]) => { if (natives.get(wc.id) === sdk && !wc.isDestroyed()) wc.send('vault:native:evt', type, ...args); };
  sdk.on('processingStatus', ((s: number) => send('processingStatus', s)) as never);
  sdk.on('validationStatus', ((c: number, t: number, h: string) => send('validationStatus', c, Number(t), h)) as never);
  sdk.on('error', ((c: number, m: string, r: boolean) => { console.warn(`[smartspectra] error ${c}: ${m}`); send('error', c, m, r); }) as never);
  sdk.on('metrics', ((buf: Buffer, ts: number) => send('metrics', new Uint8Array(buf), Number(ts))) as never);
  // Self view: the page cannot open the camera while the SDK holds it, so pass small copies of the
  // SDK's own frames (320 wide, about 10 a second) as RGBA for a canvas preview.
  let lastPreview = 0;
  let lastPreviewLogged = false;
  // (page fed sessions show the page's own camera, so no copies are needed)
  if (!opts?.fed) sdk.on('videoOutput', ((buf: Buffer, w: number, h: number, stride: number, fmt: number) => {
    const now = Date.now();
    if (now - lastPreview < 100) return;
    lastPreview = now;
    const rgba = smallRgba(buf, w, h, stride, fmt, 320);
    if (rgba) { if (!lastPreviewLogged) { lastPreviewLogged = true; console.log(`[vault] preview frames flowing ${w}x${h} fmt ${fmt}`); } send('preview', rgba.data, rgba.w, rgba.h); }
    else if (!lastPreviewLogged) { lastPreviewLogged = true; console.log(`[vault] preview format not supported: fmt ${fmt}`); }
  }) as never);
  wc.once('destroyed', () => { void stopNative(wc.id); });
  if (opts?.fed) {
    sdk.useCustomInput();
    fed.set(wc.id, { lastTs: 0, ready: false });
  } else {
    const cams = mod.SmartSpectraSDK.availableCameras();
    sdk.useCamera(cams.length ? mod.CameraSelection.byId(cams[0]!.id) : mod.CameraSelection.default);
  }
  try { await Promise.resolve(sdk.start()); } catch (err) { await stopNative(wc.id); throw err; }
  const f = fed.get(wc.id);
  if (f && natives.get(wc.id) === sdk) f.ready = true;
});
ipcMain.handle('vault:native:stop', (e) => stopNative(e.sender.id));
app.on('before-quit', () => { for (const id of [...natives.keys()]) void stopNative(id); });

function ownPage(url: string): boolean {
  if (url.startsWith('file://')) return true;
  const dev = process.env.ELECTRON_RENDERER_URL;
  return !!dev && url.startsWith(dev);
}

function createWindow(): void {
  const hidden = process.env.VAULT_HIDDEN === '1';
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#050505', show: false, autoHideMenuBar: true,
    // backgroundThrottling off: the page feeds camera frames to the SDK and must not slow down when unfocused
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, offscreen: hidden, backgroundThrottling: false },
  });
  if (!hidden) win.once('ready-to-show', () => win.show());
  // The only outside link is where to get a free Presage key: open it in the browser, never in the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/physiology\.presagetech\.com(\/|$)/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!ownPage(url)) e.preventDefault(); });
  // The SDK binding tears its session down when this window closes.
  if (bindIpc) bindIpc(win, { logger: (level, msg) => (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`[smartspectra] ${msg}`) });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = (details && 'requestingUrl' in details && details.requestingUrl) || wc?.getURL() || '';
    cb(permission === 'media' && ownPage(url));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
