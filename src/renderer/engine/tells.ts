/**
 * Tell sheet: after a game, the banker shows you your own tells with real numbers, and a history
 * tracks them across games so you can watch them shrink. Only summary numbers are stored.
 */
import type { BoxKind, PeekFeatures } from './types';
import { MIN_QUALITY } from './features';
import { computeScore, type GameState } from './game';
import { LEVELS, type LevelNo } from './levels';
import { MEMORY, pickLine } from './lines';
import { NOTE_HUNCH, notebook, type BankerModel, type FeatureName } from './banker';

export type TellKey = 'breath' | 'shallow' | 'rate' | 'blinks' | 'smile' | 'surprise' | 'fear' | 'pulse';
export const TELL_KEYS: readonly TellKey[] = ['breath', 'shallow', 'rate', 'blinks', 'smile', 'surprise', 'fear', 'pulse'];

export interface Tell {
  key: TellKey;
  label: string;
  trap: number;        // mean at empty safes (display units)
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
    line: (t, r) => `At empty safes ${verb} ${amt(t)} than at your calm. At full safes, ${amt(r)}.`,
  };
}

const SPECS: Record<TellKey, Spec> = {
  breath: {
    label: 'Breath catch', unit: 'seconds', floor: 0.25, get: (f) => f.breathCatchMs / 1000,
    say: (x) => `${one(x)} seconds`,
    line: (t, r) => `At empty safes your breath ${one(t) === '0.0' ? 'never stopped' : `stopped for ${one(t)} seconds on average`}. At full safes ${one(r) === '0.0' ? 'it never stopped' : `it stopped for ${one(r)} seconds`}.`,
  },
  shallow: {
    label: 'Shallow breathing', unit: 'percent', floor: 8, get: (f) => 100 * f.shallowing,
    say: (x) => towards(x, 'percent', 'shallower', 'deeper', 'as deep as your calm'),
    line: (t, r) => `At empty safes your breath ${whole(t) === 0 ? 'stayed as deep as your calm' : `went ${towards(t, 'percent', 'shallower', 'deeper', '')} than your calm`}. `
      + `At full safes it ${whole(r) === 0 ? 'stayed as deep as your calm' : `went ${towards(r, 'percent', 'shallower', 'deeper', '')}`}.`,
  },
  rate: {
    label: 'Breathing rate', unit: 'percent', floor: 10, get: (f) => 100 * Math.abs(f.rateChange),
    say: (x) => `${whole(x)} percent`,
    line: (t, r) => `At empty safes your breathing rate moved ${whole(t)} percent away from your calm. At full safes it moved ${whole(r)} percent.`,
  },
  blinks: {
    label: 'Blinks', unit: 'blinks', floor: 0.8, get: (f) => f.blinkCount ?? 0,
    say: (x) => `${one(x)} blinks`,
    line: (t, r) => `At empty safes you blinked ${one(t)} times a look. At full safes, ${one(r) === '0.0' ? 'not at all' : `${one(r)} times`}.`,
  },
  smile: face('Smile', (f) => f.exprDelta.happy ?? 0, 'you smiled', ''),
  surprise: face('Surprise', (f) => f.exprDelta.surprise ?? 0, 'your face showed', ' surprise'),
  fear: face('Fear', (f) => f.exprDelta.fear ?? 0, 'your face showed', ' fear'),
  pulse: {
    label: 'Pulse', unit: 'beats a minute', floor: 2, get: (f) => f.pulseDelta,
    say: (x) => towards(x, 'beats a minute', 'faster', 'slower', 'level with your calm'),
    line: (t, r) => `At empty safes your pulse ran ${whole(t) === 0 ? 'level with your calm' : `${towards(t, 'beats a minute', 'faster', 'slower', '')} than your calm`}. `
      + `At full safes it ran ${whole(r) === 0 ? 'level with your calm' : towards(r, 'beats a minute', 'faster', 'slower', '')}.`,
  },
};

/** One tell value in plain words, for any line outside the sheet (practice notes, trend lines). */
export function sayTell(key: TellKey, value: number): string { return SPECS[key].say(value); }

/** "Breath catch at empty safes, your last 3 games: 1.4, 0.9 and 0.6 seconds." No signs, no symbols. */
export function trendSentence(key: TellKey, values: number[]): string {
  const spec = SPECS[key];
  if (values.length < 2) return 'Play again to watch this tell shrink.';
  const plain = key === 'breath' || key === 'blinks' ? values.map(one) : key === 'rate' ? values.map((v) => String(whole(v))) : values.map((v) => spec.say(v));
  const list = `${plain.slice(0, -1).join(', ')} and ${plain[plain.length - 1]}`;
  const tail = key === 'breath' ? ' seconds' : key === 'blinks' ? ' blinks a peek' : key === 'rate' ? ' percent away from your calm' : key === 'smile' || key === 'surprise' || key === 'fear' ? ', against your calm' : '';
  return `${spec.label} at empty safes, your last ${values.length} games: ${list}${tail}.`;
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

// Tells are comparisons: what your body does more of at one kind of safe than at the other. Said
// that way the sentence always agrees with the numbers beside it, whichever way they lean.
const PHRASE: Record<TellKey, { you: string; me: string; past: string }> = {
  breath: { you: 'You hold your breath longer', me: 'I hold my breath longer', past: 'you held your breath longer' },
  shallow: { you: 'Your breathing goes shallower', me: 'My breathing goes shallower', past: 'your breathing went shallower' },
  rate: { you: 'Your breathing changes pace more', me: 'My breathing changes pace more', past: 'your breathing changed pace more' },
  blinks: { you: 'You blink more', me: 'I blink more', past: 'you blinked more' },
  smile: { you: 'You smile more', me: 'I smile more', past: 'you smiled more' },
  surprise: { you: 'Your face shows more surprise', me: 'My face shows more surprise', past: 'your face showed more surprise' },
  fear: { you: 'Your face tightens more', me: 'My face tightens more', past: 'your face tightened more' },
  pulse: { you: 'Your pulse runs higher', me: 'My pulse runs higher', past: 'your pulse ran higher' },
};

const side = (effect: number): [string, string] => (effect >= 0 ? ['empty', 'full'] : ['full', 'empty']);

/** "You hold your breath longer at empty safes than at full ones." The side the tell is bigger on decides. */
export function tellLine(key: TellKey, effect: number): string {
  const [a, b] = side(effect);
  return `${PHRASE[key].you} at ${a} safes than at ${b} ones.`;
}

/** Share card: "My tell: I hold my breath longer at empty safes. Can you hide yours?" */
export function shareTellLine(key: TellKey | null, effect = 1): string {
  return key ? `My tell: ${PHRASE[key].me} at ${side(effect)[0]} safes. Can you hide yours?` : 'He could not find my tell. Can he find yours?';
}

/**
 * The line that opens the next run, from the last game in the history (null on a first game).
 * Picked by a seeded rng: pass the new job's seed; the turn is how many games are on record.
 */
export function memoryLine(history: TellHistory, seed = 0): string | null {
  const last = history.games[history.games.length - 1];
  if (!last) return null;
  const pick = { seed, turn: history.games.length - 1 };
  if (!last.biggest) return pickLine(MEMORY.none, pick, 'memory.none');
  const e = last.tells[last.biggest]?.effect ?? 1;
  return pickLine(MEMORY.named(PHRASE[last.biggest].past, e >= 0 ? 'empty safes' : 'full safes'), pick, 'memory.named');
}

/** His notebook rows said as tells. */
const NOTE_TELL: Record<FeatureName, TellKey> = { breath: 'breath', shallow: 'shallow', rate: 'rate', blinks: 'blinks', joy: 'smile', alarm: 'surprise' };

/**
 * The line that opens a job, from what his model holds about you (the safes he remembers): the signal
 * he is surest about, on the side it shows. Null when he remembers nothing. Seeded like memoryLine.
 */
export function rememberLine(model: BankerModel, seed = 0, turn = 0): string | null {
  const past = model.examples.filter((e) => (e.age ?? 0) > 0);
  if (past.length === 0) return null;
  const pick = { seed, turn };
  const rows = notebook({ ...model, examples: past }).rows;
  const top = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || Math.abs(r.sep) > Math.abs(b.sep) ? r : b), null);
  // the same bar as his notebook: from a hunch on he names it, so the line never contradicts the panel
  if (!top || Math.abs(top.sep) < NOTE_HUNCH) return pickLine(MEMORY.none, pick, 'memory.none');
  const key = NOTE_TELL[top.key];
  return pickLine(MEMORY.named(PHRASE[key].past, top.sep >= 0 ? 'empty safes' : 'full safes'), pick, 'memory.named');
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
  if (!cur || cur.nTrap === 0) return { key, trend: 'unknown', line: 'He saw no empty safe from you this run, so he could not check.' };
  if (cur.nTreasure === 0) return { key, trend: 'unknown', line: 'He saw no full safe from you this run, so he could not check.' };
  const before = [...earlier].reverse().map((g) => g.tells[key]).find((t) => t && t.effect !== 0);
  if (!before) return { key, trend: 'unknown', line: 'No earlier run to compare it with yet.' };
  const was = Math.abs(before.effect);
  const now = cur.strength;
  if (now < 0.8 * was || (now < TELL_THRESHOLD && was >= TELL_THRESHOLD)) return { key, trend: 'better', line: 'You hid it better: the gap between your empty and full safes shrank.' };
  if (now > 1.2 * was) return { key, trend: 'worse', line: 'It showed more: the gap between your empty and full safes grew.' };
  return { key, trend: 'same', line: 'About the same gap between your empty and full safes as last time.' };
}
