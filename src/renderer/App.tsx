// Wiring: the App picks the signal source; everything else consumes the SignalSource interface.
import { useEffect, useState } from 'react';
import { Game, type SourceChoice } from './ui/Game';
import { SimulatedSource } from './ui/simSource';
import { pace } from './ui/storage';
import { announceKeyChange, onKeyChange, presageBridge } from './ui/presageKey';
import type { SignalSource } from './signals/types';

async function createSource(choice: SourceChoice): Promise<SignalSource> {
  if (choice.mode === 'simulated') return new SimulatedSource(undefined, 'honest', pace());
  const bridge = presageBridge();
  if (!bridge?.key) throw new Error('live play needs the desktop app');
  const pasted = choice.key.trim();
  if (pasted) {
    // The main process keeps the key (encrypted in the app's data folder) and gives it only to the SDK.
    const r = await bridge.key.save(pasted);
    if (!r.ok) throw new Error('that does not look like a Presage key');
    announceKeyChange();
  } else if (!(await bridge.presage()).hasKey) {
    throw new Error('no Presage key');
  }
  // Live Presage camera. Loaded lazily so the SDK is only touched once the player chose it. The camera session
  // runs in the main process, which reads the key itself; the pasted copy only serves the renderer SDK fallback.
  const { LiveSource } = await import('./signals/live');
  return new LiveSource(pasted);
}

export default function App() {
  const [keyOnFile, setKeyOnFile] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => {
      void presageBridge()?.presage().then((p) => { if (live) setKeyOnFile(p.hasKey); })
        .catch(() => { /* no bridge: paste a key or play simulated */ });
    };
    check();
    const off = onKeyChange(check);
    return () => { live = false; off(); };
  }, []);
  return <Game createSource={createSource} keyOnFile={keyOnFile} />;
}
