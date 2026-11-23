/** He remembers you: the memory record, how it seeds the next job, his notebook and his opening line. */
import { describe, expect, test } from 'vitest';
import {
  FIRST_JOB_MEMORY_WEIGHT, MEMORY_CAP, MEMORY_DECAY, emptyMemory, newGame, notebook, parseMemory, playSimGame, rememberJob,
  rememberLine, rememberedExamples, seedModel, step, type BankerMemory, type GameState, type PeekFeatures,
} from '../../src/renderer/engine';
import { emptyModel, learnExample } from '../../src/renderer/engine/banker';
import { MEMORY } from '../../src/renderer/engine/lines';

const calm: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1 };
const held: PeekFeatures = { ...calm, breathCatchMs: 1600, shallowing: 0.3 };

/** A finished job's state with these labelled safes on its log. */
function jobWith(peeks: { kind: 'trap' | 'small' | 'big'; f: PeekFeatures }[]): GameState {
  const s = newGame(9, 3);
  return {
    ...s,
    log: peeks.map((p, i) => ({
      boxId: i, kind: p.kind, value: 0, decision: 'offer', offer: null, paid: null, pTrap: 0.3, result: 'opened', heatAdded: 0,
      correct: true, features: p.f, strike: false, strikes: 0, expired: false, final: false,
    })),
  };
}
const tellJob = (): GameState => jobWith([
  { kind: 'trap', f: held }, { kind: 'small', f: calm }, { kind: 'trap', f: held }, { kind: 'big', f: calm }, { kind: 'small', f: calm },
]);

describe('his memory of you', () => {
  test('keeps numbers only, newest first out of the cap', () => {
    let m: BankerMemory = emptyMemory();
    for (let j = 0; j < 12; j++) m = rememberJob(m, tellJob());
    expect(m.jobs).toBe(12);
    expect(m.examples).toHaveLength(MEMORY_CAP);
    expect(m.examples[m.examples.length - 1]!.job).toBe(12);
    expect(Math.min(...m.examples.map((e) => e.job))).toBeGreaterThan(1);
    const round = parseMemory(JSON.parse(JSON.stringify(m)));
    expect(round).toEqual(m);
    for (const e of round.examples) {
      expect(Object.keys(e).sort()).toEqual(['job', 'joy', 'kind', 'unread', 'x']);
      expect(e.x.every((x) => typeof x === 'number')).toBe(true);
    }
    expect(parseMemory(null)).toEqual(emptyMemory());
    expect(parseMemory({ version: 1, jobs: 2, examples: [{ x: [1, 'a'], kind: 'trap', unread: false, joy: 0, job: 1 }] }).examples).toEqual([]);
  });

  test('older jobs count less, and First Job caps what he remembers', () => {
    let m = rememberJob(emptyMemory(), tellJob());
    m = rememberJob(m, tellJob());
    const ex = rememberedExamples(3, m);
    const last = ex.filter((e) => e.age === 1);
    const before = ex.filter((e) => e.age === 2);
    expect(last[0]!.w).toBeCloseTo(MEMORY_DECAY);
    expect(before[0]!.w).toBeCloseTo(MEMORY_DECAY ** 2);
    const first = rememberedExamples(1, m);
    expect(first.reduce((a, e) => a + (e.w ?? 1), 0)).toBeLessThanOrEqual(FIRST_JOB_MEMORY_WEIGHT + 1e-9);
  });

  test('the remember action seeds the job, only before it begins', () => {
    const m = rememberJob(emptyMemory(), tellJob());
    const s = step(newGame(4, 3), { type: 'remember', memory: m });
    expect(s.model.examples).toHaveLength(5);
    const begun = step(newGame(4, 3), { type: 'begin' });
    expect(step(begun, { type: 'remember', memory: m }).model.examples).toHaveLength(0);
  });

  test('his notebook starts empty and fills from this player only', () => {
    const fresh = notebook(emptyModel(3));
    expect(fresh.watched).toBe(0);
    expect(fresh.rows.map((r) => r.key)).toEqual(['breath', 'shallow', 'rate', 'blinks', 'joy', 'alarm']);
    for (const r of fresh.rows) { expect(r.sep).toBe(0); expect(r.word).toBe('nothing yet'); }
    expect(notebook(emptyModel(1)).rows.map((r) => r.key)).toEqual(['breath', 'shallow', 'rate']);
    let model = emptyModel(3);
    for (const p of tellJob().log) model = learnExample(model, p.features, p.kind);
    const nb = notebook(model);
    const breath = nb.rows.find((r) => r.key === 'breath')!;
    expect(breath.word).toBe('sure');
    expect(breath.side).toBe('empty');
    expect(nb.rows.find((r) => r.key === 'joy')!.word).toBe('nothing yet');
    const seeded = seedModel(3, rememberJob(emptyMemory(), tellJob()));
    expect(notebook(seeded).remembered).toBe(5);
  });

  test('he opens the next job with the tell his model learned', () => {
    expect(rememberLine(emptyModel(3), 1)).toBeNull();
    const line = rememberLine(seedModel(3, rememberJob(emptyMemory(), tellJob())), 1, 1)!;
    expect(MEMORY.named('you held your breath longer', 'empty safes')).toContain(line);
    // nothing separated: he says he found nothing
    const flat = jobWith([{ kind: 'trap', f: calm }, { kind: 'small', f: calm }]);
    expect(MEMORY.none as readonly string[]).toContain(rememberLine(seedModel(3, rememberJob(emptyMemory(), flat)), 1, 1)!);
  });

  test('a simulated player carried across jobs is remembered', () => {
    const one = playSimGame('honest', 3, { level: 3, job: 1 });
    const mem = rememberJob(emptyMemory(), one.state);
    const two = playSimGame('honest', 3, { level: 3, job: 2, memory: mem });
    const n = one.state.practiceLog.length + one.state.log.length;
    expect(two.state.model.examples.filter((e) => (e.age ?? 0) > 0)).toHaveLength(n);
  });
});
