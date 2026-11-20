import { app, BrowserWindow, ipcMain, session } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Presage key lives in .env (PRESAGE_API_KEY) or the environment. It is read here, handed to the
// renderer only when it asks for it to start a session, and never logged.
function readKey(): string | null {
  const fromEnv = process.env.PRESAGE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  for (const dir of [app.getAppPath(), process.cwd()]) {
    const file = join(dir, '.env');
    if (!existsSync(file)) continue;
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?PRESAGE_API_KEY\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const v = (m[1] ?? '').replace(/^(['"])(.*)\1$/, '$2').trim();
        if (v) return v;
      }
    } catch { /* unreadable .env: no key */ }
  }
  return null;
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

ipcMain.handle('vault:presage', () => ({ key: bindIpc ? readKey() : null, sdk: !!bindIpc }));

// Native camera session. The renderer SDK copies every 1280x720 frame out of the page and over IPC,
// which cannot keep 30 fps on a busy laptop (SDK error "frame rate too low"). Here the SDK reads the
// camera itself in this process and only the small metrics packets cross to the page.
// One session per window; it is stopped on stop, on a new start, and when the window goes away.
type NativeSdk = {
  on(ev: string, cb: (...a: never[]) => void): unknown;
  useCamera(sel: unknown): unknown;
  start(): unknown;
  stopAsync(): Promise<void>;
  destroy(): unknown;
};
const natives = new Map<number, NativeSdk>();
async function stopNative(id: number): Promise<void> {
  const s = natives.get(id);
  natives.delete(id);
  if (!s) return;
  try { await Promise.race([s.stopAsync(), new Promise((r) => setTimeout(r, 4000))]); } catch { /* already stopped */ }
  try { await s.destroy(); } catch { /* already gone */ }
}
ipcMain.handle('vault:native:start', async (e, metrics: number[]) => {
  const wc = e.sender;
  await stopNative(wc.id);
  const key = readKey();
  if (!bindIpc || !key) throw new Error('Live mode is off: no SDK or no Presage key.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@smartspectra/node-sdk') as {
    SmartSpectraSDK: { new (o: { apiKey: string; requestedMetrics: number[] }): NativeSdk; availableCameras(): { id: string }[] };
    CameraSelection: { byId(id: string): unknown; default: unknown };
  };
  const sdk = new mod.SmartSpectraSDK({ apiKey: key, requestedMetrics: metrics });
  natives.set(wc.id, sdk);
  const send = (type: string, ...args: unknown[]) => { if (natives.get(wc.id) === sdk && !wc.isDestroyed()) wc.send('vault:native:evt', type, ...args); };
  sdk.on('processingStatus', ((s: number) => send('processingStatus', s)) as never);
  sdk.on('validationStatus', ((c: number, t: number, h: string) => send('validationStatus', c, Number(t), h)) as never);
  sdk.on('error', ((c: number, m: string, r: boolean) => { console.warn(`[smartspectra] error ${c}: ${m}`); send('error', c, m, r); }) as never);
  sdk.on('metrics', ((buf: Buffer, ts: number) => send('metrics', new Uint8Array(buf), Number(ts))) as never);
  wc.once('destroyed', () => { void stopNative(wc.id); });
  const cams = mod.SmartSpectraSDK.availableCameras();
  sdk.useCamera(cams.length ? mod.CameraSelection.byId(cams[0]!.id) : mod.CameraSelection.default);
  try { await Promise.resolve(sdk.start()); } catch (err) { await stopNative(wc.id); throw err; }
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
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, offscreen: hidden },
  });
  if (!hidden) win.once('ready-to-show', () => win.show());
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
