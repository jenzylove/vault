/**
 * The jobs menu: seven heists, four open from the start and three bought with your Stash (the lifetime
 * total of what you banked across every job). Pure data and arithmetic, no storage.
 */
import { levelConfig, type LevelNo } from './levels';
import { defaultRules, type RunRules, type Scoreboard } from './game';
import { PEEK_MS } from './timing';

export type JobId = 'first' | 'heist' | 'daily' | 'speed' | 'night' | 'double' | 'ghost';

export interface Job {
  id: JobId;
  name: string;
  /** one line on what is different about this job */
  blurb: string;
  /** the Fence's level: which signals he reads and how fast he learns */
  level: LevelNo;
  /** how long you look inside each safe, ms */
  peekMs: number;
  /** Stash needed to open it (0 = open from the start) */
  price: number;
  /** same safes for everyone today */
  daily: boolean;
  /** live catch warnings and his spoken reasons are shown */
  hints: boolean;
  rules: RunRules;
}

const job = (j: Omit<Job, 'rules'> & { rules?: Partial<RunRules> }): Job => ({ ...j, rules: { ...defaultRules(j.level), ...(j.rules ?? {}) } });

export const JOBS: readonly Job[] = [
  job({ id: 'first', name: 'First Job', blurb: 'Three safes and a gentle Fence. Learn the ropes.', level: 1, peekMs: PEEK_MS, price: 0, daily: false, hints: true,
    rules: { safes: 3, target: 600, maxTrapsCaught: 1, maxBurned: 1 } }),
  job({ id: 'heist', name: 'The Heist', blurb: 'Five safes. The full game.', level: 3, peekMs: PEEK_MS, price: 0, daily: false, hints: true }),
  job({ id: 'daily', name: 'Daily Heist', blurb: 'The same safes for everyone today.', level: 3, peekMs: PEEK_MS, price: 0, daily: true, hints: true }),
  job({ id: 'speed', name: 'Speed Run', blurb: 'A three second look instead of five.', level: 3, peekMs: 3000, price: 0, daily: false, hints: true }),
  job({ id: 'night', name: 'Night Shift', blurb: 'He reads your pulse too.', level: 4, peekMs: PEEK_MS, price: 5000, daily: false, hints: true }),
  job({ id: 'double', name: 'Double Cross', blurb: 'Dumped duds pay double. Get caught at a dud and it is a strike.', level: 3, peekMs: PEEK_MS, price: 10000, daily: false, hints: true,
    rules: { target: 3000, dudPayX: 2, caughtDudHeat: 0.5, caughtDudStrike: true } }),
  job({ id: 'ghost', name: 'The Ghost', blurb: 'He reads everything. No hints.', level: 5, peekMs: PEEK_MS, price: 20000, daily: false, hints: false }),
];

export function jobById(id: JobId): Job {
  return JOBS.find((j) => j.id === id) as Job;
}

/** What the Fence watches on this job, in plain words. */
export function readsList(level: LevelNo): string[] {
  const s = levelConfig(level).signals;
  return [s.breath && 'breath', s.blinks && 'blinks', s.face && 'face', s.pulseHeat && 'pulse'].filter(Boolean) as string[];
}

/** Lifetime record across all jobs. Only results, never signals. */
export interface Stash {
  version: 1;
  /** lifetime sum of what you banked (busted runs add nothing) */
  total: number;
  best: Partial<Record<JobId, number>>;
  clean: Partial<Record<JobId, boolean>>;
  runs: number;
}

export function emptyStash(): Stash { return { version: 1, total: 0, best: {}, clean: {}, runs: 0 }; }

/** Bank one finished run into the Stash. A bust banks nothing but still counts as a run. */
export function bankRun(stash: Stash, id: JobId, score: Pick<Scoreboard, 'pile' | 'busted' | 'won'>): Stash {
  const banked = score.busted ? 0 : Math.max(0, Math.round(score.pile));
  return {
    version: 1,
    total: stash.total + banked,
    best: { ...stash.best, [id]: Math.max(stash.best[id] ?? 0, banked) },
    clean: { ...stash.clean, [id]: (stash.clean[id] ?? false) || score.won },
    runs: stash.runs + 1,
  };
}

export function isUnlocked(j: Job, stash: Stash): boolean { return stash.total >= j.price; }

/** 0..1 toward a locked job's price. */
export function unlockProgress(j: Job, stash: Stash): number {
  return j.price <= 0 ? 1 : Math.max(0, Math.min(1, stash.total / j.price));
}

/** Jobs that this run's banking opened. */
export function newlyUnlocked(before: Stash, after: Stash): Job[] {
  return JOBS.filter((j) => !isUnlocked(j, before) && isUnlocked(j, after));
}

/** The cheapest job still locked, or null. */
export function nextLocked(stash: Stash): Job | null {
  return [...JOBS].filter((j) => !isUnlocked(j, stash)).sort((a, b) => a.price - b.price)[0] ?? null;
}

export function parseStash(raw: unknown): Stash {
  const s = raw as Partial<Stash> | null;
  if (!s || s.version !== 1 || typeof s.total !== 'number' || !Number.isFinite(s.total)) return emptyStash();
  return { version: 1, total: Math.max(0, s.total), best: s.best ?? {}, clean: s.clean ?? {}, runs: s.runs ?? 0 };
}
