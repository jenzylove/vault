import type { Baseline, BankerRead, Box, BoxKind, PeekFeatures } from './types';
import {
  emptyModel, finalRead, learnExample, readBanker, type BankerModel, type BankerView, type FinalRead,
} from './banker';
import { MIN_QUALITY } from './features';
import { createRng } from './rng';
import { DEFAULT_LEVEL, levelConfig, type LevelNo } from './levels';
import { FINAL, pickLine, type LinePick } from './lines';

/** Fixed value table: 5 small, 2 big, 3 traps. Shown on the board. A run peeks 5 of these 10. */
export const VALUE_TABLE = {
  small: [100, 150, 200, 250, 300],
  big: [900, 1500],
  trap: [0, 0, 0],
} as const;

/** Push your luck rules. Every number here moves an outcome. */
export const RULES = {
  boxesPerRun: 5,          // a run: you peek 5 of the 10 boxes, then everything is revealed
  heatPerTrapBought: 0.5,  // his suspicion: a dud his audit finds makes him warier (it never busts you; strikes do)
  heatPerPeek: 0,          // peeking itself is free
  heatUnread: 0.2,         // "I lost you" makes him suspicious
  pulseHeatMax: 0.15,      // rising pulse (12 s average) adds slow suspicion
  pulseHeatPerBpm: 1 / 60,
  strikesPerDudFound: 1,   // a dud you sold him that his audit finds is a strike
  bustKeep: 0,             // MAX_STRIKES strikes: the alarm goes off and you leave with nothing
  heistBonus: 1,           // a trap you sold pays its price again when the audit finds it: you robbed the banker
                           // (not on a blind offer: he paid blind, so there was nothing to rob)
} as const;

/** Two strikes and you are busted: the alarm goes off and the take goes to 0. */
export const MAX_STRIKES = 2;

/** How long his offer stands before it runs out (the ticking offer). */
export const OFFER_WINDOW_MS = 5000;
/** Share of the offer still standing when the window closes. */
export const OFFER_FLOOR = 0.6;

/** The ticking offer: full at 0 ms, falls linearly to 60% at OFFER_WINDOW_MS, rounded down to 10. */
export function offerAt(offer: number, elapsedMs: number): number {
  const e = Number.isNaN(elapsedMs) ? 0 : elapsedMs;
  const t = Math.min(1, Math.max(0, e / OFFER_WINDOW_MS));
  const x = Math.max(0, offer) * (1 - (1 - OFFER_FLOOR) * t);
  return Math.floor(x / 10 + 1e-9) * 10;
}

/** Per job rules on top of the Fence's level. Defaults reproduce the standard 5 safe run of that level. */
export interface RunRules {
  /** safes you crack this run */
  safes: number;
  /** take at least this for a clean job */
  target: number;
  /** duds he may catch (pass on) and still call it a clean job */
  maxTrapsCaught: number;
  maxBurned: number;
  /** a dud you dump on a real offer pays this many times the normal heist pay */
  dudPayX: number;
  /** suspicion added when he passes on a dud you looked at (he caught you); 0 in most jobs */
  caughtDudHeat: number;
  /** Double Cross: a dud he catches you at is a strike */
  caughtDudStrike: boolean;
}

export function defaultRules(level: LevelNo = DEFAULT_LEVEL): RunRules {
  const cfg = levelConfig(level);
  return {
    safes: RULES.boxesPerRun, target: cfg.target, maxTrapsCaught: cfg.maxTrapsCaught, maxBurned: cfg.maxBurned,
    dudPayX: 1, caughtDudHeat: 0, caughtDudStrike: false,
  };
}

export type Phase =
  | 'begin' | 'baseline' | 'practice' | 'board' | 'peek' | 'bankerRead' | 'audit'
  | 'finalChoice' | 'finalCall' | 'reveal' | 'over';

/** The last safe, double or nothing: his call, whether it was right, and the take before and after. */
export interface FinalCall {
  /** none: the camera lost you, so the bet is off and your take stays */
  call: 'loot' | 'dud' | 'none';
  /** his call matches what was inside (then you lose the take) */
  right: boolean;
  before: number;
  /** right ? 0 : before * 2 */
  after: number;
  /** what he says when he calls it (also in state.read.reason) */
  line?: string;
  /** what he saw in your body, with the number (on screen) */
  why?: string;
}

export interface BoxOutcome {
  boxId: number;
  kind: BoxKind;
  value: number;
  decision: BankerRead['decision'];
  /** his offer when he made it (null when he passed, and on the final bet) */
  offer: number | null;
  /** what he actually paid on a sale (the ticking offer when you took it), else null */
  paid: number | null;
  pTrap: number;
  result: 'sold' | 'opened' | 'burned';
  heatAdded: number;
  /** Was the banker's call right? walk = trap expected, offer/unread = treasure expected. null until known. */
  correct: boolean | null;
  /** Summary numbers of the peek, kept for the tell sheet. */
  features: PeekFeatures;
  /** this safe cost you a strike (a dud he found after buying it, or a Double Cross catch) */
  strike: boolean;
  /** strikes after this safe settled */
  strikes: number;
  /** his offer ran out before you took it (resolved like 'opened') */
  expired: boolean;
  /** the last safe, played double or nothing (its contents never add to the take) */
  final: boolean;
}

export interface Scoreboard {
  pile: number;
  trapsSold: number;
  treasuresBurned: number;
  treasuresSold: number;
  treasuresOpened: number;
  bankerCorrect: number;
  bankerCalls: number;
  bankerAccuracy: number;
  /** Accuracy a banker with the same walk rate but no read of you would expect on these boxes. */
  chanceAccuracy: number;
  busted: boolean;
  left: boolean;
  level: LevelNo;
  rank: string;
  /** Traps the banker walked away from (he read you). */
  trapsCaught: number;
  /** Beat this banker: pile >= target before the alarm goes off. */
  won: boolean;
  target: number;
  maxTrapsCaught: number;
  maxBurned: number;
  /** strikes at the end (MAX_STRIKES means busted) */
  strikes: number;
  maxStrikes: number;
  /** played the last safe double or nothing */
  finalBet: boolean;
  finalCall: FinalCall | null;
}

export interface GameState {
  seed: number;
  phase: Phase;
  boxes: Box[];
  practice: { kind: BoxKind }[];
  practiceLog: { kind: BoxKind; features: PeekFeatures }[];
  level: LevelNo;
  rules: RunRules;
  baseline: Baseline | null;
  model: BankerModel;
  activeBoxId: number | null;
  read: BankerRead | null;
  features: PeekFeatures | null;
  pile: number;
  /** his suspicion: lowers his offers and makes him quicker to pass. It never busts you. */
  heat: number;
  heatParts: { traps: number; peeks: number; pulse: number; unread: number };
  trapsBought: number;
  log: BoxOutcome[];
  lastOutcome: BoxOutcome | null;
  busted: boolean;
  left: boolean;
  score: Scoreboard | null;
  /** duds he discovered you sold him, plus Double Cross catches; MAX_STRIKES = busted */
  strikes: number;
  /** the player chose double or nothing on the last safe */
  finalBet: boolean;
  /** his call on the last safe (set in phase 'finalCall', kept to the end) */
  finalCall: FinalCall | null;
}

export type GameAction =
  | { type: 'begin' }
  | { type: 'baselineDone'; baseline: Baseline }
  | { type: 'practiceDone'; peeks: { features: PeekFeatures; kind: BoxKind }[] }
  | { type: 'choose'; boxId: number }
  | { type: 'peekDone'; features: PeekFeatures }
  /** take his offer; the price paid is offerAt(read.offer, elapsedMs ?? 0) */
  | { type: 'sell'; elapsedMs?: number }
  | { type: 'open' }
  /** the offer ran out before you took it: same as 'open' (you keep what is inside) */
  | { type: 'expire' }
  | { type: 'next' }
  /** walk out with the take (from 'board', 'audit' or 'finalChoice') */
  | { type: 'leave' }
  /** from 'finalChoice': play the last safe double or nothing */
  | { type: 'finalBet' }
  | { type: 'reveal' };

export function newGame(seed: number, level: LevelNo = DEFAULT_LEVEL, rules: Partial<RunRules> = {}): GameState {
  const r = createRng(seed);
  const items: { kind: BoxKind; value: number }[] = [
    ...VALUE_TABLE.small.map((value) => ({ kind: 'small' as const, value })),
    ...VALUE_TABLE.big.map((value) => ({ kind: 'big' as const, value })),
    ...VALUE_TABLE.trap.map((value) => ({ kind: 'trap' as const, value })),
  ];
  const boxes: Box[] = r.shuffle(items).map((it, id) => ({ id, kind: it.kind, value: it.value, state: 'sealed' }));
  const practice: { kind: BoxKind }[] = r.chance(0.5) ? [{ kind: 'small' }, { kind: 'trap' }] : [{ kind: 'trap' }, { kind: 'small' }];
  return {
    seed, phase: 'begin', boxes, practice, practiceLog: [], level, rules: { ...defaultRules(level), ...rules }, baseline: null, model: emptyModel(level), activeBoxId: null, read: null,
    features: null, pile: 0, heat: 0, heatParts: { traps: 0, peeks: 0, pulse: 0, unread: 0 }, trapsBought: 0,
    log: [], lastOutcome: null, busted: false, left: false, score: null, strikes: 0, finalBet: false, finalCall: null,
  };
}

/** Boxes you may still peek this run. */
export function runLeft(s: GameState): number {
  const sealed = s.boxes.filter((b) => b.state === 'sealed').length;
  return Math.max(0, Math.min(sealed, s.rules.safes - s.log.length));
}

function sumHeat(p: GameState['heatParts']): number {
  return Math.min(1, p.traps + p.peeks + p.pulse + p.unread);
}

/** The seeded line pick for the safe being read now. */
export function linePick(s: GameState): LinePick {
  return { seed: s.seed, turn: s.log.length };
}

/** What the banker knows: its heat, its record, and which boxes have been revealed. */
export function bankerView(s: GameState): BankerView {
  const known = s.log.filter((o) => o.correct !== null);
  return {
    heat: s.heat,
    correct: known.filter((o) => o.correct).length,
    calls: known.length,
    trapsBought: s.trapsBought,
    board: s.boxes.map((b) => ({
      kind: b.state === 'sold' || b.state === 'opened' ? b.kind : null,
      value: b.value,
    })),
    boxesTotal: { small: [...VALUE_TABLE.small], big: [...VALUE_TABLE.big], trap: VALUE_TABLE.trap.length },
    lines: linePick(s),
  };
}

function callCorrect(decision: BankerRead['decision'], kind: BoxKind): boolean {
  return decision === 'walk' ? kind === 'trap' : kind !== 'trap';
}

function setBox(boxes: Box[], id: number, state: Box['state']): Box[] {
  return boxes.map((b) => (b.id === id ? { ...b, state } : b));
}

/** After a box is settled: strike check (MAX_STRIKES busts you), then audit phase. */
function settle(s: GameState, outcome: BoxOutcome): GameState {
  const log = [...s.log, outcome];
  let next: GameState = { ...s, log, lastOutcome: outcome, phase: 'audit', activeBoxId: null };
  if (next.strikes >= MAX_STRIKES) {
    next = { ...next, busted: true, pile: Math.floor((next.pile * RULES.bustKeep) / 10) * 10, phase: 'reveal' };
  }
  return next;
}

/** What he says when he calls the last safe. */
export function finalCallLine(fr: FinalRead, f: PeekFeatures, pick: LinePick | null | undefined): string {
  if (fr.call === 'none') return pickLine(FINAL.none, pick, 'final.none');
  if (fr.call === 'dud') {
    return f.breathCatchMs > 0 ? pickLine(FINAL.dudBreath, pick, 'final.dudBreath') : pickLine(FINAL.dud, pick, 'final.dud');
  }
  return pickLine(FINAL.loot, pick, 'final.loot');
}

/** What he says when the last safe is opened: right (your take is gone) or wrong (it doubles). */
export function finalResultLine(fc: FinalCall, pick: LinePick | null | undefined): string {
  return fc.right ? pickLine(FINAL.right, pick, 'final.right') : pickLine(FINAL.wrong, pick, 'final.wrong');
}

export function computeScore(s: GameState): Scoreboard {
  const cfg = levelConfig(s.level);
  const rules = s.rules;
  // Caught = he walked from the trap, or he lost you at it (hiding is a tell too).
  // On the final bet: caught = he called it a dud.
  const trapsCaught = s.log.filter((o) => o.kind === 'trap' && (o.final ? o.decision === 'walk' : o.result === 'burned' || o.decision === 'unread')).length;
  const treasuresBurned = s.log.filter((o) => o.kind !== 'trap' && o.result === 'burned').length;
  const known = s.log.filter((o) => o.correct !== null);
  const correct = known.filter((o) => o.correct).length;
  const walks = known.filter((o) => o.decision === 'walk').length;
  const traps = known.filter((o) => o.kind === 'trap').length;
  const n = known.length;
  const pw = n ? walks / n : 0;
  const pt = n ? traps / n : 0;
  return {
    pile: s.pile,
    trapsSold: s.log.filter((o) => o.kind === 'trap' && o.result === 'sold').length,
    treasuresBurned,
    treasuresSold: s.log.filter((o) => o.kind !== 'trap' && o.result === 'sold').length,
    treasuresOpened: s.log.filter((o) => o.kind !== 'trap' && o.result === 'opened' && !o.final).length,
    bankerCorrect: correct,
    bankerCalls: n,
    bankerAccuracy: n ? correct / n : 0,
    chanceAccuracy: pw * pt + (1 - pw) * (1 - pt),
    busted: s.busted,
    left: s.left,
    level: s.level,
    rank: cfg.rank,
    trapsCaught,
    // one rule on screen: reach the target before the alarm (strikes are the only catch limit)
    won: !s.busted && s.pile >= rules.target,
    target: rules.target,
    maxTrapsCaught: rules.maxTrapsCaught,
    maxBurned: rules.maxBurned,
    strikes: s.strikes,
    maxStrikes: MAX_STRIKES,
    finalBet: s.finalBet,
    finalCall: s.finalCall,
  };
}

/** Extra pay when the audit finds a dud he bought on a real offer (on top of the price paid). */
export function heistPay(offer: number, rules: RunRules): number {
  return Math.round(offer * RULES.heistBonus * rules.dudPayX + offer * (rules.dudPayX - 1));
}

/** Pure reducer. Invalid actions for the current phase return the state unchanged. */
export function step(s: GameState, a: GameAction): GameState {
  switch (a.type) {
    case 'begin':
      return s.phase === 'begin' ? { ...s, phase: 'baseline' } : s;

    case 'baselineDone':
      return s.phase === 'baseline' ? { ...s, baseline: a.baseline, phase: 'practice' } : s;

    case 'practiceDone': {
      if (s.phase !== 'practice') return s;
      let model = s.model;
      for (const p of a.peeks) model = learnExample(model, p.features, p.kind);
      return { ...s, model, practiceLog: a.peeks.map((p) => ({ kind: p.kind, features: p.features })), phase: 'board' };
    }

    case 'choose': {
      if (s.phase !== 'board' || runLeft(s) === 0) return s;
      const box = s.boxes.find((b) => b.id === a.boxId);
      if (!box || box.state !== 'sealed') return s;
      return { ...s, boxes: setBox(s.boxes, box.id, 'peeked'), activeBoxId: box.id, phase: 'peek', read: null, features: null };
    }

    case 'peekDone': {
      if (s.phase !== 'peek' || s.activeBoxId === null) return s;
      const box = s.boxes.find((b) => b.id === s.activeBoxId) as Box;
      const f = a.features;
      const unread = f.quality < MIN_QUALITY;
      const pulseTarget = !levelConfig(s.level).signals.pulseHeat ? 0 : Math.min(RULES.pulseHeatMax, Math.max(0, f.pulseDelta) * RULES.pulseHeatPerBpm);
      const heatParts = {
        ...s.heatParts,
        peeks: s.heatParts.peeks + RULES.heatPerPeek,
        pulse: 0.6 * s.heatParts.pulse + 0.4 * pulseTarget,
        unread: s.heatParts.unread + (unread ? RULES.heatUnread : 0),
      };
      const heated: GameState = { ...s, heatParts, heat: sumHeat(heatParts), features: f };
      const read = readBanker(s.model, f, box, bankerView(heated));

      if (s.finalBet) {
        // Double or nothing: no offer. He calls it, and the next 'next' settles the take.
        const pick = linePick(s);
        // his call is your body alone (finalRead), never the board's odds; no read means no bet
        const fr = finalRead(s.model, f);
        const call = fr.call;
        const right = call !== 'none' && (call === 'dud') === (box.kind === 'trap');
        const line = finalCallLine(fr, f, pick);
        const after = call === 'none' ? s.pile : right ? 0 : s.pile * 2;
        const finalCall: FinalCall = { call, right, before: s.pile, after, line, why: fr.why };
        const decision: BankerRead['decision'] = call === 'dud' ? 'walk' : call === 'loot' ? 'offer' : 'unread';
        const outcome: BoxOutcome = {
          boxId: box.id, kind: box.kind, value: box.value, decision, offer: null, paid: null, pTrap: read.pTrap,
          result: 'opened', heatAdded: heated.heat - s.heat, correct: decision === 'unread' ? null : callCorrect(decision, box.kind), features: f,
          strike: false, strikes: s.strikes, expired: false, final: true,
        };
        return {
          ...heated,
          read: { ...read, decision, offer: undefined, reason: line },
          boxes: setBox(heated.boxes, box.id, 'opened'),
          model: learnExample(s.model, f, box.kind),
          log: [...s.log, outcome],
          lastOutcome: outcome,
          finalCall,
          phase: 'finalCall',
          activeBoxId: null,
        };
      }

      if (read.decision === 'walk') {
        // Double Cross: a dud he catches you at is a strike (and makes him warier)
        const caughtDud = box.kind === 'trap';
        const strike = caughtDud && s.rules.caughtDudStrike;
        const caughtParts = caughtDud && s.rules.caughtDudHeat > 0 ? { ...heatParts, traps: heatParts.traps + s.rules.caughtDudHeat } : heatParts;
        const burned: GameState = {
          ...heated, heatParts: caughtParts, heat: sumHeat(caughtParts), read, boxes: setBox(heated.boxes, box.id, 'burned'),
          strikes: s.strikes + (strike ? 1 : 0),
        };
        return settle(burned, {
          boxId: box.id, kind: box.kind, value: box.value, decision: 'walk', offer: null, paid: null, pTrap: read.pTrap,
          result: 'burned', heatAdded: burned.heat - s.heat, correct: null, features: f, // unknown until the reveal
          strike, strikes: burned.strikes, expired: false, final: false,
        });
      }
      return { ...heated, read, phase: 'bankerRead' };
    }

    case 'sell':
    case 'open':
    case 'expire': {
      if (s.phase !== 'bankerRead' || s.activeBoxId === null || !s.read || !s.features) return s;
      const box = s.boxes.find((b) => b.id === s.activeBoxId) as Box;
      const sold = a.type === 'sell';
      const offer = s.read.offer ?? 0;
      const paid = a.type === 'sell' ? offerAt(offer, a.elapsedMs ?? 0) : null;
      const trapFound = sold && box.kind === 'trap';
      const heist = trapFound && s.read.decision === 'offer';
      const heatParts = { ...s.heatParts, traps: s.heatParts.traps + (trapFound ? RULES.heatPerTrapBought : 0) };
      const heat = sumHeat(heatParts);
      const next: GameState = {
        ...s,
        boxes: setBox(s.boxes, box.id, sold ? 'sold' : 'opened'),
        pile: s.pile + (paid !== null ? paid : box.value) + (heist && paid !== null ? heistPay(paid, s.rules) : 0),
        heatParts, heat,
        trapsBought: s.trapsBought + (trapFound ? 1 : 0),
        strikes: s.strikes + (trapFound ? RULES.strikesPerDudFound : 0),
        model: learnExample(s.model, s.features, box.kind), // the audit: the banker sees what was inside
      };
      return settle(next, {
        boxId: box.id, kind: box.kind, value: box.value, decision: s.read.decision, offer, paid, pTrap: s.read.pTrap,
        result: sold ? 'sold' : 'opened', heatAdded: heat - s.heat, features: s.features,
        correct: callCorrect(s.read.decision, box.kind),
        strike: trapFound, strikes: next.strikes, expired: a.type === 'expire', final: false,
      });
    }

    case 'next': {
      if (s.phase === 'finalCall') {
        if (!s.finalCall) return s;
        return { ...s, pile: s.finalCall.after, phase: 'reveal', read: null, features: null };
      }
      if (s.phase !== 'audit') return s;
      const left = runLeft(s);
      const phase: Phase = left === 0 ? 'reveal' : left === 1 && s.pile > 0 && !s.finalBet ? 'finalChoice' : 'board';
      return { ...s, phase, read: null, features: null };
    }

    case 'finalBet':
      if (s.phase !== 'finalChoice') return s;
      return { ...s, finalBet: true, phase: 'board' };

    case 'leave':
      // once you bet the last safe, you play it
      if (s.phase !== 'audit' && s.phase !== 'board' && s.phase !== 'finalChoice') return s;
      if (s.phase === 'board' && s.finalBet) return s;
      return { ...s, left: true, phase: 'reveal', read: null, features: null };

    case 'reveal': {
      if (s.phase !== 'reveal') return s;
      // Burned boxes are revealed: the banker's walks are now scored.
      const log = s.log.map((o) => (o.correct === null ? { ...o, correct: callCorrect(o.decision, o.kind) } : o));
      const done: GameState = { ...s, log, phase: 'over' };
      return { ...done, score: computeScore(done) };
    }
  }
}

/** Stateful banker matching the SPEC contract; the reducer itself uses the pure functions. */
export interface Banker {
  learn(features: PeekFeatures, kind: BoxKind): void;
  read(features: PeekFeatures, box: Box, game: GameState): BankerRead;
  heat: number;
  readonly model: BankerModel;
  readonly baseline: Baseline;
}

export function createBanker(baseline: Baseline, opts?: { seed?: number; level?: LevelNo }): Banker {
  let model = emptyModel(opts?.level ?? DEFAULT_LEVEL);
  const b: Banker = {
    heat: 0,
    baseline,
    get model() { return model; },
    learn(features, kind) { model = learnExample(model, features, kind); },
    read(features, box, game) {
      b.heat = game.heat;
      return readBanker(model, features, box, bankerView(game));
    },
  };
  return b;
}
