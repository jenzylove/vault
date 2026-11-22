import type { BankerRead, BankerSignal, Box, BoxKind, PeekFeatures } from './types';
import { MIN_QUALITY } from './features';
import { clamp } from './dsp';
import { DEFAULT_LEVEL, levelConfig, type LevelNo } from './levels';
import { PEEK_MS } from './timing';
import { OFFER, UNREAD, WALK, pickLine, type LinePick } from './lines';

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
  // The smile prior is the same for both: a smile says nothing until this player's own boxes show it does.
  trap: [1.2, 0.18, 0.3, 0.6, 0.02, 0.05],
  treasure: [0.05, 0.02, 0.12, 0.3, 0.02, 0.0],
  sd: [0.55, 0.2, 0.25, 0.5, 0.1, 0.1],
  pseudo: 2,           // prior counts per class (blinks, face, unread)
  breathPseudo: 6,     // breath priors are held harder: a catch stays suspicious even if you catch everywhere
  shrink: 0.75,        // correlated features (breath trio) are not independent: damp the sum
  capPerFeature: 4,    // no single feature can swing the log odds by more than this
  talkingLogOdds: 0.6, // talking in a peek is itself a leak
} as const;

/** Rules for what the banker does with its belief. Heat and its own track record move them. */
export const BANKER_RULES = {
  // walkAt and marginBase are per banker: see levels.ts
  walkHeatSlope: 0.2,  // the walk threshold drops this much at full heat
  walkFloor: 0.3,
  marginHeat: 0.05,    // full heat adds 5 points of margin
  marginDoubt: 0.05,   // a banker that has been wrong widens its margin
  unreadDiscount: 0.5, // unread boxes get a blind, discounted offer
  minOffer: 20,
  walkOnCatch: true,   // it never buys a box you caught your breath at: a catch faked at treasure just burns it
} as const;

export interface Example { x: number[]; kind: BoxKind; unread: boolean; joy: number; }
export interface BankerModel { examples: Example[]; level: LevelNo; }

/** What the banker can see of the game: its own heat, track record and the value board. */
export interface BankerView {
  heat: number;
  correct: number;        // calls known to be right
  calls: number;          // calls with a known answer
  trapsBought: number;
  board: { kind: BoxKind | null; value: number }[]; // kind known only for revealed boxes; null = unknown
  boxesTotal: { small: number[]; big: number[]; trap: number };
  /** seeded pick for his spoken line (the game's seed and turn); absent = the first line of each bank */
  lines?: LinePick;
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

export function emptyModel(level: LevelNo = DEFAULT_LEVEL): BankerModel { return { examples: [], level }; }

export function learnExample(model: BankerModel, f: PeekFeatures, kind: BoxKind): BankerModel {
  const unread = f.quality < MIN_QUALITY;
  return { ...model, examples: [...model.examples, { x: featureVector(f), kind, unread, joy: f.exprDelta.happy ?? 0 }] };
}

interface Stats { muTrap: number[]; muTreasure: number[]; sd: number[]; }

export function modelStats(model: BankerModel): Stats {
  // A faster learner counts each labelled box for more against its priors.
  const w = levelConfig(model.level).learnWeight;
  const kOf = (i: number): number => (i < 3 ? PRIOR.breathPseudo : PRIOR.pseudo);
  const read = model.examples.filter((e) => !e.unread);
  const traps = read.filter((e) => e.kind === 'trap');
  const treas = read.filter((e) => e.kind !== 'trap');
  const mu = (prior: readonly number[], xs: Example[]): number[] =>
    prior.map((p, i) => (kOf(i) * p + w * xs.reduce((s, e) => s + (e.x[i] as number), 0)) / (kOf(i) + w * xs.length));
  const muTrap = mu(PRIOR.trap, traps);
  const muTreasure = mu(PRIOR.treasure, treas);
  const sd = PRIOR.sd.map((s0, i) => {
    const k = kOf(i);
    let ss = 2 * k * s0 * s0;
    for (const e of traps) ss += w * ((e.x[i] as number) - (muTrap[i] as number)) ** 2;
    for (const e of treas) ss += w * ((e.x[i] as number) - (muTreasure[i] as number)) ** 2;
    return Math.max(0.35 * s0, Math.sqrt(ss / (2 * k + w * read.length)));
  });
  return { muTrap, muTreasure, sd };
}

/** Which features this banker is allowed to read (the ladder). */
export function featureMask(level: LevelNo): boolean[] {
  const sig = levelConfig(level).signals;
  return FEATURE_NAMES.map((n) => {
    const g = GROUP[n];
    return g === 'breath' ? sig.breath : g === 'blinks' ? sig.blinks : sig.face;
  });
}

/** Per feature log likelihood ratio (trap over treasure). Positive = looks like a trap. 0 for signals this banker can't read. */
export function evidence(model: BankerModel, f: PeekFeatures): number[] {
  const s = modelStats(model);
  const x = featureVector(f);
  const mask = featureMask(model.level);
  return x.map((x0, i) => {
    if (!mask[i]) return 0;
    const sd = s.sd[i] as number;
    // An exaggerated face counts no more than a typical one: the smile is clipped to one spread
    // beyond the class means, so a put on grin cannot outweigh the breath.
    const lo = Math.min(s.muTrap[i] as number, s.muTreasure[i] as number) - sd;
    const hi = Math.max(s.muTrap[i] as number, s.muTreasure[i] as number) + sd;
    const xi = i === 4 ? clamp(x0, lo, hi) : x0;
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

export function walkThreshold(heat: number, level: LevelNo = DEFAULT_LEVEL): number {
  return Math.max(BANKER_RULES.walkFloor, levelConfig(level).walkAt - BANKER_RULES.walkHeatSlope * heat);
}

export function margin(view: BankerView, level: LevelNo = DEFAULT_LEVEL): number {
  return levelConfig(level).marginBase + BANKER_RULES.marginHeat * view.heat + BANKER_RULES.marginDoubt * (1 - bankerConfidence(view));
}

const round10 = (x: number): number => Math.max(0, Math.round(x / 10) * 10);
const secs = (ms: number): string => (ms / 1000).toFixed(1);
const pct = (x: number): number => Math.round(Math.abs(x) * 100);

function walkReason(f: PeekFeatures, driver: FeatureName | null, view: BankerView): string {
  const pick = view.lines;
  if (f.talking && (driver === null || GROUP[driver] === 'breath')) return pickLine(WALK.talking, pick, 'walk.talking');
  switch (driver) {
    case 'breath': return pickLine(WALK.breath(secs(f.breathCatchMs)), pick, 'walk.breath');
    case 'shallow': return pickLine(WALK.shallow(pct(f.shallowing)), pick, 'walk.shallow');
    case 'rate': return f.rateChange <= -0.99
      ? pickLine(WALK.noBreath, pick, 'walk.noBreath')
      : pickLine(WALK.rate(f.rateChange > 0 ? 'sped up' : 'slowed', pct(f.rateChange)), pick, 'walk.rate');
    case 'blinks': {
      const secsW = Math.round((f.windowMs ?? PEEK_MS) / 1000);
      if (f.blinkBurst < 0) return pickLine(WALK.blinkStop(secsW), pick, 'walk.blinkStop');
      return pickLine(WALK.blinkBurst(f.blinkCount ?? 0, secsW, Math.round(f.expectedBlinks ?? 0)), pick, 'walk.blinkBurst');
    }
    case 'joy': return (f.exprDelta.happy ?? 0) > 0
      ? pickLine(WALK.smile, pick, 'walk.smile')
      : pickLine(WALK.smileDrop, pick, 'walk.smileDrop');
    case 'alarm': return pickLine(WALK.alarm(pct((f.exprDelta.surprise ?? 0) + (f.exprDelta.fear ?? 0))), pick, 'walk.alarm');
    default: return view.trapsBought > 0
      ? pickLine(WALK.sold(view.trapsBought === 1 ? 'an empty safe' : `${view.trapsBought} empty safes`), pick, 'walk.sold')
      : pickLine(WALK.vague, pick, 'walk.vague');
  }
}

function offerReason(f: PeekFeatures, pTrap: number, pBig: number, offer: number, ev: number[], walkAt: number, face: boolean, pick: LinePick | undefined): string {
  const smiled = face && (f.exprDelta.happy ?? 0) > 0.06;
  const calmBreath = f.breathCatchMs === 0 && Math.abs(f.rateChange) < 0.3 && f.shallowing < 0.2;
  if (smiled && calmBreath && pBig < 0.5) return pickLine(OFFER.smileCalm(offer), pick, 'offer.smileCalm');
  if (pBig >= 0.5) return smiled ? pickLine(OFFER.bigSmile(offer), pick, 'offer.bigSmile') : pickLine(OFFER.big(offer), pick, 'offer.big');
  if (pTrap > walkAt * 0.75) {
    const worst = ev.indexOf(Math.max(...ev));
    const name = FEATURE_NAMES[worst] ?? 'breath';
    const what = GROUP[name] === 'breath' ? 'your breathing' : GROUP[name] === 'blinks' ? 'your blinking' : 'your face';
    return pickLine(OFFER.close(what, offer), pick, 'offer.close');
  }
  if (f.breathCatchMs === 0) return pickLine(OFFER.calm(offer), pick, 'offer.calm');
  return pickLine(OFFER.plain(offer), pick, 'offer.plain');
}

export interface FinalRead {
  /** none = he could not see you, so there is no bet */
  call: 'loot' | 'dud' | 'none';
  /** what he saw, in one plain sentence with the measured number (shown on screen, not spoken) */
  why: string;
}

const one = (ms: number): string => (ms / 1000).toFixed(1);
const pc = (x: number): number => Math.round(Math.abs(x) * 100);

/**
 * The last safe, double or nothing: his call from your body alone. The board's odds (most safes are
 * full) play no part, so a player he cannot read is a coin toss for him, never a sure win.
 */
export function finalRead(model: BankerModel, f: PeekFeatures): FinalRead {
  if (f.quality < MIN_QUALITY) return { call: 'none', why: 'The camera lost you during the look, so he had nothing to read.' };
  const mask = featureMask(model.level);
  if (mask[0] && !f.talking && f.breathCatchMs > 0) {
    return { call: 'dud', why: `Your breath stopped for ${one(f.breathCatchMs)} seconds when the door opened.` };
  }
  const ev = evidence(model, f);
  const z = PRIOR.shrink * ev.reduce((a, x) => a + x, 0) + (f.talking ? PRIOR.talkingLogOdds : 0);
  const call: FinalRead['call'] = z > 0 ? 'dud' : 'loot';
  if (Math.abs(z) < 0.25) {
    return { call, why: 'Your body gave him almost nothing on this one. He went with a hunch.' };
  }
  if (call === 'dud') {
    if (f.talking) return { call, why: 'You talked while you looked inside.' };
    const i = ev.indexOf(Math.max(...ev));
    const name = FEATURE_NAMES[i] ?? 'breath';
    const why = name === 'shallow' ? `Your breathing went ${pc(f.shallowing)} percent shallower than your calm.`
      : name === 'rate' ? `Your breathing ${f.rateChange > 0 ? 'sped up' : 'slowed'} by ${pc(f.rateChange)} percent.`
      : name === 'blinks' ? (f.blinkBurst < 0 ? 'You stopped blinking while you looked.' : `You blinked ${f.blinkCount ?? 'more'} times, more than your calm.`)
      : name === 'joy' ? 'You smiled the way you smile at empty safes.'
      : name === 'alarm' ? 'Your face jumped when the door opened.'
      : 'Your breathing changed when the door opened.';
    return { call, why };
  }
  const i = ev.indexOf(Math.min(...ev));
  const g = GROUP[FEATURE_NAMES[i] ?? 'breath'];
  const why = g === 'blinks' ? 'Your blinking stayed like your calm, the way it does at full safes.'
    : g === 'face' ? 'Your face looked the way it does at full safes.'
    : 'Your breathing stayed even, the way it does at full safes.';
  return { call, why };
}

/** Pure read. Decides walk, offer or unread, prices it, and says why in one plain sentence. */
export function readBanker(model: BankerModel, f: PeekFeatures, _box: Box, view: BankerView): BankerRead {
  const pri = boardPriors(view);
  const m = margin(view, model.level);
  const walkAt = walkThreshold(view.heat, model.level);
  const face = levelConfig(model.level).signals.face;

  if (f.quality < MIN_QUALITY) {
    // Unread: blind offer from what unread boxes have turned out to be for this player.
    const ur = model.examples.filter((e) => e.unread);
    const urTraps = ur.filter((e) => e.kind === 'trap').length;
    const pTrap = clamp((urTraps + PRIOR.pseudo * pri.pTrap) / (ur.length + PRIOR.pseudo), 0.02, 0.98);
    const evT = pri.pBigGivenTreasure * pri.bigMean + (1 - pri.pBigGivenTreasure) * pri.smallMean;
    const offer = round10((1 - pTrap) * evT * (1 - m) * BANKER_RULES.unreadDiscount);
    return { pTrap, pBig: pri.pBigGivenTreasure, decision: 'unread', offer, reason: pickLine(UNREAD(offer), view.lines, 'unread'), signal: 'none', driver: null, lines: view.lines };
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
  // Uninformative prior: the face says nothing about big vs small until this player's own
  // revealed treasures show a difference.
  const muBig = (k * 0.03 + bigs.reduce((s, e) => s + e.joy, 0)) / (k + bigs.length);
  const muSmall = (k * 0.03 + smalls.reduce((s, e) => s + e.joy, 0)) / (k + smalls.length);
  const sdJ = 0.05;
  // a put on grin counts no more than the biggest smile this player has shown at a real treasure
  const joy = clamp(f.exprDelta.happy ?? 0, Math.min(muBig, muSmall) - sdJ, Math.max(muBig, muSmall));
  let lj = clamp((-((joy - muBig) ** 2) + (joy - muSmall) ** 2) / (2 * sdJ * sdJ), -3, 3);
  // A smile that looks like this player's trap smile is not evidence of a big one.
  if ((ev[4] as number) > 0) lj = Math.min(lj, 0);
  if (!face) lj = 0; // a banker who can't read faces can't read a big one either
  const pBig = sigmoid(logit(pri.pBigGivenTreasure) + lj);

  const evTreasure = pBig * pri.bigMean + (1 - pBig) * pri.smallMean;
  // If it buys at all, it pays what it thinks a treasure is worth, minus its margin.
  const offer = round10(evTreasure * (1 - m));

  const caught = BANKER_RULES.walkOnCatch && !f.talking && f.breathCatchMs > 0 && featureMask(model.level)[0] === true;
  if (caught || pTrap >= walkAt || offer < BANKER_RULES.minOffer) {
    let best = -Infinity;
    let driver: FeatureName | null = null;
    ev.forEach((x, i) => { if (x > best) { best = x; driver = FEATURE_NAMES[i] ?? null; } });
    if (best < 0.7) driver = null; // no single signal carried it: heat or the board did
    if (caught) driver = 'breath';
    const d = driver as FeatureName | null;
    return { pTrap, pBig, decision: 'walk', reason: walkReason(f, d, view), signal: d ? GROUP[d] : 'none', driver: d, lines: view.lines };
  }
  // the signal that most supported "treasure"
  let best = Infinity;
  let calmDriver: FeatureName | null = null;
  ev.forEach((x, i) => { if (x < best) { best = x; calmDriver = FEATURE_NAMES[i] ?? null; } });
  const cd = calmDriver as FeatureName | null;
  return { pTrap, pBig, decision: 'offer', offer, reason: offerReason(f, pTrap, pBig, offer, ev, walkAt, face, view.lines), signal: cd && best < -0.5 ? GROUP[cd] : 'none', driver: null, lines: view.lines };
}
