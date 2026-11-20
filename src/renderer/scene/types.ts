// Scene contract (docs/SPEC.md). The scene renders props only; it never knows game rules.
/**
 * 'burned': the banker walked; the box stays in its slot, scorched and strapped shut, for the rest of the game.
 * 'burned-revealed': the end of game reveal of a burned box: still scorched, straps off, lid open on what was inside (needs kind).
 */
export type SceneBoxState = 'sealed' | 'peeking' | 'opened-treasure' | 'opened-trap' | 'sold' | 'burned' | 'burned-revealed';
export type SceneBoxKind = 'small' | 'big' | 'trap';
export type BankerState = 'idle' | 'reading' | 'speaking' | 'walking' | 'offering';

export interface SceneBox {
  id: number;
  state: SceneBoxState;
  kind?: SceneBoxKind;
}

/** A labelled practice box on its own tray. The banker knows what is inside, so a card says it. */
export interface ScenePracticeBox {
  kind: SceneBoxKind;
  /** sealed on the tray, peeking (lifted toward the player), or opened (lid up, contents shown) */
  state: 'sealed' | 'peeking' | 'opened';
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
  /** Live camera mode: the SDK copies every camera frame on this same thread, so draw lighter (about 20 fps, lower resolution, no post effects). */
  lite?: boolean;
  /**
   * Optional practice round. While set, the practice tray sits behind the ten boxes with one box per entry
   * (usually two). Omit it (or pass []) once practice is over and the tray is cleared away.
   */
  practice?: ScenePracticeBox[];
  /** 0..1, how suspicious the banker is right now: he leans toward the glass as it rises. */
  alert?: number;
  /** performance.now() timestamp of the latest detected breath catch: lamp flare, needle jump, camera push. */
  catchPulse?: number;
}
