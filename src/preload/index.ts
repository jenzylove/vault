import { contextBridge, ipcRenderer } from 'electron';

// Presage renderer bridge (exposes window.__smartspectraBridge for @smartspectra/node-sdk/renderer).
try { require('@smartspectra/node-sdk/preload'); } catch (e) { console.error('[vault] SmartSpectra preload bridge failed', e); }

// The game's own bridge: whether live mode can run, and the Presage key from the main process (.env).
contextBridge.exposeInMainWorld('vault', {
  presage: (): Promise<{ key: string | null; sdk: boolean }> => ipcRenderer.invoke('vault:presage'),
});
