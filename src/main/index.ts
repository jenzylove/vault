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
