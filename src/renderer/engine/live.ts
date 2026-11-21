/**
 * The live read: what the banker sees while the peek is still running. Only the breath hold is
 * read live (it is local in time); swing, rate and blinks need the whole window and are left to the
 * full read at the end. Pure: frames in, numbers out.
 */
import type { SignalFrame } from '../signals/types';
import type { Baseline, Box, PeekFeatures } from './types';
import { SMOOTH_MS } from './baseline';
import { catchAllowance, findCatch, type CatchSpan } from './features';
import { readBanker, type BankerModel, type BankerView } from './banker';
import { clamp, flatSpans, isGood, smoothByTime } from './dsp';

export interface LiveRead {
  /** 0..1 how sure he is right now that you are looking at a trap. */
  alert: number;
  /** The hold he would count if the peek ended now (signal time), or null. */
  catchSpan: CatchSpan | null;
  /** How long the breath has been flat up to the newest sample, ms (0 while it moves). */
  holdingMs: number;
}

const NEUTRAL: PeekFeatures = {
  breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1,
};
const NO_BOX: Box = { id: -1, kind: 'small', value: 0, state: 'peeked' };

/** His suspicion before he has seen anything: the board odds and his heat. */
export function restingAlert(model: BankerModel, view: BankerView): number {
  return readBanker(model, NEUTRAL, NO_BOX, view).pTrap;
}

export function liveRead(frames: readonly SignalFrame[], baseline: Baseline, model: BankerModel, view: BankerView): LiveRead {
  const rest = restingAlert(model, view);
  const chest = frames.filter((f) => isGood(f) && typeof f.chest === 'number');
  if (chest.length < 10) return { alert: rest, catchSpan: null, holdingMs: 0 };
  const t = chest.map((f) => f.t);
  const v = chest.map((f) => f.chest as number);
  const sm = smoothByTime(t, v, SMOOTH_MS);
  const c = findCatch(t, sm, baseline);
  const tEnd = t[t.length - 1] as number;
  const last = flatSpans(t, sm, baseline.flatTol, baseline.driftPerMs).find((f) => tEnd - f.end < 120);
  const holdingMs = last ? last.end - last.start : 0;
  const talking = chest.filter((f) => f.talking === true).length / chest.length >= 0.2;

  const p = readBanker(model, { ...NEUTRAL, breathCatchMs: c ? c.ms : 0, talking }, NO_BOX, view).pTrap;
  let alert = p;
  // a pause growing toward his limit: he leans in before he is sure
  const limit = catchAllowance(Math.max(baseline.pauseLowMs, baseline.pauseHighMs));
  if (holdingMs > 0) {
    const ramp = clamp(holdingMs / limit, 0, 1);
    alert = Math.max(alert, rest + (0.8 - rest) * ramp * ramp);
  }
  // he never buys a box he saw you catch your breath at
  if (c && !talking) alert = Math.max(alert, 0.92);
  return { alert: clamp(alert, 0, 1), catchSpan: c, holdingMs };
}
