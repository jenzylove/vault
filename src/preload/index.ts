import { contextBridge, ipcRenderer } from 'electron';

// Presage renderer bridge (exposes window.__smartspectraBridge for @smartspectra/node-sdk/renderer).
try { require('@smartspectra/node-sdk/preload'); } catch (e) { console.error('[vault] SmartSpectra preload bridge failed', e); }

type KeyFrom = 'env' | 'file' | 'saved';

// The game's own bridge: whether live mode can run and where the Presage key comes from (never the key),
// and a way to save or forget a pasted key. The key itself stays in the main process (src/main/keyStore.ts).
contextBridge.exposeInMainWorld('vault', {
  presage: (): Promise<{ sdk: boolean; hasKey: boolean; from: KeyFrom | null; encrypted: boolean }> => ipcRenderer.invoke('vault:presage'),
  key: {
    save: (key: string): Promise<{ ok: boolean; saved: boolean; encrypted: boolean }> => ipcRenderer.invoke('vault:key:save', key),
    forget: (): Promise<void> => ipcRenderer.invoke('vault:key:forget'),
  },
  // Native camera session in the main process (see src/main/index.ts): only metrics cross over.
  native: {
    start: (metrics: number[], opts?: { fed?: boolean }): Promise<void> => ipcRenderer.invoke('vault:native:start', metrics, opts),
    // one camera frame from the page (page fed sessions): NV12 or RGBA bytes, fire and forget
    frame: (buf: Uint8Array, w: number, h: number, fmt: number): void => ipcRenderer.send('vault:native:frame', buf, w, h, fmt),
    stop: (): Promise<void> => ipcRenderer.invoke('vault:native:stop'),
    on: (cb: (type: string, ...args: unknown[]) => void): (() => void) => {
      const h = (_e: unknown, type: string, ...args: unknown[]) => cb(type, ...args);
      ipcRenderer.on('vault:native:evt', h);
      return () => { ipcRenderer.removeListener('vault:native:evt', h); };
    },
  },
});
