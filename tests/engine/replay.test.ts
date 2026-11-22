import { describe, expect, test, vi } from 'vitest';

// simulated games are slow when the probe runs alongside in another worker
vi.setConfig({ testTimeout: 60000 });
import {
  SimBody, makeSimPlayer, learnBaseline, extractFeatures, liveRead, restingAlert, replayVerdict, newGame, step, bankerView,
  playSimGame, tellSheet, updateHistory, emptyHistory, memoryLine, hideTrend, tellLine, shareTellLine,
  BASELINE_MS, PEEK_MS, PEEK_LEAD_MS, type PeekFeatures, type SimPlayerParams,
} from '../../src/renderer/engine';
import { emptyModel } from '../../src/renderer/engine/banker';
import { MEMORY, VERDICT } from '../../src/renderer/engine/lines';

const banned = /\b(lie|lies|lying|liar|stress|stressed|anxiety|anxious|poker|straight face)\b/i;
const dashes = /[-‐-―−]/;

function quiet(seed: number, extra: Partial<SimPlayerParams> = {}): SimPlayerParams {
  return { ...makeSimPlayer('honest', seed), talkProb: 0, dropoutPerMin: 0, bigExcite: 0, ...extra };
}

describe('catch times for the replay', () => {
  test('a held breath is marked where it happened, and its span covers the reported hold', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const body = new SimBody(quiet(seed, { trapCatch: 1, catchMs: [1500, 1500] }), seed, 30);
      const bl = learnBaseline(body.run(BASELINE_MS));
      body.run(PEEK_LEAD_MS); body.react('trap');
      const f = extractFeatures(body.run(PEEK_MS), bl);
      expect(f.breathCatchMs).toBeGreaterThan(0);
      expect(f.catchStartMs).not.toBeNull();
      expect(f.catchStartMs!).toBeGreaterThanOrEqual(0);
      expect(f.catchEndMs!).toBeLessThanOrEqual(PEEK_MS + 50);
      expect(f.catchEndMs! - f.catchStartMs!).toBeGreaterThanOrEqual(f.breathCatchMs - 1);
    }
  });
});

describe('live read during a peek', () => {
  test('flags a hold before the peek ends and his alert climbs; a calm peek stays near his resting level', () => {
    let flagged = 0;
    let calmMax = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const body = new SimBody(quiet(seed, { trapCatch: 1, catchMs: [1800, 1800] }), seed, 30);
      const bl = learnBaseline(body.run(BASELINE_MS));
      let s = step(step(step(newGame(seed), { type: 'begin' }), { type: 'baselineDone', baseline: bl }), { type: 'practiceDone', peeks: [] });
      const rest = restingAlert(s.model, bankerView(s));
      body.run(PEEK_LEAD_MS); body.react('trap');
      const frames = body.run(4000); // before the 5 s peek is over
      const r = liveRead(frames, bl, s.model, bankerView(s));
      if (r.catchSpan) { flagged++; expect(r.alert).toBeGreaterThan(0.9); }
      body.run(3000); body.react('small');
      const calm = liveRead(body.run(PEEK_MS), bl, s.model, bankerView(s));
      calmMax = Math.max(calmMax, calm.alert - rest);
      s = { ...s };
    }
    expect(flagged).toBeGreaterThanOrEqual(17);
    expect(calmMax).toBeLessThan(0.45);
  });

  test('before any signal he sits at his resting level', () => {
    const bl = learnBaseline(new SimBody(quiet(2), 2, 30).run(BASELINE_MS));
    const s = step(step(step(newGame(2), { type: 'begin' }), { type: 'baselineDone', baseline: bl }), { type: 'practiceDone', peeks: [] });
    const r = liveRead([], bl, emptyModel(), bankerView(s));
    expect(r.catchSpan).toBeNull();
    expect(r.alert).toBeCloseTo(restingAlert(emptyModel(), bankerView(s)), 6);
  });
});

describe('replay verdict', () => {
  const calm: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1 };
  const held: PeekFeatures = { ...calm, breathCatchMs: 1400, catchStartMs: 900, catchEndMs: 2600 };

  test('a walk on a catch names the real hold, a missed trap says so', () => {
    const walk = replayVerdict(held, { pTrap: 0.9, pBig: 0.2, decision: 'walk', reason: '', signal: 'breath', driver: 'breath' }, 'trap', 3);
    expect(VERDICT.walkDud('You stopped breathing for 1 second.')).toContain(walk.line);
    expect(walk.caught).toBe(true);
    expect(walk.marks[0]).toMatchObject({ kind: 'catch', start: 900, end: 2600, label: 'Held 1.4 seconds' });
    const miss = replayVerdict(calm, { pTrap: 0.2, pBig: 0.2, decision: 'offer', offer: 200, reason: '', signal: 'none', driver: null }, 'trap', 3);
    expect(VERDICT.missed).toContain(miss.line);
    expect(miss.marks).toHaveLength(0);
    const burnt = replayVerdict(held, { pTrap: 0.9, pBig: 0.2, decision: 'walk', reason: '', signal: 'breath', driver: 'breath' }, 'big', 3);
    expect(VERDICT.walkLoot('You stopped breathing for 1 second.')).toContain(burnt.line);
  });

  test('every replay line from simulated games is plain words', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const st of ['honest', 'steady', 'freeze', 'hide'] as const) {
        const { state } = playSimGame(st, seed, { level: 5 });
        for (const o of state.log) {
          const v = replayVerdict(o.features, { pTrap: o.pTrap, pBig: 0, decision: o.decision, reason: '', signal: 'none', driver: o.decision === 'walk' ? 'breath' : null }, o.kind, 5);
          expect(v.line).not.toMatch(banned);
          expect(v.line).not.toMatch(dashes);
          for (const m of v.marks) expect(m.label).not.toMatch(dashes);
        }
      }
    }
  });
});

describe('he remembers you', () => {
  test('names the tell, opens the next run with it, and tracks whether you hid it', () => {
    expect(tellLine('breath', 1.2)).toBe('You hold your breath longer at empty safes than at full ones.');
    expect(tellLine('smile', -1.2)).toBe('You smile more at full safes than at empty ones.');
    expect(shareTellLine('breath')).toBe('My tell: I hold my breath longer at empty safes. Can you hide yours?');
    expect(shareTellLine(null)).toBe('He could not find my tell. Can he find yours?');
    let h = emptyHistory();
    expect(memoryLine(h)).toBeNull();
    const first = tellSheet(playSimGame('honest', 3, { practice: true }).state);
    expect(hideTrend([], first).trend).toBe('first');
    h = updateHistory(h, first);
    if (first.biggest?.key === 'breath') expect(MEMORY.named('you held your breath longer', 'empty safes')).toContain(memoryLine(h));
    else expect(memoryLine(h)).toMatch(/Last (time|job) /);
    const second = tellSheet(playSimGame('steady', 3, { practice: true }).state);
    const tr = hideTrend(h.games, second);
    expect(['better', 'same', 'worse', 'unknown']).toContain(tr.trend);
    expect(tr.line).not.toMatch(dashes);
    // a run with no trap in between measures nothing: compare with the last run that did
    const blank = { ...h.games[0]!, biggest: null, tells: Object.fromEntries(Object.entries(h.games[0]!.tells).map(([k]) => [k, { trap: 0, treasure: 0, effect: 0 }])) } as typeof h.games[0];
    const tr2 = hideTrend([...h.games, blank], second);
    expect(tr2.line).toBe(tr.line);
  });

  test('a steady player hides the breath better than an honest one did', () => {
    let better = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const a = tellSheet(playSimGame('honest', seed, { practice: true }).state);
      if (a.biggest?.key !== 'breath') continue;
      const h = updateHistory(emptyHistory(), a);
      const b = tellSheet(playSimGame('steady', seed, { practice: true }).state);
      if (hideTrend(h.games, b).trend === 'better') better++;
    }
    expect(better).toBeGreaterThanOrEqual(8);
  });
});
