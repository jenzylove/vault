import type { SignalFrame } from '../signals/types';

/** A sample is usable only when the SDK is confident and the face is stable. */
export function isGood(f: SignalFrame): boolean {
  return f.conf >= 0.5 && f.stable;
}

export function mean(a: readonly number[]): number {
  if (a.length === 0) return 0;
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

export function std(a: readonly number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return Math.sqrt(s / (a.length - 1));
}

export function percentile(a: readonly number[], p: number): number {
  if (a.length === 0) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const idx = (s.length - 1) * Math.min(1, Math.max(0, p / 100));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const vlo = s[lo] as number;
  const vhi = s[hi] as number;
  return vlo + (vhi - vlo) * (idx - lo);
}

export function median(a: readonly number[]): number {
  return percentile(a, 50);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Centered moving average over a time window (rate agnostic, handles uneven sampling). */
export function smoothByTime(t: readonly number[], v: readonly number[], winMs: number): number[] {
  const n = t.length;
  const out = new Array<number>(n);
  const half = winMs / 2;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[i] as number;
    while (hi < n && (t[hi] as number) <= ti + half) sum += v[hi++] as number;
    while ((t[lo] as number) < ti - half) sum -= v[lo++] as number;
    out[i] = sum / Math.max(1, hi - lo);
  }
  return out;
}

/** Slope (units per ms) from the samples half a window either side. */
export function slopeByTime(t: readonly number[], v: readonly number[], halfMs: number): number[] {
  const n = t.length;
  const out = new Array<number>(n).fill(0);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[i] as number;
    while ((t[lo] as number) < ti - halfMs) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && (t[hi + 1] as number) <= ti + halfMs) hi++;
    const dt = (t[hi] as number) - (t[lo] as number);
    out[i] = dt > 0 ? ((v[hi] as number) - (v[lo] as number)) / dt : 0;
  }
  return out;
}

export function linearDetrend(t: readonly number[], v: readonly number[]): number[] {
  const n = t.length;
  if (n < 2) return v.map(() => 0);
  const mt = mean(t);
  const mv = mean(v);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dt = (t[i] as number) - mt;
    num += dt * ((v[i] as number) - mv);
    den += dt * dt;
  }
  const b = den > 0 ? num / den : 0;
  return v.map((x, i) => x - mv - b * ((t[i] as number) - mt));
}

export interface FlatSeg {
  start: number;
  end: number;
  i0: number;
  i1: number;
  mean: number;
}

/**
 * Flat stretches: spans where the smoothed trace stays inside a band of width
 * tol + driftPerMs * duration (slow baseline drift is allowed, breathing is not).
 * Range based, not slope based, so sensor noise cannot split a held breath into pieces.
 * Longest spans are claimed first, so a hold is never cut in two by where a scan started.
 * Breaks at sampling gaps longer than maxGapMs.
 */
export function flatSpans(
  t: readonly number[],
  sm: readonly number[],
  tol: number,
  driftPerMs = 0,
  minMs = 150,
  maxGapMs = 300,
): FlatSeg[] {
  const n = t.length;
  const ends = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let lo = sm[i] as number;
    let hi = lo;
    let j = i;
    while (j + 1 < n) {
      const x = sm[j + 1] as number;
      if ((t[j + 1] as number) - (t[j] as number) > maxGapMs) break;
      const nlo = x < lo ? x : lo;
      const nhi = x > hi ? x : hi;
      if (nhi - nlo > tol + driftPerMs * ((t[j + 1] as number) - (t[i] as number))) break;
      lo = nlo;
      hi = nhi;
      j++;
    }
    ends[i] = j;
  }
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((i) => (t[ends[i] as number] as number) - (t[i] as number) >= minMs)
    .sort((a, b) => ((t[ends[b] as number] as number) - (t[b] as number)) - ((t[ends[a] as number] as number) - (t[a] as number)));
  const claimed = new Uint8Array(n);
  const out: FlatSeg[] = [];
  for (const i of order) {
    let j = ends[i] as number;
    if (claimed[i]) continue;
    // trim the end back to the first claimed sample, if any
    for (let k = i; k <= j; k++) if (claimed[k]) { j = k - 1; break; }
    if ((t[j] as number) - (t[i] as number) < minMs) continue;
    let sum = 0;
    for (let k = i; k <= j; k++) { claimed[k] = 1; sum += sm[k] as number; }
    out.push({ start: t[i] as number, end: t[j] as number, i0: i, i1: j, mean: sum / (j - i + 1) });
  }
  out.sort((a, b) => a.start - b.start);
  // Merge touching spans at the same level (a hold cut by its own onset ramp or a noise spike).
  const merged: FlatSeg[] = [];
  for (const f of out) {
    const last = merged[merged.length - 1];
    if (last && f.i0 === last.i1 + 1 && Math.abs(f.mean - last.mean) <= tol) {
      const n1 = last.i1 - last.i0 + 1;
      const n2 = f.i1 - f.i0 + 1;
      merged[merged.length - 1] = { start: last.start, end: f.end, i0: last.i0, i1: f.i1, mean: (last.mean * n1 + f.mean * n2) / (n1 + n2) };
    } else merged.push(f);
  }
  return merged;
}

/** Noise left after smoothing, for a raw residual std and the average sample spacing. */
export function smoothedNoise(residualStd: number, meanDtMs: number, smoothMs: number): number {
  return residualStd * Math.sqrt(Math.min(1, meanDtMs / smoothMs));
}

/**
 * Where a flat run sits inside the local breath swing: 1 = top (just inhaled), 0 = bottom
 * (end of exhale, where a normal pause lives). Ambiguous when there is no swing around it.
 */
export function levelOf(
  seg: FlatSeg,
  t: readonly number[],
  sm: readonly number[],
  halfWinMs: number,
  ampRef: number,
): { level: number; ambiguous: boolean } {
  const mid = (seg.start + seg.end) / 2;
  const reach = Math.max(halfWinMs, (seg.end - seg.start) / 2 + halfWinMs * 0.6);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < t.length; i++) {
    const ti = t[i] as number;
    if (ti < mid - reach || ti > mid + reach) continue;
    const x = sm[i] as number;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const range = hi - lo;
  if (!(range > 0.35 * ampRef)) return { level: 0.5, ambiguous: true };
  return { level: clamp((seg.mean - lo) / range, 0, 1), ambiguous: false };
}

/** Times where v rises through mid (with hysteresis). */
export function upCrossings(t: readonly number[], v: readonly number[], mid: number, hyst: number): number[] {
  const out: number[] = [];
  let armed = false;
  for (let i = 0; i < t.length; i++) {
    const x = v[i] as number;
    if (x < mid - hyst) armed = true;
    else if (armed && x > mid + hyst) {
      out.push(t[i] as number);
      armed = false;
    }
  }
  return out;
}

/** Count blink onsets (false to true edges). */
export function blinkOnsets(frames: readonly SignalFrame[]): number {
  let n = 0;
  let prev = false;
  for (const f of frames) {
    const b = f.blink === true;
    if (b && !prev) n++;
    prev = b;
  }
  return n;
}

/** Time actually covered by frames, ignoring gaps longer than maxGapMs. */
export function coveredMs(frames: readonly SignalFrame[], maxGapMs = 500): number {
  let ms = 0;
  for (let i = 1; i < frames.length; i++) {
    const dt = (frames[i] as SignalFrame).t - (frames[i - 1] as SignalFrame).t;
    if (dt > 0 && dt <= maxGapMs) ms += dt;
  }
  return ms;
}
