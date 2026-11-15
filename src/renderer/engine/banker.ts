import type { BankerRead, BankerSignal, Box, BoxKind, PeekFeatures } from './types';
import { MIN_QUALITY } from './features';
import { clamp } from './dsp';

/**
 * The banker: a per player Gaussian naive Bayes (trap vs treasure) over standardized features,
 * seeded from priors and updated by every labelled example (2 practice peeks, every box the
 * player sells or opens, burned boxes at the final reveal). Shared (pooled) variance per feature
 * means a signal earns weight only when THIS player's traps and treasures separate on it.
 */

export const FEATURE_NAMES = ['breath', 'shallow', 'rate', 'blinks', 'joy', 'alarm'] as const;
type FeatureName = (typeof FEATURE_NAMES)[number];
const GROUP: Record<FeatureName, BankerSignal> = {
  breath: 'breath', shallow: 'breath', rate: 'breath', blinks: 'blinks', joy: 'face', alarm: 'face',
};

/** Priors: breath separates traps strongly, the face only weakly (faces can be trained). */
export const PRIOR = {
  trap: [1.2, 0.18, 0.3, 0.6, 0.0, 0.05],
  treasure: [0.05, 0.02, 0.12, 0.3, 0.03, 0.0],
  sd: [0.55, 0.2, 0.25, 0.5, 0.1, 0.1],
  pseudo: 2,           // prior counts per class
  shrink: 0.75,        // correlated features (breath trio) are not independent: damp the sum
  capPerFeature: 4,    // no single feature can swing the log odds by more than this
  talkingLogOdds: 0.6, // talking in a peek is itself a leak
} as const;

/** Rules for what the banker does with its belief. Heat and its own track record move them. */
export const BANKER_RULES = {
  walkAt: 0.6,         // walk when P(trap) reaches this at zero heat
  walkHeatSlope: 0.2,  // ...and this much lower at full heat
  walkFloor: 0.3,
  marginBase: 0.2,
  marginHeat: 0.2,     // full heat adds 20 points of margin
  marginDoubt: 0.15,    // a banker that has been wrong widens its margin
  unreadDiscount: 0.5, // unread boxes get a blind, discounted offer
  minOffer: 20,
} as const;

export interface Example { x: number[]; kind: BoxKind; unread: boolean; joy: number; }
export interface BankerModel { examples: Example[]; }

/** What the banker can see of the game: its own heat, track record and the value board. */
export interface BankerView {
  heat: number;
  correct: number;        // calls known to be right
  calls: number;          // calls with a known answer
  trapsBought: number;
  board: { kind: BoxKind | null; value: number }[]; // kind known only for revealed boxes; null = unknown
  boxesTotal: { small: number[]; big: number[]; trap: number };
}

export function featureVector(f: PeekFeatures): number[] {
  const e = f.exprDelta;
  const breathOk = !f.talking;
  return [
    breathOk ? f.breathCatchMs / 1000 : 0,
    breathOk ? Math.max(0, f.shallowing) : 0,
    breathOk ? Math.min(1.5, Math.abs(f.rateChange)) : 0,
    Math.min(3, Math.abs(f.blinkBurst)),
    e.happy ?? 0,
    (e.surprise ?? 0) + (e.fear ?? 0) + (e.disgust ?? 0),
  ];
}

export function emptyModel(): BankerModel { return { examples: [] }; }

export function learnExample(model: BankerModel, f: PeekFeatures, kind: BoxKind): BankerModel {
  const unread = f.quality < MIN_QUALITY;
  return { examples: [...model.examples, { x: featureVector(f), kind, unread, joy: f.exprDelta.happy ?? 0 }] };
}

interface Stats { muTrap: number[]; muTreasure: number[]; sd: number[]; }

export function modelStats(model: BankerModel): Stats {
  const k = PRIOR.pseudo;
  const read = model.examples.filter((e) => !e.unread);
  const traps = read.filter((e) => e.kind === 'trap');
  const treas = read.filter((e) => e.kind !== 'trap');
  const mu = (prior: readonly number[], xs: Example[]): number[] =>
    prior.map((p, i) => (k * p + xs.reduce((s, e) => s + (e.x[i] as number), 0)) / (k + xs.length));
  const muTrap = mu(PRIOR.trap, traps);
  const muTreasure = mu(PRIOR.treasure, treas);
  const sd = PRIOR.sd.map((s0, i) => {
    let ss = 2 * k * s0 * s0;
    for (const e of traps) ss += ((e.x[i] as number) - (muTrap[i] as number)) ** 2;
    for (const e of treas) ss += ((e.x[i] as number) - (muTreasure[i] as number)) ** 2;
    return Math.max(0.35 * s0, Math.sqrt(ss / (2 * k + read.length)));
  });
  return { muTrap, muTreasure, sd };
}

/** Per feature log likelihood ratio (trap over treasure). Positive = looks like a trap. */
export function evidence(model: BankerModel, f: PeekFeatures): number[] {
  const s = modelStats(model);
  const x = featureVector(f);
  return x.map((xi, i) => {
    const sd = s.sd[i] as number;
    const a = (xi - (s.muTrap[i] as number)) / sd;
    const b = (xi - (s.muTreasure[i] as number)) / sd;
    return clamp(-0.5 * a * a + 0.5 * b * b, -PRIOR.capPerFeature, PRIOR.capPerFeature);
  });
}

/** How much each signal group separates traps from treasure for this player right now. */
export function signalWeights(model: BankerModel): Record<'breath' | 'blinks' | 'face', number> {
  const s = modelStats(model);
  const sep = (i: number): number => Math.abs((s.muTrap[i] as number) - (s.muTreasure[i] as number)) / (s.sd[i] as number);
  return { breath: Math.max(sep(0), sep(1), sep(2)), blinks: sep(3), face: Math.max(sep(4), sep(5)) };
}

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** The banker's prior from the value board: traps not yet accounted for / boxes not yet revealed. */
export function boardPriors(view: BankerView): { pTrap: number; pBigGivenTreasure: number; smallMean: number; bigMean: number } {
  const known = view.board.filter((b) => b.kind !== null);
  const unknown = view.board.length - known.length;
  const trapsLeft = view.boxesTotal.trap - known.filter((b) => b.kind === 'trap').length;
  const smallLeft = view.boxesTotal.small.slice();
  const bigLeft = view.boxesTotal.big.slice();
  for (const b of known) {
    const arr = b.kind === 'small' ? smallLeft : b.kind === 'big' ? bigLeft : null;
    if (!arr) continue;
    const i = arr.indexOf(b.value);
    if (i >= 0) arr.splice(i, 1);
  }
  const avg = (a: number[], d: number): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : d);
  const treasureLeft = smallLeft.length + bigLeft.length;
  return {
    pTrap: clamp(unknown > 0 ? trapsLeft / unknown : 0.3, 0.02, 0.98),
    pBigGivenTreasure: clamp(treasureLeft > 0 ? bigLeft.length / treasureLeft : 0, 0.01, 0.99),
    smallMean: avg(smallLeft, 200),
    bigMean: avg(bigLeft, 1200),
  };
}

export function bankerConfidence(view: BankerView): number {
  return (view.correct + 1.4) / (view.calls + 2); // starts at 0.7
}

export function walkThreshold(heat: number): number {
  return Math.max(BANKER_RULES.walkFloor, BANKER_RULES.walkAt - BANKER_RULES.walkHeatSlope * heat);
}

export function margin(view: BankerView): number {
  return BANKER_RULES.marginBase + BANKER_RULES.marginHeat * view.heat + BANKER_RULES.marginDoubt * (1 - bankerConfidence(view));
}

const round10 = (x: number): number => Math.max(0, Math.round(x / 10) * 10);
const secs = (ms: number): string => (ms / 1000).toFixed(1);
const pct = (x: number): number => Math.round(Math.abs(x) * 100);

function walkReason(f: PeekFeatures, driver: FeatureName | null, view: BankerView): string {
  if (f.talking && (driver === null || GROUP[driver] === 'breath')) return 'Trap. You started talking the moment you looked.';
  switch (driver) {
    case 'breath': return `Trap. Your breath stopped for ${secs(f.breathCatchMs)} seconds.`;
    case 'shallow': return `Trap. Your breathing went ${pct(f.shallowing)}% shallower.`;
    case 'rate': return f.rateChange <= -0.99
      ? 'Trap. You did not take a single breath.'
      : `Trap. Your breathing ${f.rateChange > 0 ? 'sped up' : 'slowed'} by ${pct(f.rateChange)}%.`;
    case 'blinks': {
      const secsW = Math.round((f.windowMs ?? 8000) / 1000);
      if (f.blinkBurst < 0) return `Trap. You stopped blinking for ${secsW} seconds.`;
      return `Trap. You blinked ${f.blinkCount ?? 0} times in ${secsW} seconds. You usually blink ${Math.round(f.expectedBlinks ?? 0)}.`;
    }
    case 'joy': return (f.exprDelta.happy ?? 0) > 0
      ? 'Trap. You smiled, and you smiled the same way at your last trap.'
      : 'Trap. Your smile dropped the moment you looked.';
    case 'alarm': return `Trap. Your face jumped: surprise up ${pct((f.exprDelta.surprise ?? 0) + (f.exprDelta.fear ?? 0))} points.`;
    default: return view.trapsBought > 0
      ? `Not worth it. I have bought ${view.trapsBought} trap${view.trapsBought > 1 ? 's' : ''} from you already.`
      : 'Trap. Something changed when you looked. I am walking.';
  }
}

function offerReason(f: PeekFeatures, pTrap: number, pBig: number, offer: number, ev: number[], walkAt: number): string {
  const smiled = (f.exprDelta.happy ?? 0) > 0.06;
  const calmBreath = f.breathCatchMs === 0 && Math.abs(f.rateChange) < 0.3 && f.shallowing < 0.2;
  if (smiled && calmBreath && pBig < 0.5) return `Big one? You smiled, but your breathing didn't change. I'm not sure. I'll pay ${offer}.`;
  if (pBig >= 0.5) return `Big one. ${smiled ? 'That smile was real.' : 'Your breathing picked up.'} I'll pay ${offer}.`;
  if (pTrap > walkAt * 0.75) {
    const worst = ev.indexOf(Math.max(...ev));
    const name = FEATURE_NAMES[worst] ?? 'breath';
    const what = GROUP[name] === 'breath' ? 'your breathing' : GROUP[name] === 'blinks' ? 'your blinking' : 'your face';
    return `Close call. Something in ${what} moved. I'll risk ${offer}.`;
  }
  if (f.breathCatchMs === 0) return `Treasure, I think. Your breath stayed even. I'll pay ${offer}.`;
  return `Treasure, I think. I'll pay ${offer}.`;
}

/** Pure read. Decides walk, offer or unread, prices it, and says why in one plain sentence. */
export function readBanker(model: BankerModel, f: PeekFeatures, _box: Box, view: BankerView): BankerRead {
  const pri = boardPriors(view);
  const m = margin(view);
  const walkAt = walkThreshold(view.heat);

  if (f.quality < MIN_QUALITY) {
    // Unread: blind offer from what unread boxes have turned out to be for this player.
    const ur = model.examples.filter((e) => e.unread);
    const urTraps = ur.filter((e) => e.kind === 'trap').length;
    const pTrap = clamp((urTraps + PRIOR.pseudo * pri.pTrap) / (ur.length + PRIOR.pseudo), 0.02, 0.98);
    const evT = pri.pBigGivenTreasure * pri.bigMean + (1 - pri.pBigGivenTreasure) * pri.smallMean;
    const offer = round10((1 - pTrap) * evT * (1 - m) * BANKER_RULES.unreadDiscount);
    return { pTrap, pBig: pri.pBigGivenTreasure, decision: 'unread', offer, reason: `I lost you. I can't read this one, so I'll only pay ${offer}.`, signal: 'none' };
  }

  const ev = evidence(model, f);
  let z = logit(pri.pTrap) + PRIOR.shrink * ev.reduce((s, x) => s + x, 0);
  if (f.talking) z += PRIOR.talkingLogOdds;
  const pTrap = sigmoid(z);

  // P(big | treasure): board prior nudged by the smile, learned from this player's revealed treasures.
  const treas = model.examples.filter((e) => e.kind !== 'trap' && !e.unread);
  const k = PRIOR.pseudo;
  const bigs = treas.filter((e) => e.kind === 'big');
  const smalls = treas.filter((e) => e.kind === 'small');
  const muBig = (k * 0.1 + bigs.reduce((s, e) => s + e.joy, 0)) / (k + bigs.length);
  const muSmall = (k * 0.02 + smalls.reduce((s, e) => s + e.joy, 0)) / (k + smalls.length);
  const joy = f.exprDelta.happy ?? 0;
  const sdJ = 0.1;
  let lj = clamp((-((joy - muBig) ** 2) + (joy - muSmall) ** 2) / (2 * sdJ * sdJ), -2, 2);
  // A smile that looks like this player's trap smile is not evidence of a big one.
  if ((ev[4] as number) > 0) lj = Math.min(lj, 0);
  const pBig = sigmoid(logit(pri.pBigGivenTreasure) + 0.7 * lj);

  const evTreasure = pBig * pri.bigMean + (1 - pBig) * pri.smallMean;
  const offer = round10((1 - pTrap) * evTreasure * (1 - m));

  if (pTrap >= walkAt || offer < BANKER_RULES.minOffer) {
    let best = -Infinity;
    let driver: FeatureName | null = null;
    ev.forEach((x, i) => { if (x > best) { best = x; driver = FEATURE_NAMES[i] ?? null; } });
    if (best < 0.7) driver = null; // no single signal carried it: heat or the board did
    const d = driver as FeatureName | null;
    return { pTrap, pBig, decision: 'walk', reason: walkReason(f, d, view), signal: d ? GROUP[d] : 'none' };
  }
  // the signal that most supported "treasure"
  let best = Infinity;
  let calmDriver: FeatureName | null = null;
  ev.forEach((x, i) => { if (x < best) { best = x; calmDriver = FEATURE_NAMES[i] ?? null; } });
  const cd = calmDriver as FeatureName | null;
  return { pTrap, pBig, decision: 'offer', offer, reason: offerReason(f, pTrap, pBig, offer, ev, walkAt), signal: cd && best < -0.5 ? GROUP[cd] : 'none' };
}
