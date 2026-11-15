# The Vault: shared build spec (contract between agents)

Read docs/PRD.md first. This file fixes the interfaces so the engine, the 3D scene and the SDK layer can be built in parallel.

## Stack
- Electron + Vite (electron-vite) + React 18 + TypeScript (strict).
- 3D: three, @react-three/fiber, @react-three/drei, @react-three/postprocessing.
- Tests: vitest. Lint: tsc --noEmit.
- Presage: @smartspectra/node-sdk (renderer entry `@smartspectra/node-sdk/renderer`, main `bindSmartSpectraIpc`, preload `@smartspectra/node-sdk/preload`). Owned by the chief, not by agents.

## Folders (each agent owns only its folder)
- `src/main/`, `src/preload/` : Electron shell (chief)
- `src/renderer/signals/` : SDK adapter + replay adapter (chief)
- `src/renderer/engine/` : pure game logic, no DOM, no three, no SDK (engine agent) + `tests/engine/`
- `src/renderer/scene/` : realistic 3D vault (scene agent), public assets in `src/renderer/public/assets/`
- `src/renderer/ui/` : 2D overlay screens (later)
- `src/renderer/App.tsx` : wiring (chief)

## Signal contract (`src/renderer/signals/types.ts`)
```ts
export interface SignalFrame {
  t: number;            // ms since session start
  chest?: number;       // raw upper breathing trace sample (unitless, relative)
  abdomen?: number;     // raw lower breathing trace sample
  cardio?: number;      // arterial pressure trace sample (beat waveform)
  pulse?: number;       // bpm, 12 s average
  blink?: boolean;      // blink detected at this sample
  talking?: boolean;
  expr?: Partial<Record<'neutral'|'happy'|'sad'|'surprise'|'fear'|'disgust'|'anger'|'contempt', number>>;
  conf: number;         // 0..1 confidence of the sample
  stable: boolean;
}
export interface SignalSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: (f: SignalFrame) => void): () => void;
  kind: 'live' | 'replay' | 'simulated';
}
```

## Engine contract (`src/renderer/engine/index.ts`)
```ts
export type BoxKind = 'small' | 'big' | 'trap';
export interface Box { id: number; kind: BoxKind; value: number; state: 'sealed'|'peeked'|'sold'|'opened'|'burned'; }
export interface Baseline { /* breathing band, typical breath period, blink rate, expr means, pulse */ }
export interface PeekFeatures { breathCatchMs: number; shallowing: number; rateChange: number; blinkBurst: number; exprDelta: Record<string, number>; talking: boolean; pulseDelta: number; quality: number; }
export interface BankerRead { pTrap: number; pBig: number; decision: 'walk'|'offer'|'unread'; offer?: number; reason: string; signal: 'breath'|'blinks'|'face'|'pulse'|'none'; }

export function learnBaseline(frames: SignalFrame[]): Baseline;
export function extractFeatures(frames: SignalFrame[], baseline: Baseline): PeekFeatures; // frames = one 8 s peek window
export function createBanker(baseline: Baseline, opts?: { seed?: number }): Banker;
export interface Banker {
  learn(features: PeekFeatures, kind: BoxKind): void;       // practice peeks + audits after reveal
  read(features: PeekFeatures, box: Box, game: GameState): BankerRead; // decides walk/offer, writes the spoken reason
  heat: number;
}
export function newGame(seed: number): GameState;           // 10 boxes: 5 small, 2 big, 3 traps; values from a fixed table
export function step(state: GameState, action: GameAction): GameState; // pure reducer
// GameAction: begin, practiceDone, choose(boxId), peekDone(features), sell, open, leave, reveal
```
Spoken reasons are plain, short, specific ("Trap. Your breath stopped for 1.4 seconds."). Never the words lie, liar, stress, anxiety, poker, straight face.

## Scene contract (`src/renderer/scene/VaultScene.tsx`)
```tsx
export interface VaultSceneProps {
  boxes: { id: number; state: 'sealed'|'peeking'|'opened-treasure'|'opened-trap'|'sold'|'burned'; kind?: 'small'|'big'|'trap' }[];
  activeBoxId: number | null;
  peekContents: 'small'|'big'|'trap' | null;   // shown only to the player during a peek
  bankerState: 'idle'|'reading'|'speaking'|'walking'|'offering';
  breath: number[];        // last ~10 s of normalized chest trace (-1..1) for the brass gauge needle and paper strip
  heartbeat: number;       // 0..1 envelope, spikes on each detected beat (lamp flicker)
  heat: number;            // 0..1 banker suspicion (ambient tension: lamp colour, fog, clock tick rate)
  onBoxClick?: (id: number) => void;
  quality: 'high' | 'medium';
}
export function VaultScene(props: VaultSceneProps): JSX.Element;
```
The scene never knows game rules; it only renders props and animates transitions.

## Rules for every agent
- No fake states: the scene animates what props say; the engine computes from frames. Simulated data only in clearly labelled demo/sim modes.
- No secrets in code. No network calls except asset downloads during development.
- Stay in your folder. Don't run `npm install` unless your brief says so.
- Commit nothing; the chief reviews and commits.
