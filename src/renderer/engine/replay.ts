/**
 * The catch replay: after every box, what the banker actually measured on that peek, where it sat
 * on the trace, and one line in his voice. Every word comes from the feature values; nothing is made up.
 */
import type { BankerRead, BoxKind, PeekFeatures } from './types';
import { MIN_QUALITY } from './features';
import { levelConfig, type LevelNo } from './levels';
import { PEEK_MS } from './timing';
import { VERDICT, pickLine, strikeLine, type LinePick } from './lines';
import type { BoxOutcome } from './game';

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

// He says these out loud, and every spoken line is a recorded clip (npm run voice), so the numbers come
// from a small set: whole seconds 1 to 8, tens of percent, blink counts up to 20 in a 3 to 5 second look.
// The marks on the trace below keep the exact measures.
/** "3 seconds" / "1 second": the hold to the nearest whole second, 1 to 8. */
export const saySeconds = (ms: number): string => { const n = Math.min(8, Math.max(1, Math.round(ms / 1000))); return n === 1 ? '1 second' : `${n} seconds`; };
/** A share in tens of percent, 10 up to `max`. */
export const sayPercent = (x: number, max: number): number => Math.min(max, Math.max(10, Math.round(Math.abs(x) * 10) * 10));
/** "once" / "7 times", 1 to 20. */
export const sayTimes = (n: number): string => { const k = Math.min(20, Math.max(1, Math.round(n))); return k === 1 ? 'once' : `${k} times`; };
/** The look's length in whole seconds, 3 to 5 (the jobs' looks). */
export const sayWindow = (ms: number): number => Math.min(5, Math.max(3, Math.round(ms / 1000)));

/** What changed, in plain words, for the measure that carried the call. */
export function detailFor(f: PeekFeatures, driver: BankerRead['driver']): string {
  switch (driver) {
    case 'breath': return `You stopped breathing for ${saySeconds(f.breathCatchMs)}.`;
    case 'shallow': return `Your breathing went ${sayPercent(f.shallowing, 90)} percent shallower.`;
    case 'rate': return f.rateChange <= -0.99 ? 'You did not take a single breath.' : `Your breathing ${f.rateChange > 0 ? 'sped up' : 'slowed'} by ${sayPercent(f.rateChange, f.rateChange > 0 ? 150 : 90)} percent.`;
    case 'blinks': return f.blinkBurst < 0 || !f.blinkCount ? 'You stopped blinking.' : `You blinked ${sayTimes(f.blinkCount ?? 0)} in ${sayWindow(f.windowMs ?? PEEK_MS)} seconds.`;
    case 'joy': return (f.exprDelta.happy ?? 0) > 0 ? 'You smiled the way you smile at empty safes.' : 'Your smile dropped.';
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

/** What the replay knows about how the safe was settled (all optional: older callers pass none). */
export interface VerdictContext {
  /** how the safe was settled */
  result?: BoxOutcome['result'];
  /** this safe cost a strike */
  strike?: boolean;
  /** strikes after this safe (the outcome carries it) */
  strikes?: number;
  /** seeded line pick; defaults to the one his read was spoken from */
  pick?: LinePick;
}

/**
 * His one line once the box is settled. kind is what the box held (the player saw it).
 * Pass the settled BoxOutcome as ctx so a dud you sold him (or a Double Cross catch) is called as a strike.
 */
export function replayVerdict(f: PeekFeatures, read: BankerRead, kind: BoxKind, level: LevelNo, ctx: VerdictContext = {}): ReplayVerdict {
  const marks = replayMarks(f, level);
  const pick = ctx.pick ?? read.lines;
  if (ctx.strike) {
    const how = read.decision === 'walk' ? 'caught' : 'sold';
    return { line: strikeLine(Math.max(1, ctx.strikes ?? 1), how, pick), caught: read.decision === 'walk', marks };
  }
  if (read.decision === 'walk') {
    const d = detailFor(f, read.driver ?? null);
    return { line: kind === 'trap' ? pickLine(VERDICT.walkDud(d), pick, 'verdict.walkDud') : pickLine(VERDICT.walkLoot(d), pick, 'verdict.walkLoot'), caught: true, marks };
  }
  if (read.decision === 'unread') return { line: pickLine(VERDICT.unread, pick, 'verdict.unread'), caught: false, marks };
  if (kind === 'trap') {
    if (ctx.result === 'opened') return { line: pickLine(VERDICT.dudKept, pick, 'verdict.dudKept'), caught: false, marks };
    const saw = marks.some((m) => m.kind !== 'talk') && read.pTrap > 0.35;
    return { line: saw ? pickLine(VERDICT.missedSaw, pick, 'verdict.missedSaw') : pickLine(VERDICT.missed, pick, 'verdict.missed'), caught: false, marks };
  }
  return { line: f.breathCatchMs === 0 ? pickLine(VERDICT.believedCalm, pick, 'verdict.believedCalm') : pickLine(VERDICT.believed, pick, 'verdict.believed'), caught: false, marks };
}
