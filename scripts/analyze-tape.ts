// Spike 1 analysis: run a recorded tape (SDK samples JSONL + peek log) through the real engine.
// Usage: npx tsx scripts/analyze-tape.ts <signals.jsonl> <log.json>
import fs from 'node:fs';
import { learnBaseline, extractFeatures, createBanker, newGame } from '../src/renderer/engine';
import type { SignalFrame } from '../src/renderer/signals/types';

const [sigPath, logPath] = process.argv.slice(2);
const rows = fs.readFileSync(sigPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));

// SDK timestamps are µs from the start of the video; the log's t is ms from recording start.
const EXPR: Record<string, string> = { '1': 'anger', '2': 'contempt', '3': 'disgust', '4': 'fear', '5': 'happy', '6': 'neutral', '7': 'sad', '8': 'surprise' };
const byT = new Map<number, SignalFrame>();
const at = (tUs: number) => { let f = byT.get(tUs); if (!f) { f = { t: tUs / 1000, conf: 1, stable: true }; byT.set(tUs, f); } return f; };
for (const r of rows) {
  if (r.k === 'val') continue;
  const f = at(r.t);
  if (r.k === 'chest') { f.chest = r.v; f.stable = f.stable && r.s !== false; }
  if (r.k === 'abd') f.abdomen = r.v;
  if (r.k === 'apt') f.cardio = r.v;
  if (r.k === 'pulse') { f.pulse = r.v; if (r.c != null) f.conf = Math.min(f.conf, r.c); }
  if (r.k === 'blink') f.blink = r.v;
  if (r.k === 'talk') f.talking = r.v;
  if (r.k === 'expr') f.expr = Object.fromEntries(Object.entries(r.v as Record<string, number>).map(([k, v]) => [EXPR[k] ?? k, v])) as SignalFrame['expr'];
}
const frames = [...byT.values()].sort((a, b) => a.t - b.t);
const counts = rows.reduce((m: Record<string, number>, r) => ((m[r.k] = (m[r.k] ?? 0) + 1), m), {});
console.log('frames', frames.length, 'span', (frames[0]?.t / 1000).toFixed(1), 'to', (frames.at(-1)!.t / 1000).toFixed(1), 's; samples by kind', counts);

const ev = log.events as { t: number; e: string; box?: number; kind?: string; value?: number }[];
const baseEnd = ev.find((e) => e.e === 'baseline_end')!.t;
const baseline = learnBaseline(frames.filter((f) => f.t >= 3000 && f.t <= baseEnd));
console.log('baseline', JSON.stringify(baseline).slice(0, 400));

const peeks = ev.filter((e) => e.e === 'peek_start');
const win = (start: number) => frames.filter((f) => f.t >= start && f.t < start + 8000);
const results = peeks.map((p) => ({ box: p.box!, kind: p.kind as 'small' | 'big' | 'trap', feat: extractFeatures(win(p.t), baseline) }));
console.log('\nbox kind  catchMs shallow rateChg blinkBurst happy  surprise fear  quality');
for (const r of results) {
  const f = r.feat; const e = f.exprDelta as Record<string, number>;
  console.log(String(r.box).padStart(3), r.kind.padEnd(5), String(Math.round(f.breathCatchMs)).padStart(7), f.shallowing.toFixed(2).padStart(7), f.rateChange.toFixed(2).padStart(7), f.blinkBurst.toFixed(2).padStart(10), (e.happy ?? 0).toFixed(2).padStart(6), (e.surprise ?? 0).toFixed(2).padStart(8), (e.fear ?? 0).toFixed(2).padStart(5), f.quality.toFixed(2).padStart(8));
}
// Group means
const grp = (k: 'trap' | 'treasure') => results.filter((r) => (k === 'trap' ? r.kind === 'trap' : r.kind !== 'trap'));
for (const g of ['trap', 'treasure'] as const) {
  const rs = grp(g); const m = (fn: (x: (typeof rs)[0]) => number) => (rs.reduce((s, r) => s + fn(r), 0) / rs.length).toFixed(2);
  console.log(`${g.padEnd(8)} n=${rs.length} catchMs=${m((r) => r.feat.breathCatchMs)} shallow=${m((r) => r.feat.shallowing)} rate=${m((r) => r.feat.rateChange)} blink=${m((r) => r.feat.blinkBurst)}`);
}
// Sequential banker, as in the game: learns from every reveal before reading the next box.
const banker = createBanker(baseline, { seed: 1 }) as any;
let correct = 0, called = 0;
console.log('\nsequential banker (learns after each reveal):');
for (const r of results) {
  const read = banker.read(r.feat, { id: r.box, kind: r.kind, value: 0, state: 'peeked' }, newGame(1));
  const callTrap = read.decision === 'walk' || read.pTrap >= 0.5;
  if (read.decision !== 'unread') { called++; if (callTrap === (r.kind === 'trap')) correct++; }
  console.log(`box ${r.box} ${r.kind.padEnd(5)} pTrap=${read.pTrap.toFixed(2)} ${read.decision.padEnd(6)} "${read.reason}"`);
  banker.learn(r.feat, r.kind);
}
console.log(`\nbanker correct ${correct}/${called} (chance with ${grp('trap').length} traps in ${results.length}: ~${Math.round(100 * Math.max(grp('trap').length, results.length - grp('trap').length) / results.length)}%)`);
