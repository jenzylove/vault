import type { SignalFrame } from '../signals/types';
import type { Baseline, PeekFeatures } from './types';
import { EXPR_KEYS } from './types';
import { SMOOTH_MS, windowSwing } from './baseline';
import {
  blinkOnsets, clamp, coveredMs, flatSpans, isGood, levelOf, linearDetrend, mean, median,
  smoothByTime, upCrossings,
} from './dsp';

/** Extra hold beyond the person's own longest normal pause before a flat stretch counts as a catch. */
export const CATCH_MARGIN_MS = 400;
/** ...and past this multiple of it (natural pauses vary breath to breath). */
export const CATCH_MARGIN_X = 1.3;
/** Below this share of good frames the banker cannot read the peek. */
export const MIN_QUALITY = 0.5;

function emptyFeatures(quality: number, windowMs: number): PeekFeatures {
  return {
    breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false,
    pulseDelta: 0, quality, windowMs, blinkCount: 0, expectedBlinks: 0, catchStartMs: null, catchEndMs: null, blinkAtMs: [],
  };
}

/** A held breath the banker counts: when it ran (signal time) and how long it reads as held. */
export interface CatchSpan { start: number; end: number; ms: number; }

/**
 * The longest flat stretch that runs past this person's own longest normal flat for its position.
 * A hold at the top (right after an inhale) is compared with their normal top turn; a pause at the
 * bottom of an exhale with their normal pause, so a normal pause never counts. The reported hold
 * subtracts half their typical turn (the ramps either side of a pause), so it reads close to the
 * time actually held.
 */
export function findCatch(t: readonly number[], sm: readonly number[], baseline: Baseline): CatchSpan | null {
  const A = baseline.breathAmp;
  const P = baseline.breathPeriodMs;
  const flats = flatSpans(t, sm, baseline.flatTol, baseline.driftPerMs);
  let best: CatchSpan | null = null;
  for (const f of flats) {
    const d = f.end - f.start;
    const lv = levelOf(f, t, sm, 0.75 * P, A);
    const high = lv.ambiguous || lv.level >= 0.5;
    const allowance = lv.ambiguous ? Math.max(baseline.pauseLowMs, baseline.pauseHighMs) : high ? baseline.pauseHighMs : baseline.pauseLowMs;
    const turn = lv.ambiguous ? Math.min(baseline.turnLowMs, baseline.turnHighMs) : high ? baseline.turnHighMs : baseline.turnLowMs;
    if (d > catchAllowance(allowance)) {
      const ms = d - 0.5 * turn;
      if (!best || ms > best.ms) best = { start: f.start, end: f.end, ms };
    }
  }
  return best;
}

/** A flat stretch longer than this (for a normal flat of `allowance` ms) is a catch. */
export function catchAllowance(allowance: number): number {
  return Math.max(allowance * CATCH_MARGIN_X, allowance + CATCH_MARGIN_MS);
}

/** Minimum good signal in a peek before the banker will read it at all. */
export const MIN_GOOD_MS = 3000;

/**
 * Features of one peek window (about 5 s) against the player's baseline.
 * Breath, blinks, face and talking are real time; pulse is a 12 s average so it only feeds slow heat.
 * Times of what was measured (catchStartMs, catchEndMs, blinkAtMs) are ms from the first frame of
 * the window, so a replay can mark them on the trace.
 */
export function extractFeatures(frames: readonly SignalFrame[], baseline: Baseline): PeekFeatures {
  const t0 = frames.length ? (frames[0] as SignalFrame).t : 0;
  const windowMs = frames.length > 1 ? (frames[frames.length - 1] as SignalFrame).t - t0 : 0;
  const good = frames.filter(isGood);
  const chest = good.filter((f) => typeof f.chest === 'number');
  const quality = frames.length ? chest.length / frames.length : 0;
  const goodMs = coveredMs(good);
  if (quality < MIN_QUALITY || goodMs < MIN_GOOD_MS || chest.length < 20) return emptyFeatures(quality, windowMs);

  const t = chest.map((f) => f.t);
  const v = chest.map((f) => f.chest as number);
  const sm = smoothByTime(t, v, SMOOTH_MS);
  const A = baseline.breathAmp;
  const P = baseline.breathPeriodMs;

  // 1. Catch.
  const c = findCatch(t, sm, baseline);
  const breathCatchMs = c ? c.ms : 0;

  // 2. Shallowing: swing in this window vs the typical swing of a peek length window at rest.
  const swing = windowSwing(t, sm);
  const shallowing = clamp(1 - swing / Math.max(1e-9, baseline.windowAmp), -1.5, 1);

  // 3. Rate change from rising crossings.
  const d = linearDetrend(t, sm);
  const ups = upCrossings(t, d, median(d), 0.12 * A);
  let rateChange = 0;
  if (ups.length >= 2) {
    const span = (ups[ups.length - 1] as number) - (ups[0] as number);
    const rate = (ups.length - 1) / Math.max(span, 1);
    rateChange = clamp(rate * P - 1, -1, 2);
  } else if (ups.length === 0 && swing < 0.4 * baseline.windowAmp) {
    rateChange = -1; // no breath in a whole peek window
  }

  // 4. Blinks: burst or suppression vs baseline rate.
  const minutes = goodMs / 60000;
  const blinkCount = blinkOnsets(good);
  const blinkAtMs: number[] = [];
  let prevBlink = false;
  for (const f of good) {
    const b = f.blink === true;
    if (b && !prevBlink) blinkAtMs.push(f.t - t0);
    prevBlink = b;
  }
  const expectedBlinks = baseline.blinkRatePerMin * minutes;
  const blinkBurst = clamp((blinkCount / minutes - baseline.blinkRatePerMin) / Math.max(baseline.blinkRatePerMin, 6), -1, 4);

  // 5. Expressions vs the resting mix.
  const exprDelta: Record<string, number> = {};
  for (const k of EXPR_KEYS) {
    const xs: number[] = [];
    for (const f of good) {
      const x = f.expr?.[k];
      if (typeof x === 'number') xs.push(x);
    }
    if (xs.length) exprDelta[k] = mean(xs) - (baseline.expr[k] ?? 0);
  }

  // 6. Talking pauses breath reading (handled by the banker) and is itself a leak.
  const talking = good.filter((f) => f.talking === true).length / good.length >= 0.2;

  // 7. Pulse: last couple of seconds of the 12 s average vs baseline.
  let pulseDelta = 0;
  if (baseline.pulse !== null) {
    const tEnd = (good[good.length - 1] as SignalFrame).t;
    const ps = good.filter((f) => typeof f.pulse === 'number' && f.t >= tEnd - 2000).map((f) => f.pulse as number);
    if (ps.length) pulseDelta = mean(ps) - baseline.pulse;
  }

  return {
    breathCatchMs, shallowing, rateChange, blinkBurst, exprDelta, talking, pulseDelta, quality,
    windowMs, blinkCount, expectedBlinks,
    catchStartMs: c ? c.start - t0 : null, catchEndMs: c ? c.end - t0 : null, blinkAtMs,
  };
}
