import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';

let bindIpc: ((w: BrowserWindow) => void) | null = null;
try {
  // Presage main process bridge (wired by the chief; optional while the SDK is not needed)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  bindIpc = require('@smartspectra/node-sdk/main').bindSmartSpectraIpc;
} catch { bindIpc = null; }

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#050505', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  if (bindIpc) bindIpc(win);
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
