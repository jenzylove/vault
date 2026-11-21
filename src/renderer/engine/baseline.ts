import type { SignalFrame } from '../signals/types';
import type { Baseline } from './types';
import { EXPR_KEYS } from './types';
import {
  blinkOnsets, coveredMs, flatSpans, isGood, levelOf, linearDetrend, mean, median, percentile,
  smoothByTime, smoothedNoise, std, upCrossings,
} from './dsp';
import { PEEK_MS } from './timing';

export const SMOOTH_MS = 300;
/** Flat = the smoothed trace stays inside this share of the calm breath swing... */
export const FLAT_SHARE = 0.08;
/** ...or inside this many noise standard deviations, whichever is wider. */
export const FLAT_NOISE_K = 4;

/** Flat fragments shorter than this are slope pieces, not pauses. */
export const MIN_PAUSE_MS = 350;

/** Below this many pauses in the calm, the normal pause allowance gets head room. */
export const FEW_PAUSES = 6;
export const FEW_PAUSES_X = 1.2;
/** Blink rate prior (per minute) and how many seconds of calm it counts for: 10 s sees only two or three blinks. */
export const BLINK_PRIOR_PER_MIN = 15;
export const BLINK_PRIOR_MS = 20000;

export function flatTolerance(breathAmp: number, noiseSm: number): number {
  return Math.max(FLAT_SHARE * breathAmp, FLAT_NOISE_K * noiseSm);
}

function linearSlope(t: readonly number[], v: readonly number[]): number {
  const mt = mean(t);
  const mv = mean(v);
  let num = 0;
  let den = 0;
  for (let i = 0; i < t.length; i++) {
    num += ((t[i] as number) - mt) * ((v[i] as number) - mv);
    den += ((t[i] as number) - mt) ** 2;
  }
  return den > 0 ? num / den : 0;
}

/** p95 - p5 swing of a linearly detrended window: the same measure for baseline windows and peeks. */
export function windowSwing(t: readonly number[], sm: readonly number[]): number {
  const d = linearDetrend(t, sm);
  return percentile(d, 95) - percentile(d, 5);
}

/** Learn the calm. `peekMs` is how long this job's peeks last: the calm's comparison windows use the same length. */
export function learnBaseline(frames: readonly SignalFrame[], peekMs: number = PEEK_MS): Baseline {
  const good = frames.filter(isGood);
  const quality = frames.length ? good.length / frames.length : 0;
  const durationMs = coveredMs(good);
  const chest = good.filter((f) => typeof f.chest === 'number');
  const t = chest.map((f) => f.t);
  const v = chest.map((f) => f.chest as number);

  let breathPeriodMs = 4000;
  let breathAmp = 1;
  let windowAmp = 1;
  let pauseLowMs = 1400;
  let pauseHighMs = 900;
  let turnLowMs = 1000;
  let turnHighMs = 600;
  let flatTol = 0.12;
  let driftPerMs = 0;
  let noise = 0;

  if (chest.length >= 20) {
    const sm = smoothByTime(t, v, SMOOTH_MS);
    const slow = smoothByTime(t, sm, 6000);
    const dt = sm.map((x, i) => x - (slow[i] as number));
    const rough = Math.max(1e-9, percentile(dt, 95) - percentile(dt, 5));
    const ups = upCrossings(t, dt, 0, 0.12 * rough);
    const intervals: number[] = [];
    for (let i = 1; i < ups.length; i++) {
      const d = (ups[i] as number) - (ups[i - 1] as number);
      if (d >= 1500 && d <= 15000) intervals.push(d);
    }
    if (intervals.length) breathPeriodMs = median(intervals);
    const amps: number[] = [];
    for (let i = 1; i < ups.length; i++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < t.length; k++) {
        const tk = t[k] as number;
        if (tk < (ups[i - 1] as number) || tk > (ups[i] as number)) continue;
        const x = sm[k] as number;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (hi > lo) amps.push(hi - lo);
    }
    breathAmp = amps.length ? median(amps) : rough;

    const swings: number[] = [];
    const driftSlopes: number[] = [];
    const t0 = t[0] as number;
    const tEnd = t[t.length - 1] as number;
    // windows as long as a peek, so a peek's swing is compared with like for like
    for (let w = t0; w + peekMs <= tEnd + 1; w += 1000) {
      const idx: number[] = [];
      for (let k = 0; k < t.length; k++) if ((t[k] as number) >= w && (t[k] as number) < w + peekMs) idx.push(k);
      if (idx.length > 10) {
        const wt = idx.map((k) => t[k] as number);
        const wv = idx.map((k) => sm[k] as number);
        swings.push(windowSwing(wt, wv));
        driftSlopes.push(Math.abs(linearSlope(wt, wv)));
      }
    }
    windowAmp = swings.length ? median(swings) : rough;

    const resid = std(v.map((x, i) => x - (sm[i] as number)));
    noise = resid / breathAmp;
    const meanDt = (t[t.length - 1]! - t[0]!) / Math.max(1, t.length - 1);
    flatTol = flatTolerance(breathAmp, smoothedNoise(resid, meanDt, SMOOTH_MS));
    driftPerMs = driftSlopes.length ? median(driftSlopes) : 0;
    const flats = flatSpans(t, sm, flatTol, driftPerMs).filter((f) => f.end - f.start >= MIN_PAUSE_MS);
    const lows: number[] = [];
    const highs: number[] = [];
    for (const f of flats) {
      const lv = levelOf(f, t, sm, 0.75 * breathPeriodMs, breathAmp);
      if (lv.ambiguous) continue;
      (lv.level >= 0.5 ? highs : lows).push(f.end - f.start);
    }
    // A 10 s calm holds only two or three pauses, so the longest of them understates how long a
    // normal pause can run (they vary about 20% breath to breath). With few samples, allow 20% over the median.
    const longest = (xs: number[]): number => (xs.length >= FEW_PAUSES ? percentile(xs, 90) : Math.max(percentile(xs, 90), FEW_PAUSES_X * median(xs)));
    pauseLowMs = lows.length ? longest(lows) : 0.35 * breathPeriodMs;
    pauseHighMs = highs.length ? longest(highs) : 0.2 * breathPeriodMs;
    turnLowMs = lows.length ? median(lows) : 0.3 * breathPeriodMs;
    turnHighMs = highs.length ? median(highs) : 0.15 * breathPeriodMs;
  }

  const minutes = Math.max(durationMs, 1) / 60000;
  // shrink toward a typical rate: a short calm sees too few blinks to trust alone
  const blinkRatePerMin = durationMs > 0
    ? (blinkOnsets(good) + (BLINK_PRIOR_PER_MIN * BLINK_PRIOR_MS) / 60000) / (minutes + BLINK_PRIOR_MS / 60000)
    : BLINK_PRIOR_PER_MIN;

  const expr: Record<string, number> = {};
  for (const k of EXPR_KEYS) {
    const xs: number[] = [];
    for (const f of good) {
      const x = f.expr?.[k];
      if (typeof x === 'number') xs.push(x);
    }
    if (xs.length) expr[k] = mean(xs);
  }
  const pulses = good.filter((f) => typeof f.pulse === 'number').map((f) => f.pulse as number);

  return {
    breathPeriodMs,
    breathRatePerMin: 60000 / breathPeriodMs,
    breathAmp,
    windowAmp,
    flatTol,
    driftPerMs,
    pauseLowMs,
    pauseHighMs,
    turnLowMs,
    turnHighMs,
    blinkRatePerMin,
    expr,
    pulse: pulses.length ? mean(pulses) : null,
    noise,
    quality,
    durationMs,
    peekMs,
  };
}
