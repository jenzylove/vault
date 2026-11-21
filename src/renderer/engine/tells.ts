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
  trap: number;        // mean at duds (display units)
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

interface Spec {
  label: string;
  /** plain word unit for the trend line, never a symbol */
  unit: string;
  floor: number;
  get: (f: PeekFeatures) => number;
  /** one value in plain words, no signs: "1.4 seconds", "10 percent shallower", "6 points more" */
  say: (x: number) => string;
  line: (trap: number, treasure: number) => string;
}

// Player facing copy rule: no minus or plus signs, no percent symbol, no hyphens or dashes.
const whole = (x: number): number => Math.round(Math.abs(x));
const one = (x: number): string => Math.abs(x).toFixed(1);
/** "10 percent shallower" / "4 percent deeper" / "as deep as your calm" */
const unitFor = (k: number, n: string): string => (k === 1 ? n.replace(/^points/, 'point').replace(/^beats/, 'beat') : n);
const towards = (x: number, n: string, up: string, down: string, level: string): string =>
  whole(x) === 0 ? level : `${whole(x)} ${unitFor(whole(x), n)} ${x > 0 ? up : down}`;

function face(label: string, get: (f: PeekFeatures) => number, verb: string, what: string): Spec {
  const amt = (x: number): string => (whole(x) === 0 ? `no more${what}` : `${towards(x, 'points', 'more', 'less', '')}${what}`);
  return {
    label, unit: 'points', floor: 3, get: (f) => 100 * get(f),
    say: (x) => towards(x, 'points', 'more', 'less', 'no change'),
    line: (t, r) => `At duds ${verb} ${amt(t)} than at your calm. At loot, ${amt(r)}.`,
  };
}

const SPECS: Record<TellKey, Spec> = {
  breath: {
    label: 'Breath catch', unit: 'seconds', floor: 0.25, get: (f) => f.breathCatchMs / 1000,
    say: (x) => `${one(x)} seconds`,
    line: (t, r) => `At duds your breath stopped for ${one(t)} seconds on average. At loot, ${one(r)} seconds.`,
  },
  shallow: {
    label: 'Shallow breathing', unit: 'percent', floor: 8, get: (f) => 100 * f.shallowing,
    say: (x) => towards(x, 'percent', 'shallower', 'deeper', 'as deep as your calm'),
    line: (t, r) => `At duds your breath ${whole(t) === 0 ? 'stayed as deep as your calm' : `went ${towards(t, 'percent', 'shallower', 'deeper', '')} than your calm`}. `
      + `At loot it ${whole(r) === 0 ? 'stayed as deep as your calm' : `went ${towards(r, 'percent', 'shallower', 'deeper', '')}`}.`,
  },
  rate: {
    label: 'Breathing rate', unit: 'percent', floor: 10, get: (f) => 100 * Math.abs(f.rateChange),
    say: (x) => `${whole(x)} percent`,
    line: (t, r) => `At duds your breathing rate moved ${whole(t)} percent away from your calm. At loot it moved ${whole(r)} percent.`,
  },
  blinks: {
    label: 'Blinks', unit: 'blinks', floor: 0.8, get: (f) => f.blinkCount ?? 0,
    say: (x) => `${one(x)} blinks`,
    line: (t, r) => `At duds you blinked ${one(t)} times a peek. At loot, ${one(r)} times.`,
  },
  smile: face('Smile', (f) => f.exprDelta.happy ?? 0, 'you smiled', ''),
  surprise: face('Surprise', (f) => f.exprDelta.surprise ?? 0, 'your face showed', ' surprise'),
  fear: face('Fear', (f) => f.exprDelta.fear ?? 0, 'your face showed', ' fear'),
  pulse: {
    label: 'Pulse', unit: 'beats a minute', floor: 2, get: (f) => f.pulseDelta,
    say: (x) => towards(x, 'beats a minute', 'faster', 'slower', 'level with your calm'),
    line: (t, r) => `At duds your pulse ran ${whole(t) === 0 ? 'level with your calm' : `${towards(t, 'beats a minute', 'faster', 'slower', '')} than your calm`}. `
      + `At loot it ran ${whole(r) === 0 ? 'level with your calm' : towards(r, 'beats a minute', 'faster', 'slower', '')}.`,
  },
};

/** One tell value in plain words, for any line outside the sheet (practice notes, trend lines). */
export function sayTell(key: TellKey, value: number): string { return SPECS[key].say(value); }

/** "Breath catch at duds, your last 3 games: 1.4, 0.9 and 0.6 seconds." No signs, no symbols. */
export function trendSentence(key: TellKey, values: number[]): string {
  const spec = SPECS[key];
  if (values.length < 2) return 'Play again to watch this tell shrink.';
  const plain = key === 'breath' || key === 'blinks' ? values.map(one) : key === 'rate' ? values.map((v) => String(whole(v))) : values.map((v) => spec.say(v));
  const list = `${plain.slice(0, -1).join(', ')} and ${plain[plain.length - 1]}`;
  const tail = key === 'breath' ? ' seconds' : key === 'blinks' ? ' blinks a peek' : key === 'rate' ? ' percent away from your calm' : key === 'smile' || key === 'surprise' || key === 'fear' ? ', against your calm' : '';
  return `${spec.label} at duds, your last ${values.length} games: ${list}${tail}.`;
}

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
      sentence: spec.line(mt, mr), nTrap: a.length, nTreasure: b.length,
    };
  }).sort((x, y) => y.strength - x.strength);

  const top = tells[0];
  const biggest = top && top.strength >= TELL_THRESHOLD ? top : null;
  const readLine = `The Fence read ${score.bankerCorrect} of ${score.bankerCalls} safes right.`;
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

// ---------- he remembers you ----------

const PHRASE: Record<TellKey, { you: string; me: string; past: string }> = {
  breath: { you: 'You hold your breath', me: 'I hold my breath', past: 'you held your breath' },
  shallow: { you: 'Your breathing goes shallow', me: 'My breathing goes shallow', past: 'your breathing went shallow' },
  rate: { you: 'Your breathing changes pace', me: 'My breathing changes pace', past: 'your breathing changed pace' },
  blinks: { you: 'You blink more', me: 'I blink more', past: 'you blinked more' },
  smile: { you: 'You smile', me: 'I smile', past: 'you smiled' },
  surprise: { you: 'Your face shows surprise', me: 'My face shows surprise', past: 'your face showed surprise' },
  fear: { you: 'Your face tightens', me: 'My face tightens', past: 'your face tightened' },
  pulse: { you: 'Your pulse climbs', me: 'My pulse climbs', past: 'your pulse climbed' },
};

/** "You hold your breath when you see a trap." The side the tell is bigger on decides trap or treasure. */
export function tellLine(key: TellKey, effect: number): string {
  return `${PHRASE[key].you} when you see ${effect >= 0 ? 'a dud' : 'loot'}.`;
}

/** Share card: "My tell: I hold my breath. Can you hide yours?" */
export function shareTellLine(key: TellKey | null): string {
  return key ? `My tell: ${PHRASE[key].me}. Can you hide yours?` : 'He could not find my tell. Can he find yours?';
}

/** The line that opens the next run, from the last game in the history (null on a first game). */
export function memoryLine(history: TellHistory): string | null {
  const last = history.games[history.games.length - 1];
  if (!last) return null;
  if (!last.biggest) return 'Last time I could not find your tell. I am looking harder now.';
  const e = last.tells[last.biggest]?.effect ?? 1;
  return `Last time ${PHRASE[last.biggest].past} at ${e >= 0 ? 'duds' : 'loot'}. I am watching for that now.`;
}

export interface HideTrend { key: TellKey | null; trend: 'first' | 'better' | 'worse' | 'same' | 'unknown'; line: string; }

/**
 * Did you hide the tell he was watching for? `earlier` is the history before this run, oldest first.
 * He watches for the tell he last named (or this run's tell if he never named one), and this run is
 * compared with the most recent earlier run that measured it (a run with no trap measures nothing).
 */
export function hideTrend(earlier: readonly TellHistoryEntry[], sheet: TellSheet): HideTrend {
  if (earlier.length === 0) {
    const k = sheet.biggest?.key ?? null;
    return { key: k, trend: 'first', line: k ? 'First read. Next run he watches for it.' : 'First read. He found nothing yet.' };
  }
  const named = [...earlier].reverse().find((g) => g.biggest !== null)?.biggest ?? null;
  const key = named ?? sheet.biggest?.key ?? null;
  if (!key) return { key, trend: 'unknown', line: 'He has not found a tell on you yet.' };
  const cur = sheet.tells.find((t) => t.key === key);
  if (!cur || cur.nTrap === 0 || cur.nTreasure === 0) return { key, trend: 'unknown', line: 'He saw no dud from you this run, so he could not check.' };
  const before = [...earlier].reverse().map((g) => g.tells[key]).find((t) => t && t.effect !== 0);
  if (!before) return { key, trend: 'unknown', line: 'No earlier run to compare it with yet.' };
  const was = Math.abs(before.effect);
  const now = cur.strength;
  const nums = `${sayTell(key, before.trap)} at duds before, ${sayTell(key, cur.trap)} now.`;
  if (now < 0.8 * was || (now < TELL_THRESHOLD && was >= TELL_THRESHOLD)) return { key, trend: 'better', line: `You hid it better: ${nums}` };
  if (now > 1.2 * was) return { key, trend: 'worse', line: `It showed more: ${nums}` };
  return { key, trend: 'same', line: `About the same: ${nums}` };
}
