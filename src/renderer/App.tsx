// Wiring: the App picks the signal source; everything else consumes the SignalSource interface.
import { Game, type SourceChoice } from './ui/Game';
import { SimulatedSource } from './ui/simSource';
import { pace } from './ui/storage';
import type { SignalSource } from './signals/types';

async function createSource(choice: SourceChoice): Promise<SignalSource> {
  if (choice.mode === 'simulated') return new SimulatedSource(undefined, 'honest', pace());
  // Live Presage camera. Loaded lazily so the SDK is only touched once the player chose it.
  const { LiveSource } = await import('./signals/live');
  return new LiveSource(choice.key);
}

export default function App() {
  return <Game createSource={createSource} />;
}
