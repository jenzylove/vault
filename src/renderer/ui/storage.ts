/**
 * Local only storage. Game results and tell summaries (never raw signals), the Presage key the player
 * pasted (never logged), and whether they have read the consent screen this session.
 */
import { emptyHistory, type TellHistory } from '../engine';

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
export function wipeHistory(): void { safeSet(HISTORY_KEY, null); }

export function loadKey(): string { return safeGet(KEY_KEY) ?? ''; }
export function saveKey(k: string): void { safeSet(KEY_KEY, k.trim() || null); }
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
