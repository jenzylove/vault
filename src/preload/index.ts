import { contextBridge, ipcRenderer } from 'electron';

// Presage renderer bridge (exposes window.__smartspectraBridge for @smartspectra/node-sdk/renderer).
try { require('@smartspectra/node-sdk/preload'); } catch (e) { console.error('[vault] SmartSpectra preload bridge failed', e); }

// The game's own bridge: whether live mode can run, and the Presage key from the main process (.env).
contextBridge.exposeInMainWorld('vault', {
  presage: (): Promise<{ key: string | null; sdk: boolean }> => ipcRenderer.invoke('vault:presage'),
  // Native camera session in the main process (see src/main/index.ts): only metrics cross over.
  native: {
    start: (metrics: number[]): Promise<void> => ipcRenderer.invoke('vault:native:start', metrics),
    stop: (): Promise<void> => ipcRenderer.invoke('vault:native:stop'),
    on: (cb: (type: string, ...args: unknown[]) => void): (() => void) => {
      const h = (_e: unknown, type: string, ...args: unknown[]) => cb(type, ...args);
      ipcRenderer.on('vault:native:evt', h);
      return () => { ipcRenderer.removeListener('vault:native:evt', h); };
    },
  },
});
