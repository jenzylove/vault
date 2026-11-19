# The Vault: shared build spec (contract between agents)

Read docs/PRD.md first. This file fixes the interfaces so the engine, the 3D scene and the SDK layer can be built in parallel.

## Stack
- Electron + Vite (electron-vite) + React 18 + TypeScript (strict).
- 3D: three, @react-three/fiber, @react-three/drei, @react-three/postprocessing.
- Tests: vitest. Lint: tsc --noEmit.
- Presage: @smartspectra/node-sdk (renderer entry `@smartspectra/node-sdk/renderer`, main `bindSmartSpectraIpc`, preload `@smartspectra/node-sdk/preload`, plus `window.vault.presage()` from our preload for the key). Owned by the chief, not by agents.

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
export type ProcessingState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export interface ValidationInfo { code: number; hint: string; at: number }  // SDK ValidationCode (0 ok), the SDK's hint as given, performance.now()
export interface SourceError { code: number | string; message: string; say: string; retryable: boolean } // `say` is the player facing text
export interface SourceStatus {
  processing: ProcessingState;
  validation: ValidationInfo | null;   // latest validationStatus packet
  error: SourceError | null;           // a session ending error (the source has already stopped itself)
  stream: MediaStream | null;          // camera stream for the mirrored preview (live only)
}
export interface SignalSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: (f: SignalFrame) => void): () => void;
  kind: 'live' | 'replay' | 'simulated';
  status(): SourceStatus;
  onStatus(cb: (s: SourceStatus) => void): () => void;
}
```

### Live source and credits (`src/renderer/signals/live.ts`)
- Presage bills by session wall time. A session exists only between `start()` and `stop()`; `stop()` waits for a pending `start()` so it can never orphan one, then calls the SDK's `stop()` and `destroy()`.
- Metrics: breathing (0, 1, 2), cardio (15, 16, 17) and face 12, 13, 14 (blinking, talking, expressions). Face landmarks (11) are never requested.
- The key comes from `PRESAGE_API_KEY` (environment or `.env`, read by the main process, never logged) or a key the player pastes.
- Errors: network (5) restarts the session once; metric not authorized (13) steps down to breathing + cardio, then breathing only; everything else (including 14, frame rate too low) stops the session and reports `status().error.say`.
- The Game starts the session at the lineup and stops it on results (reveal), leaving, Esc, window close or hide, a face pause longer than 45 s, a lineup longer than 45 s, a minute with no input outside a read, and any error.

### Lineup and face pause (`src/renderer/signals/lineup.ts`, `src/renderer/ui/Lineup.tsx`)
- Before the calm step (live only) the player lines up in a mirrored preview with a gold face oval and shoulder curve. The SDK's validation hint is shown big in plain words (1 no face found, 5 more light, 7 show more chest, 16 move up or tilt the camera down; any other hint as given, without dashes).
- Continue opens when no validation problem has been reported for 2 s and chest samples have arrived without a gap over 2.5 s for 2 s (`LineupGate`).
- Mid game, a read (calm, practice peek, peek) pauses while the SDK reports validation code 1 (no face) or 2 (multiple faces) for 0.8 s, and resumes 1 s after it clears (`FaceWatch`). The SDK's metrics carry no face count, so these codes are the only face signal used. The paused read starts over.

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
