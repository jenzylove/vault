export type BoxKind = 'small' | 'big' | 'trap';
export type BoxState = 'sealed' | 'peeked' | 'sold' | 'opened' | 'burned';
export type ExprKey = 'neutral' | 'happy' | 'sad' | 'surprise' | 'fear' | 'disgust' | 'anger' | 'contempt';
export const EXPR_KEYS: readonly ExprKey[] = ['neutral', 'happy', 'sad', 'surprise', 'fear', 'disgust', 'anger', 'contempt'];

export interface Box {
  id: number;
  kind: BoxKind;
  value: number;
  state: BoxState;
}

/** What "calm" looks like for this player, learned in the 10 s silent baseline. */
export interface Baseline {
  breathPeriodMs: number;   // typical breath cycle
  breathRatePerMin: number;
  breathAmp: number;        // typical peak to trough swing of the chest trace
  windowAmp: number;        // typical p95 - p5 swing inside a peek length window (same measure as a peek)
  flatTol: number;          // band (trace units) the smoothed chest trace must stay inside to count as flat
  driftPerMs: number;       // typical slow drift of the trace (p90 of |slope| of a 6 s average)
  pauseLowMs: number;       // longest normal flat at the bottom of a breath (p90): the normal pause
  pauseHighMs: number;      // longest normal flat at the top of a breath (p90)
  turnLowMs: number;        // typical (median) flat at the bottom: subtracted when reporting a hold
  turnHighMs: number;       // typical (median) flat at the top
  blinkRatePerMin: number;
  expr: Record<string, number>;
  pulse: number | null;
  noise: number;            // raw minus smoothed chest, relative to breathAmp
  quality: number;          // share of good frames during the baseline
  durationMs: number;
  /** Peek length the calm windows were measured at (ms). A peek must last this long to compare like for like. */
  peekMs?: number;
}

export interface PeekFeatures {
  breathCatchMs: number;    // longest abnormal hold in the peek (0 if none beyond the normal pause)
  shallowing: number;       // 1 - amplitude / baseline amplitude (positive = shallower)
  rateChange: number;       // breath rate vs baseline, signed fraction (-1 = no breath at all)
  blinkBurst: number;       // (blink rate - baseline) / baseline, signed (negative = suppression)
  exprDelta: Record<string, number>;
  talking: boolean;
  pulseDelta: number;       // bpm vs baseline (12 s average: slow heat only)
  quality: number;          // share of good frames
  // detail for spoken reasons
  windowMs?: number;
  blinkCount?: number;
  expectedBlinks?: number;
  /** When the counted hold ran, ms from the start of the peek window (null when there was none). */
  catchStartMs?: number | null;
  catchEndMs?: number | null;
  /** Blink onsets, ms from the start of the peek window. */
  blinkAtMs?: number[];
}

export type BankerSignal = 'breath' | 'blinks' | 'face' | 'pulse' | 'none';

export interface BankerRead {
  pTrap: number;
  pBig: number;
  decision: 'walk' | 'offer' | 'unread';
  offer?: number;
  reason: string;
  signal: BankerSignal;
  /** The single measure that carried the call, when one did. */
  driver?: 'breath' | 'shallow' | 'rate' | 'blinks' | 'joy' | 'alarm' | null;
  /** The seeded pick his line came from (game seed and turn), so the replay speaks from the same pick. */
  lines?: { seed: number; turn: number };
}
