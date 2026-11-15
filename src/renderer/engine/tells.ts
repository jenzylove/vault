/**
 * Tell sheet: after a game, the banker shows you your own tells with real numbers, and a history
 * tracks them across games so you can watch them shrink. Only summary numbers are stored.
 */
import type { BoxKind, PeekFeatures } from './types';
import { MIN_QUALITY } from './features';
import { computeScore, type GameState } from './game';
import { LEVELS, type LevelNo } from './levels';

export type TellKey = 'breath' | 'shallow' | 'rate' | 'blinks' | 'smile' | 'surprise' | 'fear' | 'pulse';
export const TELL_KEYS: readonly TellKey[] = ['breath', 'shallow', 'rate', 'blinks', 'smile', 'surprise', 'fear', 'pulse'];

export interface Tell {
  key: TellKey;
  label: string;
  trap: number;        // mean at traps (display units)
  treasure: number;    // mean at treasure (display units)
  unit: string;
  effect: number;      // standardized difference, traps minus treasure (Cohen's d with a floor on the spread)
  strength: number;    // |effect|
  sentence: string;
  nTrap: number;
  nTreasure: number;
}

export interface TellSheet {
  level: LevelNo;
  rank: string;
  pile: number;
  won: boolean;
  bankerCorrect: number;
  bankerCalls: number;
  readLine: string;
  tells: Tell[];            // strongest first
  biggest: Tell | null;     // the signal that gave you away most (null if nothing did)
  headline: string;
}

interface Spec { label: string; unit: string; floor: number; get: (f: PeekFeatures) => number; fmt: (x: number) => string; line: (t: string, r: string) => string; }

const signed = (x: number): string => `${x >= 0 ? '+' : ''}${Math.round(x)}`;
const SPECS: Record<TellKey, Spec> = {
  breath: { label: 'Breath catch', unit: 's', floor: 0.25, get: (f) => f.breathCatchMs / 1000, fmt: (x) => x.toFixed(1),
    line: (t, r) => `At traps your breath stopped for ${t} s on average; at treasure ${r} s.` },
  shallow: { label: 'Shallow breathing', unit: '%', floor: 8, get: (f) => 100 * f.shallowing, fmt: (x) => String(Math.round(x)),
    line: (t, r) => `At traps your breathing was ${t}% shallower than your calm; at treasure ${r}%.` },
  rate: { label: 'Breathing rate', unit: '%', floor: 10, get: (f) => 100 * Math.abs(f.rateChange), fmt: (x) => String(Math.round(x)),
    line: (t, r) => `At traps your breathing rate moved ${t}% from your calm; at treasure ${r}%.` },
  blinks: { label: 'Blinks', unit: 'per peek', floor: 0.8, get: (f) => f.blinkCount ?? 0, fmt: (x) => x.toFixed(1),
    line: (t, r) => `At traps you blinked ${t} times per peek; at treasure ${r}.` },
  smile: { label: 'Smile', unit: 'points', floor: 3, get: (f) => 100 * (f.exprDelta.happy ?? 0), fmt: signed,
    line: (t, r) => `At traps your smile moved ${t} points from your calm; at treasure ${r}.` },
  surprise: { label: 'Surprise', unit: 'points', floor: 3, get: (f) => 100 * (f.exprDelta.surprise ?? 0), fmt: signed,
    line: (t, r) => `At traps surprise moved ${t} points on your face; at treasure ${r}.` },
  fear: { label: 'Fear', unit: 'points', floor: 3, get: (f) => 100 * (f.exprDelta.fear ?? 0), fmt: signed,
    line: (t, r) => `At traps fear moved ${t} points on your face; at treasure ${r}.` },
  pulse: { label: 'Pulse', unit: 'bpm', floor: 2, get: (f) => f.pulseDelta, fmt: signed,
    line: (t, r) => `At traps your pulse ran ${t} bpm from your calm; at treasure ${r}.` },
};

/** A tell counts as giving you away from this effect size on. */
export const TELL_THRESHOLD = 0.8;

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const varOf = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
};

/** Every peek of the game with a known kind (practice peeks included), read peeks only. */
export function labelledPeeks(s: GameState): { kind: BoxKind; features: PeekFeatures }[] {
  return [
    ...s.practiceLog,
    ...s.log.map((o) => ({ kind: o.kind, features: o.features })),
  ].filter((p) => p.features.quality >= MIN_QUALITY);
}

export function tellSheet(s: GameState): TellSheet {
  const score = s.score ?? computeScore(s);
  const peeks = labelledPeeks(s);
  const traps = peeks.filter((p) => p.kind === 'trap').map((p) => p.features);
  const treas = peeks.filter((p) => p.kind !== 'trap').map((p) => p.features);

  const tells: Tell[] = TELL_KEYS.map((key) => {
    const spec = SPECS[key];
    const a = traps.map(spec.get);
    const b = treas.map(spec.get);
    const mt = avg(a);
    const mr = avg(b);
    const pooled = Math.sqrt(((a.length - 1) * varOf(a) + (b.length - 1) * varOf(b)) / Math.max(1, a.length + b.length - 2));
    const effect = a.length && b.length ? (mt - mr) / Math.max(pooled, spec.floor) : 0;
    return {
      key, label: spec.label, trap: mt, treasure: mr, unit: spec.unit, effect, strength: Math.abs(effect),
      sentence: spec.line(spec.fmt(mt), spec.fmt(mr)), nTrap: a.length, nTreasure: b.length,
    };
  }).sort((x, y) => y.strength - x.strength);

  const top = tells[0];
  const biggest = top && top.strength >= TELL_THRESHOLD ? top : null;
  const readLine = `The banker read ${score.bankerCorrect} of ${score.bankerCalls} boxes right.`;
  const headline = biggest ? `${biggest.label} gave you away. ${biggest.sentence}` : 'Nothing gave you away this time.';
  return {
    level: s.level, rank: score.rank, pile: score.pile, won: score.won,
    bankerCorrect: score.bankerCorrect, bankerCalls: score.bankerCalls, readLine, tells, biggest, headline,
  };
}

/** Cross game history: summary numbers only, never raw signals. */
export interface TellHistoryEntry {
  at: string | null;
  level: LevelNo;
  pile: number;
  won: boolean;
  bankerCorrect: number;
  bankerCalls: number;
  biggest: TellKey | null;
  tells: Record<TellKey, { trap: number; treasure: number; effect: number }>;
}
export interface TellHistory { version: 1; games: TellHistoryEntry[]; }

export const HISTORY_CAP = 100;

export function emptyHistory(): TellHistory { return { version: 1, games: [] }; }

export function updateHistory(history: TellHistory | null | undefined, sheet: TellSheet, at: string | null = null): TellHistory {
  const tells = {} as TellHistoryEntry['tells'];
  for (const t of sheet.tells) tells[t.key] = { trap: t.trap, treasure: t.treasure, effect: t.effect };
  const entry: TellHistoryEntry = {
    at, level: sheet.level, pile: sheet.pile, won: sheet.won, bankerCorrect: sheet.bankerCorrect,
    bankerCalls: sheet.bankerCalls, biggest: sheet.biggest?.key ?? null, tells,
  };
  const games = [...(history?.games ?? []), entry].slice(-HISTORY_CAP);
  return { version: 1, games };
}

/** One tell across games, oldest first: watch it shrink. */
export function tellTrend(history: TellHistory, key: TellKey): { trap: number; treasure: number; effect: number }[] {
  return history.games.map((g) => g.tells[key]);
}

/** Highest banker you may face: one above the best you have beaten. */
export function unlockedLevel(history: TellHistory): LevelNo {
  const beaten = history.games.filter((g) => g.won).reduce((m, g) => Math.max(m, g.level), 0);
  return Math.min(LEVELS.length, beaten + 1) as LevelNo;
}
