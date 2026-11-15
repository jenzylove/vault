import type { Baseline, BankerRead, Box, BoxKind, PeekFeatures } from './types';
import {
  emptyModel, learnExample, readBanker, type BankerModel, type BankerView,
} from './banker';
import { MIN_QUALITY } from './features';
import { createRng } from './rng';
import { DEFAULT_LEVEL, levelConfig, type LevelNo } from './levels';

/** Fixed value table: 5 small, 2 big, 3 traps. Shown on the board. */
export const VALUE_TABLE = {
  small: [100, 150, 200, 250, 300],
  big: [900, 1500],
  trap: [0, 0, 0],
} as const;

/** Push your luck rules. Every number here is shown on screen and moves an outcome. */
export const RULES = {
  heatPerTrapBought: 0.34, // the banker audits a box it bought and finds a trap
  heatPerPeek: 0,          // peeking itself is free: heat comes from what the banker finds
  heatUnread: 0.1,         // "I lost you" makes it suspicious
  pulseHeatMax: 0.15,      // rising pulse (12 s average) adds slow heat
  pulseHeatPerBpm: 1 / 60,
  bustAt: 1,               // full heat: the banker throws you out...
  bustKeep: 0,             // ...and you leave with nothing
  heistBonus: 1,           // a trap you sold pays its price again when the audit finds it: you robbed the banker
} as const;

export type Phase = 'begin' | 'baseline' | 'practice' | 'board' | 'peek' | 'bankerRead' | 'audit' | 'reveal' | 'over';

export interface BoxOutcome {
  boxId: number;
  kind: BoxKind;
  value: number;
  decision: BankerRead['decision'];
  offer: number | null;
  pTrap: number;
  result: 'sold' | 'opened' | 'burned';
  heatAdded: number;
  /** Was the banker's call right? walk = trap expected, offer/unread = treasure expected. null until known. */
  correct: boolean | null;
  /** Summary numbers of the peek, kept for the tell sheet. */
  features: PeekFeatures;
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
  /** Beat this banker: pile >= target and he caught at most maxTrapsCaught of your traps. */
  won: boolean;
  target: number;
  maxTrapsCaught: number;
  maxBurned: number;
}

export interface GameState {
  seed: number;
  phase: Phase;
  boxes: Box[];
  practice: { kind: BoxKind }[];
  practiceLog: { kind: BoxKind; features: PeekFeatures }[];
  level: LevelNo;
  baseline: Baseline | null;
  model: BankerModel;
  activeBoxId: number | null;
  read: BankerRead | null;
  features: PeekFeatures | null;
  pile: number;
  heat: number;
  heatParts: { traps: number; peeks: number; pulse: number; unread: number };
  trapsBought: number;
  log: BoxOutcome[];
  lastOutcome: BoxOutcome | null;
  busted: boolean;
  left: boolean;
  score: Scoreboard | null;
}

export type GameAction =
  | { type: 'begin' }
  | { type: 'baselineDone'; baseline: Baseline }
  | { type: 'practiceDone'; peeks: { features: PeekFeatures; kind: BoxKind }[] }
  | { type: 'choose'; boxId: number }
  | { type: 'peekDone'; features: PeekFeatures }
  | { type: 'sell' }
  | { type: 'open' }
  | { type: 'next' }
  | { type: 'leave' }
  | { type: 'reveal' };

export function newGame(seed: number, level: LevelNo = DEFAULT_LEVEL): GameState {
  const r = createRng(seed);
  const items: { kind: BoxKind; value: number }[] = [
    ...VALUE_TABLE.small.map((value) => ({ kind: 'small' as const, value })),
    ...VALUE_TABLE.big.map((value) => ({ kind: 'big' as const, value })),
    ...VALUE_TABLE.trap.map((value) => ({ kind: 'trap' as const, value })),
  ];
  const boxes: Box[] = r.shuffle(items).map((it, id) => ({ id, kind: it.kind, value: it.value, state: 'sealed' }));
  const practice: { kind: BoxKind }[] = r.chance(0.5) ? [{ kind: 'small' }, { kind: 'trap' }] : [{ kind: 'trap' }, { kind: 'small' }];
  return {
    seed, phase: 'begin', boxes, practice, practiceLog: [], level, baseline: null, model: emptyModel(level), activeBoxId: null, read: null,
    features: null, pile: 0, heat: 0, heatParts: { traps: 0, peeks: 0, pulse: 0, unread: 0 }, trapsBought: 0,
    log: [], lastOutcome: null, busted: false, left: false, score: null,
  };
}

function sumHeat(p: GameState['heatParts']): number {
  return Math.min(1, p.traps + p.peeks + p.pulse + p.unread);
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
  };
}

function callCorrect(decision: BankerRead['decision'], kind: BoxKind): boolean {
  return decision === 'walk' ? kind === 'trap' : kind !== 'trap';
}

function setBox(boxes: Box[], id: number, state: Box['state']): Box[] {
  return boxes.map((b) => (b.id === id ? { ...b, state } : b));
}

/** After a box is settled: bust check, then audit phase. */
function settle(s: GameState, outcome: BoxOutcome): GameState {
  const log = [...s.log, outcome];
  let next: GameState = { ...s, log, lastOutcome: outcome, phase: 'audit', activeBoxId: null };
  if (next.heat >= RULES.bustAt) {
    next = { ...next, busted: true, pile: Math.floor((next.pile * RULES.bustKeep) / 10) * 10, phase: 'reveal' };
  }
  return next;
}

export function computeScore(s: GameState): Scoreboard {
  const cfg = levelConfig(s.level);
  // Caught = he walked from the trap, or he lost you at it (hiding is a tell too).
  const trapsCaught = s.log.filter((o) => o.kind === 'trap' && (o.result === 'burned' || o.decision === 'unread')).length;
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
    treasuresBurned: s.log.filter((o) => o.kind !== 'trap' && o.result === 'burned').length,
    treasuresSold: s.log.filter((o) => o.kind !== 'trap' && o.result === 'sold').length,
    treasuresOpened: s.log.filter((o) => o.kind !== 'trap' && o.result === 'opened').length,
    bankerCorrect: correct,
    bankerCalls: n,
    bankerAccuracy: n ? correct / n : 0,
    chanceAccuracy: pw * pt + (1 - pw) * (1 - pt),
    busted: s.busted,
    left: s.left,
    level: s.level,
    rank: cfg.rank,
    trapsCaught,
    won: !s.busted && s.pile >= cfg.target && trapsCaught <= cfg.maxTrapsCaught && treasuresBurned <= cfg.maxBurned,
    target: cfg.target,
    maxTrapsCaught: cfg.maxTrapsCaught,
    maxBurned: cfg.maxBurned,
  };
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
      if (s.phase !== 'board') return s;
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
      if (read.decision === 'walk') {
        const burned: GameState = { ...heated, read, boxes: setBox(heated.boxes, box.id, 'burned') };
        return settle(burned, {
          boxId: box.id, kind: box.kind, value: box.value, decision: 'walk', offer: null, pTrap: read.pTrap,
          result: 'burned', heatAdded: heated.heat - s.heat, correct: null, features: f, // unknown until the reveal
        });
      }
      return { ...heated, read, phase: 'bankerRead' };
    }

    case 'sell':
    case 'open': {
      if (s.phase !== 'bankerRead' || s.activeBoxId === null || !s.read || !s.features) return s;
      const box = s.boxes.find((b) => b.id === s.activeBoxId) as Box;
      const sold = a.type === 'sell';
      const offer = s.read.offer ?? 0;
      const trapFound = sold && box.kind === 'trap';
      const heatParts = { ...s.heatParts, traps: s.heatParts.traps + (trapFound ? RULES.heatPerTrapBought : 0) };
      const heat = sumHeat(heatParts);
      const next: GameState = {
        ...s,
        boxes: setBox(s.boxes, box.id, sold ? 'sold' : 'opened'),
        pile: s.pile + (sold ? offer : box.value) + (trapFound ? Math.round(offer * RULES.heistBonus) : 0),
        heatParts, heat,
        trapsBought: s.trapsBought + (trapFound ? 1 : 0),
        model: learnExample(s.model, s.features, box.kind), // the audit: the banker sees what was inside
      };
      return settle(next, {
        boxId: box.id, kind: box.kind, value: box.value, decision: s.read.decision, offer, pTrap: s.read.pTrap,
        result: sold ? 'sold' : 'opened', heatAdded: heat - s.heat, features: s.features,
        correct: callCorrect(s.read.decision, box.kind),
      });
    }

    case 'next': {
      if (s.phase !== 'audit') return s;
      const anySealed = s.boxes.some((b) => b.state === 'sealed');
      return { ...s, phase: anySealed ? 'board' : 'reveal', read: null, features: null };
    }

    case 'leave':
      if (s.phase !== 'audit' && s.phase !== 'board') return s;
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
