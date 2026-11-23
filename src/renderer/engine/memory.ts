/**
 * His memory of you across jobs. Every safe from a live job (its feature numbers, what was inside, and
 * whether he could read you) is kept on this computer, newest first, capped. The next job starts with his
 * model already holding them, so he really does remember your tell: older jobs count less, and on First
 * Job everything he remembers counts for at most a couple of safes. Numbers only, never frames or video.
 */
import type { BoxKind } from './types';
import { featureVector, type BankerModel, type Example } from './banker';
import { MIN_QUALITY } from './features';
import type { GameState } from './game';
import type { LevelNo } from './levels';

/** Safes he keeps. Older ones drop off first. */
export const MEMORY_CAP = 40;
/** Each job back counts this much less (the last job counts 0.7, the one before 0.49, ...). */
export const MEMORY_DECAY = 0.7;
/** First Job stays gentle: everything he remembers counts for at most this many safes there. */
export const FIRST_JOB_MEMORY_WEIGHT = 2;

export interface MemoryEntry { x: number[]; kind: BoxKind; unread: boolean; joy: number; /** which job it came from (1, 2, ...) */ job: number }
export interface BankerMemory { version: 1; /** live jobs played so far */ jobs: number; examples: MemoryEntry[] }

export function emptyMemory(): BankerMemory { return { version: 1, jobs: 0, examples: [] }; }

const KINDS: readonly BoxKind[] = ['small', 'big', 'trap'];
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Anything read back from storage: keep only well formed entries. */
export function parseMemory(raw: unknown): BankerMemory {
  const m = raw as Partial<BankerMemory> | null;
  if (!m || m.version !== 1 || !finite(m.jobs) || !Array.isArray(m.examples)) return emptyMemory();
  const examples = m.examples.filter((e): e is MemoryEntry => !!e && Array.isArray(e.x) && e.x.length === 6 && e.x.every(finite)
    && KINDS.includes(e.kind) && typeof e.unread === 'boolean' && finite(e.joy) && finite(e.job));
  return { version: 1, jobs: Math.max(0, Math.floor(m.jobs)), examples: examples.slice(-MEMORY_CAP) };
}

/** Every safe of a job with a known kind: the practice looks and every safe on the log (burned ones are shown at the end). */
export function jobExamples(s: GameState): Omit<MemoryEntry, 'job'>[] {
  return [...s.practiceLog, ...s.log.map((o) => ({ kind: o.kind, features: o.features }))].map((p) => ({
    x: featureVector(p.features), kind: p.kind, unread: p.features.quality < MIN_QUALITY, joy: p.features.exprDelta.happy ?? 0,
  }));
}

/** Add a finished job to his memory (newest kept). */
export function rememberJob(mem: BankerMemory, s: GameState): BankerMemory {
  const job = mem.jobs + 1;
  const fresh = jobExamples(s).map((e) => ({ ...e, job }));
  return { version: 1, jobs: job, examples: [...mem.examples, ...fresh].slice(-MEMORY_CAP) };
}

/** The examples he starts a job with, weighted by how long ago he saw them. */
export function rememberedExamples(level: LevelNo, mem: BankerMemory | null | undefined): Example[] {
  if (!mem || mem.examples.length === 0) return [];
  const ex: Example[] = mem.examples.map((e) => {
    const age = Math.max(1, mem.jobs - e.job + 1);
    return { x: e.x.slice(), kind: e.kind, unread: e.unread, joy: e.joy, w: MEMORY_DECAY ** age, age };
  });
  if (level === 1) {
    const total = ex.reduce((a, e) => a + (e.w ?? 1), 0);
    const scale = total > FIRST_JOB_MEMORY_WEIGHT ? FIRST_JOB_MEMORY_WEIGHT / total : 1;
    for (const e of ex) e.w = (e.w ?? 1) * scale;
  }
  return ex;
}

/** A model for this job's Fence that already holds what he remembers. */
export function seedModel(level: LevelNo, mem: BankerMemory | null | undefined): BankerModel {
  return { examples: rememberedExamples(level, mem), level };
}
