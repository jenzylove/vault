// The page's view of the Presage key (window.vault from src/preload/index.ts). The page can ask whether a key
// is set and where it comes from, hand over a pasted key, or forget it. It can never read a saved key back.
export type KeyFrom = 'env' | 'file' | 'saved';
export interface PresageStatus { sdk: boolean; hasKey: boolean; from: KeyFrom | null; encrypted: boolean }
export interface PresageBridge {
  presage(): Promise<PresageStatus>;
  key?: {
    save(key: string): Promise<{ ok: boolean; saved: boolean; encrypted: boolean }>;
    forget(): Promise<void>;
  };
}

export const presageBridge = (): PresageBridge | null => (window as unknown as { vault?: PresageBridge }).vault ?? null;

/** Sent on window whenever the key is saved or forgotten, so every screen asks again. */
const KEY_EVENT = 'vault:presage-key';
export function announceKeyChange(): void { window.dispatchEvent(new Event(KEY_EVENT)); }
export function onKeyChange(cb: () => void): () => void {
  window.addEventListener(KEY_EVENT, cb);
  return () => window.removeEventListener(KEY_EVENT, cb);
}
