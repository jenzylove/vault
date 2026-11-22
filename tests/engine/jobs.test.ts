import { describe, expect, test, vi } from 'vitest';

// simulated games are slow when the probe runs alongside in another worker
vi.setConfig({ testTimeout: 60000 });
import {
  JOBS, jobById, bankRun, emptyStash, isUnlocked, unlockProgress, newlyUnlocked, nextLocked, parseStash,
  newGame, step, runLeft, heistPay, learnBaseline, extractFeatures, SimBody, makeSimPlayer, playSimGame, minGoodMs,
  BASELINE_MS, PEEK_MS, type PeekFeatures, type GameState, type SimPlayerParams,
} from '../../src/renderer/engine';

const calm: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1 };
const caught: PeekFeatures = { ...calm, breathCatchMs: 2000, shallowing: 0.3, rateChange: -0.4 };
const dashes = /[-‐-―]/;
const banned = /\b(poker|straight face|lie detector)\b/i;

function board(job = jobById('heist'), seed = 1): GameState {
  let s = step(newGame(seed, job.level, job.rules), { type: 'begin' });
  s = step(s, { type: 'baselineDone', baseline: learnBaseline(new SimBody(makeSimPlayer('honest', 1), 1, 15).run(BASELINE_MS), job.peekMs) });
  return step(s, { type: 'practiceDone', peeks: [{ features: caught, kind: 'trap' }, { features: calm, kind: 'small' }] });
}

describe('jobs menu', () => {
  test('seven jobs, four open from the start, three locked at 5,000, 10,000 and 20,000', () => {
    expect(JOBS.map((j) => j.id)).toEqual(['first', 'heist', 'daily', 'speed', 'night', 'double', 'ghost']);
    const s = emptyStash();
    expect(JOBS.filter((j) => isUnlocked(j, s)).map((j) => j.id)).toEqual(['first', 'heist', 'daily', 'speed']);
    expect(jobById('night').price).toBe(5000);
    expect(jobById('double').price).toBe(10000);
    expect(jobById('ghost').price).toBe(20000);
    expect(nextLocked(s)?.id).toBe('night');
  });

  test('job settings: levels, safes, peek length', () => {
    expect(jobById('first')).toMatchObject({ level: 1, rules: { safes: 3 } });
    expect(jobById('heist')).toMatchObject({ level: 3, rules: { safes: 5 }, peekMs: PEEK_MS });
    expect(jobById('speed').peekMs).toBe(3000);
    expect(jobById('night').level).toBe(4);
    expect(jobById('ghost')).toMatchObject({ level: 5, hints: false });
    expect(jobById('daily').daily).toBe(true);
  });

  test('player copy has no dashes or banned words', () => {
    for (const j of JOBS) {
      expect(j.name + j.blurb).not.toMatch(dashes);
      expect(j.name + j.blurb).not.toMatch(banned);
    }
  });
});

describe('stash', () => {
  test('adds what you banked, a bust adds nothing, best and clean per job', () => {
    let s = emptyStash();
    s = bankRun(s, 'heist', { pile: 2400, busted: false, won: true });
    s = bankRun(s, 'heist', { pile: 1800, busted: false, won: false });
    s = bankRun(s, 'speed', { pile: 3000, busted: true, won: false });
    expect(s.total).toBe(4200);
    expect(s.best).toEqual({ heist: 2400, speed: 0 });
    expect(s.clean).toEqual({ heist: true, speed: false });
    expect(s.runs).toBe(3);
  });

  test('unlocks at the price, with progress toward it', () => {
    const before = bankRun(emptyStash(), 'heist', { pile: 3200, busted: false, won: false });
    expect(unlockProgress(jobById('night'), before)).toBeCloseTo(0.64);
    expect(isUnlocked(jobById('night'), before)).toBe(false);
    const after = bankRun(before, 'heist', { pile: 1800, busted: false, won: false });
    expect(after.total).toBe(5000);
    expect(newlyUnlocked(before, after).map((j) => j.id)).toEqual(['night']);
    expect(unlockProgress(jobById('heist'), after)).toBe(1);
  });

  test('parses stored stash defensively', () => {
    expect(parseStash(null)).toEqual(emptyStash());
    expect(parseStash({ version: 2, total: 5 })).toEqual(emptyStash());
    expect(parseStash({ version: 1, total: 700, best: { heist: 700 } }).total).toBe(700);
  });
});

describe('per job rules in the reducer', () => {
  test('First Job is three safes', () => {
    const s = board(jobById('first'));
    expect(runLeft(s)).toBe(3);
    expect(s.rules.target).toBe(600);
  });

  test('Double Cross: a dumped dud pays double', () => {
    const plain = board(jobById('heist'));
    const dc = board(jobById('double'));
    const trap = plain.boxes.find((b) => b.kind === 'trap')!;
    const sell = (s: GameState): GameState => {
      let x = step(s, { type: 'choose', boxId: trap.id });
      x = step(x, { type: 'peekDone', features: calm });
      expect(x.read?.decision).toBe('offer');
      return step(x, { type: 'sell' });
    };
    const a = sell(plain);
    const b = sell(dc);
    const offerA = a.lastOutcome!.offer!;
    const offerB = b.lastOutcome!.offer!;
    expect(a.pile).toBe(2 * offerA);
    expect(b.pile).toBe(4 * offerB);
    expect(heistPay(100, dc.rules)).toBe(300);
    expect(b.heat).toBeCloseTo(a.heat);
  });

  test('Double Cross: getting caught at a dud costs heat, elsewhere it does not', () => {
    for (const [id, heat] of [['heist', 0], ['double', 0.5]] as const) {
      const s = board(jobById(id));
      const trap = s.boxes.find((b) => b.kind === 'trap')!;
      let x = step(s, { type: 'choose', boxId: trap.id });
      x = step(x, { type: 'peekDone', features: caught });
      expect(x.read?.decision).toBe('walk');
      expect(x.heat).toBeCloseTo(heat);
    }
  });

  test('default rules reproduce the old five safe run', () => {
    const s = newGame(7);
    expect(s.rules).toMatchObject({ safes: 5, dudPayX: 1, caughtDudHeat: 0 });
  });
});

describe('per job peek length', () => {
  function quiet(seed: number): SimPlayerParams {
    return { ...makeSimPlayer('honest', seed), talkProb: 0, dropoutPerMin: 0 };
  }

  test('the calm windows use the peek length, and a short peek is still readable', () => {
    const body = new SimBody(quiet(3), 3, 30);
    const frames = body.run(BASELINE_MS);
    const b5 = learnBaseline(frames);
    const b3 = learnBaseline(frames, 3000);
    expect(b5.peekMs).toBe(PEEK_MS);
    expect(b3.peekMs).toBe(3000);
    // a shorter window holds less of a breath, so its typical swing is no bigger
    expect(b3.windowAmp).toBeLessThanOrEqual(b5.windowAmp * 1.05);
    expect(minGoodMs(3000)).toBe(1800);
    expect(minGoodMs(PEEK_MS)).toBe(3000);
    const f = extractFeatures(body.run(3000), b3);
    expect(f.quality).toBeGreaterThan(0.5);
    expect(f.windowMs).toBeGreaterThan(2800);
  });

  test('a 3 second look: calm loot reads calm, a held breath at a dud still gets caught', () => {
    let falseCatches = 0;
    let catches = 0;
    const n = 12;
    for (let seed = 1; seed <= n; seed++) {
      const p: SimPlayerParams = { ...quiet(seed), trapCatch: 1 };
      const body = new SimBody(p, seed, 30);
      const bl = learnBaseline(body.run(BASELINE_MS), 3000);
      body.run(1500);
      body.react('small');
      if (extractFeatures(body.run(3000), bl).breathCatchMs > 0) falseCatches++;
      body.run(4000);
      body.react('trap');
      body.run(300);
      if (extractFeatures(body.run(3000), bl).breathCatchMs > 0) catches++;
    }
    expect(falseCatches).toBeLessThanOrEqual(2);
    expect(catches).toBeGreaterThanOrEqual(n / 2);
  });

  test('a whole Speed Run plays through the reducer', () => {
    const job = jobById('speed');
    const { result } = playSimGame('honest', 4, { level: job.level, peekMs: job.peekMs, rules: job.rules });
    expect(result.peeks).toBeGreaterThan(0);
    expect(result.peeks).toBeLessThanOrEqual(5);
  });
});
