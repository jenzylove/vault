/**
 * The live read: what the banker sees while the peek is still running. Every signal he reads feeds it,
 * through the same evidence() as his read at the end of the look: the breath hold from the first frame,
 * blinks and the face from half a second in, shallow breathing and breath pace from three seconds in
 * (they need a stretch of breathing before they mean anything). Each one counts in proportion to what he
 * has learned about THIS player, so a blink barely moves a fresh Fence and moves him a lot once blinking
 * is your tell. Pure: frames in, numbers out.
 */
import type { SignalFrame } from '../signals/types';
import type { Baseline, Box, PeekFeatures } from './types';
import { EXPR_KEYS } from './types';
import { SMOOTH_MS } from './baseline';
import { catchAllowance, extractFeatures, findCatch, MIN_QUALITY, type CatchSpan } from './features';
import { evidence, featureMask, PRIOR, readBanker, type BankerModel, type BankerView } from './banker';
import { clamp, flatSpans, isGood, mean, smoothByTime } from './dsp';
import { PEEK_MS } from './timing';

/** Something he noticed in the look, and how far it moved his read (log odds, + = toward empty). */
export interface LiveNotice {
  kind: 'blink' | 'smile' | 'face' | 'hold' | 'shallow' | 'pace' | 'talking';
  /** what the chip says */
  label: string;
  /** how much this signal moves his read right now, for this player (log odds) */
  lift: number;
}

export interface LiveRead {
  /** 0..1 how sure he is right now that you are looking at a trap. */
  alert: number;
  /** The hold he would count if the peek ended now (signal time), or null. */
  catchSpan: CatchSpan | null;
  /** How long the breath has been flat up to the newest sample, ms (0 while it moves). */
  holdingMs: number;
  /** What he is noticing right now (only signals this Fence can read). */
  notices: LiveNotice[];
  /** The look so far, as he reads it (what fed the alert). */
  partial: PeekFeatures;
}

const NEUTRAL: PeekFeatures = {
  breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1,
};
const NO_BOX: Box = { id: -1, kind: 'small', value: 0, state: 'peeked' };

/** Blinks and the face count from here on (ms into the look), fully a second later. */
export const LIVE_FACE_FROM_MS = 500;
/** Shallow breathing and breath pace count from here on, fully 1.5 s later. */
export const LIVE_BREATH_FROM_MS = 3000;
/** A chip stays up this long after what it shows (ms). */
const NOTICE_MS = 1100;

/** His suspicion before he has seen anything: the board odds and his heat. */
export function restingAlert(model: BankerModel, view: BankerView): number {
  return readBanker(model, NEUTRAL, NO_BOX, view).pTrap;
}

const ramp = (x: number, from: number, span: number): number => clamp((x - from) / span, 0, 1);

/** Mean of an expression over these frames, against the calm. */
function exprOver(frames: readonly SignalFrame[], baseline: Baseline): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of EXPR_KEYS) {
    const xs: number[] = [];
    for (const f of frames) { const x = f.expr?.[k]; if (typeof x === 'number') xs.push(x); }
    if (xs.length) out[k] = mean(xs) - (baseline.expr[k] ?? 0);
  }
  return out;
}

export function liveRead(frames: readonly SignalFrame[], baseline: Baseline, model: BankerModel, view: BankerView, peekMs: number = baseline.peekMs ?? PEEK_MS): LiveRead {
  const rest = restingAlert(model, view);
  const chest = frames.filter((f) => isGood(f) && typeof f.chest === 'number');
  if (chest.length < 10) return { alert: rest, catchSpan: null, holdingMs: 0, notices: [], partial: NEUTRAL };
  const good = frames.filter(isGood);
  const t = chest.map((f) => f.t);
  const v = chest.map((f) => f.chest as number);
  const sm = smoothByTime(t, v, SMOOTH_MS);
  const c = findCatch(t, sm, baseline);
  const t0 = (frames[0] as SignalFrame).t;
  const tEnd = Math.max(t[t.length - 1] as number, (good[good.length - 1] ?? chest[chest.length - 1] as SignalFrame).t);
  const elapsed = tEnd - t0;
  const last = flatSpans(t, sm, baseline.flatTol, baseline.driftPerMs).find((f) => tEnd - f.end < 120);
  const holdingMs = last ? last.end - last.start : 0;
  const talking = chest.filter((f) => f.talking === true).length / chest.length >= 0.2;

  // the look so far, signal by signal, each held back until it means something
  const partial: PeekFeatures = { ...NEUTRAL, exprDelta: {}, breathCatchMs: c ? c.ms : 0, talking };
  const rFace = ramp(elapsed, LIVE_FACE_FROM_MS, 1000);
  const onsets: number[] = [];
  let prev = false;
  for (const f of good) { const b = f.blink === true; if (b && !prev) onsets.push(f.t); prev = b; }
  if (rFace > 0) {
    // blinks so far, plus the calm rate for the rest of the look: a burst shows early, a stare only late
    const rate = baseline.blinkRatePerMin;
    const remain = Math.max(0, peekMs - elapsed) / 60000;
    const projected = onsets.length + rate * remain;
    const burst = clamp((projected / (Math.max(peekMs, elapsed) / 60000) - rate) / Math.max(rate, 6), -1, 4);
    partial.blinkBurst = burst * rFace;
    const ex = exprOver(good, baseline);
    for (const [k, x] of Object.entries(ex)) partial.exprDelta[k] = x * rFace;
  }
  const rBreath = ramp(elapsed, LIVE_BREATH_FROM_MS, 1500);
  let full: PeekFeatures | null = null;
  if (rBreath > 0) {
    full = extractFeatures(frames, { ...baseline, peekMs: Math.min(peekMs, elapsed) });
    if (full.quality >= MIN_QUALITY) {
      partial.shallowing = full.shallowing * rBreath;
      partial.rateChange = full.rateChange * rBreath;
    } else full = null;
  }

  const p = readBanker(model, partial, NO_BOX, view).pTrap;
  let alert = p;
  // a pause growing toward his limit: he leans in before he is sure
  const limit = catchAllowance(Math.max(baseline.pauseLowMs, baseline.pauseHighMs));
  if (holdingMs > 0) {
    const r = clamp(holdingMs / limit, 0, 1);
    alert = Math.max(alert, rest + (0.8 - rest) * r * r);
  }
  // he never buys a box he saw you catch your breath at
  if (c && !talking) alert = Math.max(alert, 0.92);

  // what he is noticing right now, with how far each moves him (against a calm look)
  const mask = featureMask(model.level);
  const ev = evidence(model, partial);
  const ev0 = evidence(model, NEUTRAL);
  const lift = (i: number): number => PRIOR.shrink * ((ev[i] as number) - (ev0[i] as number));
  const notices: LiveNotice[] = [];
  const recent = good.filter((f) => tEnd - f.t <= 1000);
  if (mask[0] && !talking && (c || holdingMs > 0.5 * limit)) notices.push({ kind: 'hold', label: 'breath held', lift: Math.max(lift(0), c ? 1.5 : 0.6) });
  if (talking && mask[0]) notices.push({ kind: 'talking', label: 'talking', lift: PRIOR.talkingLogOdds });
  if (mask[3] && rFace > 0 && onsets.some((at) => tEnd - at <= NOTICE_MS)) notices.push({ kind: 'blink', label: 'blink', lift: lift(3) });
  if (rFace > 0 && recent.length > 3) {
    const ex = exprOver(recent, baseline);
    if (mask[4] && (ex.happy ?? 0) > 0.06) notices.push({ kind: 'smile', label: 'smile', lift: lift(4) });
    if (mask[5] && (ex.surprise ?? 0) + (ex.fear ?? 0) + (ex.disgust ?? 0) > 0.08) notices.push({ kind: 'face', label: 'face jump', lift: lift(5) });
  }
  if (full && !talking) {
    if (mask[1] && full.shallowing > 0.25) notices.push({ kind: 'shallow', label: 'shallow breaths', lift: lift(1) });
    if (mask[2] && Math.abs(full.rateChange) > 0.35) notices.push({ kind: 'pace', label: full.rateChange < 0 ? 'breath slowed' : 'breath sped up', lift: lift(2) });
  }
  return { alert: clamp(alert, 0, 1), catchSpan: c, holdingMs, notices, partial };
}
