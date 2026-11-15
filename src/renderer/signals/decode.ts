// Turns a decoded SmartSpectra Metrics payload into SignalFrames.
// Shared by the live source (renderer SDK) and the replay tooling, so both
// produce identical frames from identical SDK output.
import type { SignalFrame } from './types';

type Num = number | { toNumber(): number } | null | undefined;
const n = (v: Num): number | undefined =>
  v == null ? undefined : typeof v === 'number' ? v : v.toNumber();

const EXPR: Record<number, keyof NonNullable<SignalFrame['expr']>> = {
  1: 'anger', 2: 'contempt', 3: 'disgust', 4: 'fear', 5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise',
};

interface Measurement { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: Num }
interface Detection { detected?: boolean | null; stable?: boolean | null; timestamp?: Num }
interface ExpressionMsg { stable?: boolean | null; timestamp?: Num; scores?: { type?: number | null; confidence?: number | null }[] | null }
export interface MetricsLike {
  breathing?: { upperTrace?: Measurement[] | null; lowerTrace?: Measurement[] | null } | null;
  cardio?: { pulseRate?: Measurement[] | null; arterialPressureTrace?: Measurement[] | null } | null;
  face?: { blinking?: Detection[] | null; talking?: Detection[] | null; expression?: ExpressionMsg[] | null } | null;
}

/**
 * Merge every sample in one metrics payload into frames keyed by SDK timestamp (µs).
 * `originUs` is the session start in SDK time; frame.t is ms since then.
 * Samples already seen (same kind + timestamp) are skipped via `seen`.
 */
export function framesFromMetrics(m: MetricsLike, originUs: number, seen: Set<string>): SignalFrame[] {
  const byTs = new Map<number, SignalFrame>();
  const at = (tsUs: number): SignalFrame => {
    let f = byTs.get(tsUs);
    if (!f) { f = { t: (tsUs - originUs) / 1000, conf: 1, stable: true }; byTs.set(tsUs, f); }
    return f;
  };
  const take = (kind: string, ts: Num): number | undefined => {
    const v = n(ts); if (v == null) return undefined;
    const key = kind + v; if (seen.has(key)) return undefined; seen.add(key); return v;
  };
  for (const s of m.breathing?.upperTrace ?? []) {
    const ts = take('u', s.timestamp); if (ts == null || s.value == null) continue;
    const f = at(ts); f.chest = s.value; f.stable = f.stable && (s.stable ?? true);
  }
  for (const s of m.breathing?.lowerTrace ?? []) {
    const ts = take('l', s.timestamp); if (ts == null || s.value == null) continue;
    at(ts).abdomen = s.value;
  }
  for (const s of m.cardio?.arterialPressureTrace ?? []) {
    const ts = take('a', s.timestamp); if (ts == null || s.value == null) continue;
    at(ts).cardio = s.value;
  }
  for (const s of m.cardio?.pulseRate ?? []) {
    const ts = take('p', s.timestamp); if (ts == null || s.value == null) continue;
    const f = at(ts); f.pulse = s.value; if (s.confidence != null) f.conf = Math.min(f.conf, s.confidence);
  }
  for (const s of m.face?.blinking ?? []) {
    const ts = take('b', s.timestamp); if (ts == null) continue;
    at(ts).blink = !!s.detected;
  }
  for (const s of m.face?.talking ?? []) {
    const ts = take('k', s.timestamp); if (ts == null) continue;
    at(ts).talking = !!s.detected;
  }
  for (const s of m.face?.expression ?? []) {
    const ts = take('e', s.timestamp); if (ts == null) continue;
    const expr: NonNullable<SignalFrame['expr']> = {};
    for (const sc of s.scores ?? []) { const k = sc.type != null ? EXPR[sc.type] : undefined; if (k && sc.confidence != null) expr[k] = sc.confidence; }
    at(ts).expr = expr;
  }
  return [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
}
