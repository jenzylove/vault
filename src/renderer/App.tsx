// Wiring: the App picks the signal source; everything else consumes the SignalSource interface.
import { useEffect, useState } from 'react';
import { Game, type SourceChoice } from './ui/Game';
import { SimulatedSource } from './ui/simSource';
import { pace } from './ui/storage';
import type { SignalSource } from './signals/types';

interface VaultBridge { presage(): Promise<{ key: string | null; sdk: boolean }> }
const bridge = (): VaultBridge | null => (window as unknown as { vault?: VaultBridge }).vault ?? null;

// The key from .env, held only in memory here and handed straight to the SDK. Never logged.
let fileKey: string | null = null;

async function createSource(choice: SourceChoice): Promise<SignalSource> {
  if (choice.mode === 'simulated') return new SimulatedSource(undefined, 'honest', pace());
  const key = choice.key.trim() || fileKey;
  if (!key) throw new Error('no Presage key');
  // Live Presage camera. Loaded lazily so the SDK is only touched once the player chose it.
  const { LiveSource } = await import('./signals/live');
  return new LiveSource(key);
}

export default function App() {
  const [keyOnFile, setKeyOnFile] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge()?.presage().then((p) => {
      fileKey = p.key;
      if (live) setKeyOnFile(!!p.key);
    }).catch(() => { /* no bridge: paste a key or play simulated */ });
    return () => { live = false; };
  }, []);
  return <Game createSource={createSource} keyOnFile={keyOnFile} />;
}
