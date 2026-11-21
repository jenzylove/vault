/**
 * The catch replay: after every box, what the banker actually measured on that peek, where it sat
 * on the trace, and one line in his voice. Every word comes from the feature values; nothing is made up.
 */
import type { BankerRead, BoxKind, PeekFeatures } from './types';
import { MIN_QUALITY } from './features';
import { levelConfig, type LevelNo } from './levels';
import { PEEK_MS } from './timing';

export type MarkKind = 'catch' | 'shallow' | 'rate' | 'blinks' | 'face' | 'pulse' | 'talk';
export interface ReplayMark {
  kind: MarkKind;
  label: string;
  /** ms from the start of the peek, for marks that happened at a moment */
  start?: number;
  end?: number;
  /** blink onsets, ms from the start of the peek */
  ticks?: number[];
}
export interface ReplayVerdict {
  line: string;
  caught: boolean;
  marks: ReplayMark[];
}

const secs = (ms: number): string => (ms / 1000).toFixed(1);
const pct = (x: number): number => Math.round(Math.abs(x) * 100);

/** What changed, in plain words, for the measure that carried the call. */
export function detailFor(f: PeekFeatures, driver: BankerRead['driver']): string {
  switch (driver) {
    case 'breath': return `You stopped breathing for ${secs(f.breathCatchMs)} seconds.`;
    case 'shallow': return `Your breathing went ${pct(f.shallowing)} percent shallower.`;
    case 'rate': return f.rateChange <= -0.99 ? 'You did not take a single breath.' : `Your breathing ${f.rateChange > 0 ? 'sped up' : 'slowed'} by ${pct(f.rateChange)} percent.`;
    case 'blinks': return f.blinkBurst < 0 ? 'You stopped blinking.' : `You blinked ${f.blinkCount ?? 0} times in ${Math.round((f.windowMs ?? PEEK_MS) / 1000)} seconds.`;
    case 'joy': return (f.exprDelta.happy ?? 0) > 0 ? 'You smiled the way you smile at traps.' : 'Your smile dropped.';
    case 'alarm': return 'Your face jumped.';
    default: return f.talking ? 'You started talking the moment you looked.' : 'Something changed when you looked.';
  }
}

/** The measures this banker can read that moved on this peek, with where they happened. */
export function replayMarks(f: PeekFeatures, level: LevelNo): ReplayMark[] {
  if (f.quality < MIN_QUALITY) return [];
  const sig = levelConfig(level).signals;
  const out: ReplayMark[] = [];
  if (f.talking) out.push({ kind: 'talk', label: 'You talked' });
  if (f.breathCatchMs > 0) {
    out.push({ kind: 'catch', label: `Held ${secs(f.breathCatchMs)} seconds`, start: f.catchStartMs ?? undefined, end: f.catchEndMs ?? undefined });
  }
  if (f.shallowing > 0.2) out.push({ kind: 'shallow', label: `${pct(f.shallowing)} percent shallower` });
  if (f.rateChange <= -0.99) out.push({ kind: 'rate', label: 'No full breath' });
  else if (Math.abs(f.rateChange) > 0.3) out.push({ kind: 'rate', label: `${pct(f.rateChange)} percent ${f.rateChange > 0 ? 'faster' : 'slower'}` });
  if (sig.blinks && Math.abs(f.blinkBurst) > 0.5) {
    out.push({ kind: 'blinks', label: f.blinkBurst < 0 ? 'Blinks stopped' : `${f.blinkCount ?? 0} blinks`, ticks: f.blinkAtMs ?? [] });
  }
  if (sig.face) {
    const joy = f.exprDelta.happy ?? 0;
    const alarm = (f.exprDelta.surprise ?? 0) + (f.exprDelta.fear ?? 0);
    if (joy > 0.06) out.push({ kind: 'face', label: 'Smile up' });
    else if (joy < -0.04) out.push({ kind: 'face', label: 'Smile dropped' });
    if (alarm > 0.06) out.push({ kind: 'face', label: 'Face jumped' });
  }
  if (sig.pulseHeat && f.pulseDelta > 3) out.push({ kind: 'pulse', label: `Pulse ${Math.round(f.pulseDelta)} beats faster` });
  return out;
}

/** His one line once the box is settled. kind is what the box held (the player saw it). */
export function replayVerdict(f: PeekFeatures, read: BankerRead, kind: BoxKind, level: LevelNo): ReplayVerdict {
  const marks = replayMarks(f, level);
  if (read.decision === 'walk') {
    return { line: `There. ${detailFor(f, read.driver ?? null)} ${kind === 'trap' ? 'I knew.' : 'I walked.'}`, caught: true, marks };
  }
  if (read.decision === 'unread') return { line: 'I lost you there. I could not read a thing.', caught: false, marks };
  if (kind === 'trap') {
    const saw = marks.some((m) => m.kind !== 'talk') && read.pTrap > 0.35;
    return { line: saw ? 'I saw something, but not enough. You got me.' : 'I saw nothing. You got me.', caught: false, marks };
  }
  return { line: f.breathCatchMs === 0 ? 'Your breath stayed even. I believed you.' : 'I believed you.', caught: false, marks };
}
