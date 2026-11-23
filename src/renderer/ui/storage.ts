/**
 * Local only storage. Game results and tell summaries (never raw signals) and whether they have read the
 * consent screen this session. The Presage key is not kept here: see loadKey below.
 */
import { emptyHistory, emptyMemory, emptyStash, parseMemory, parseStash, type BankerMemory, type Stash, type TellHistory } from '../engine';

const HISTORY_KEY = 'vault.history.v1';
const KEY_KEY = 'vault.presageKey';

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null): void {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ }
}

export function loadHistory(): TellHistory {
  const raw = safeGet(HISTORY_KEY);
  if (!raw) return emptyHistory();
  try {
    const h = JSON.parse(raw) as TellHistory;
    return h && h.version === 1 && Array.isArray(h.games) ? h : emptyHistory();
  } catch { return emptyHistory(); }
}
export function saveHistory(h: TellHistory): void { safeSet(HISTORY_KEY, JSON.stringify(h)); }
/** Wipes results, tells, his memory of you, the Stash and the first job flag: everything this game saved. */
export function wipeHistory(): void { safeSet(HISTORY_KEY, null); safeSet(STASH_KEY, null); safeSet(FIRST_KEY, null); safeSet(MEMORY_KEY, null); }

/** His memory of you: the feature numbers and kind of each safe from your live jobs (numbers only), capped. */
const MEMORY_KEY = 'vault.memory.v1';
export function loadMemory(): BankerMemory {
  const raw = safeGet(MEMORY_KEY);
  if (!raw) return emptyMemory();
  try { return parseMemory(JSON.parse(raw)); } catch { return emptyMemory(); }
}
export function saveMemory(m: BankerMemory): void {
  // three decimals is plenty for a feature number and keeps the record small
  const round = (x: number): number => Math.round(x * 1000) / 1000;
  safeSet(MEMORY_KEY, JSON.stringify({ ...m, examples: m.examples.map((e) => ({ ...e, x: e.x.map(round), joy: round(e.joy) })) }));
}

const STASH_KEY = 'vault.stash.v1';
export function loadStash(): Stash {
  const raw = safeGet(STASH_KEY);
  if (!raw) return emptyStash();
  try { return parseStash(JSON.parse(raw)); } catch { return emptyStash(); }
}
export function saveStash(s: Stash): void { safeSet(STASH_KEY, JSON.stringify(s)); }

/** First time players land straight on First Job once; after that, the jobs menu. */
const FIRST_KEY = 'vault.firstJobOffered.v1';
export function firstJobOffered(): boolean { return safeGet(FIRST_KEY) === '1'; }
export function markFirstJobOffered(): void { safeSet(FIRST_KEY, '1'); }

// The Presage key lives in the main process, encrypted in the app's data folder (src/main/keyStore.ts); the
// page hands a pasted key over when live play starts (App.tsx) and never reads it back. Older builds kept a
// plain copy in localStorage, so all three of these only clear that copy.
export function loadKey(): string { safeSet(KEY_KEY, null); return ''; }
export function saveKey(_k: string): void { safeSet(KEY_KEY, null); }
export function forgetKey(): void { safeSet(KEY_KEY, null); }

/** Optional time multiplier for screenshots of the simulated body (?speed=8). Never above 20. */
export function pace(): number {
  try {
    const v = Number(new URLSearchParams(location.search).get('speed'));
    return v > 1 ? Math.min(20, v) : 1;
  } catch { return 1; }
}

/** Whether the player has been through (or skipped) the practice boxes once. After that, practice is opt in. */
const HOW_KEY = 'vault.howItWorks.v1';
export function loadHowSeen(): boolean { return safeGet(HOW_KEY) === '1'; }
export function saveHowSeen(): void { safeSet(HOW_KEY, '1'); }
