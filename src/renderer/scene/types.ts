// Scene contract (docs/SPEC.md). The scene renders props only; it never knows game rules.
export type SceneBoxState = 'sealed' | 'peeking' | 'opened-treasure' | 'opened-trap' | 'sold' | 'burned';
export type SceneBoxKind = 'small' | 'big' | 'trap';
export type BankerState = 'idle' | 'reading' | 'speaking' | 'walking' | 'offering';

export interface SceneBox {
  id: number;
  state: SceneBoxState;
  kind?: SceneBoxKind;
}

export interface VaultSceneProps {
  boxes: SceneBox[];
  activeBoxId: number | null;
  peekContents: SceneBoxKind | null; // shown only to the player during a peek
  bankerState: BankerState;
  breath: number[]; // last ~10 s of normalized chest trace (-1..1)
  heartbeat: number; // 0..1 envelope, spikes on each detected beat
  heat: number; // 0..1 banker suspicion
  onBoxClick?: (id: number) => void;
  quality: 'high' | 'medium';
}
