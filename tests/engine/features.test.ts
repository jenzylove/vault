import { describe, expect, test } from 'vitest';
import type { SignalFrame } from '../../src/renderer/signals/types';
import {
  SimBody, makeSimPlayer, learnBaseline, extractFeatures, readBanker, newGame, bankerView, step,
  type SimPlayerParams,
} from '../../src/renderer/engine';
import { emptyModel } from '../../src/renderer/engine/banker';

function bodyFor(p: SimPlayerParams, seed: number, fps = 30): { body: SimBody; baseline: ReturnType<typeof learnBaseline> } {
  const body = new SimBody(p, seed, fps);
  const baseline = learnBaseline(body.run(30000));
  return { body, baseline };
}

function quietPlayer(seed: number): SimPlayerParams {
  const p = makeSimPlayer('honest', seed);
  return { ...p, talkProb: 0, dropoutPerMin: 0, bigExcite: 0 };
}

describe('baseline (simulated bodies)', () => {
  test('learns the breath period and blink rate of the simulated player', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const p = quietPlayer(seed);
      const { baseline } = bodyFor(p, seed);
      expect(Math.abs(baseline.breathPeriodMs - p.periodMs) / p.periodMs).toBeLessThan(0.15);
      expect(baseline.blinkRatePerMin).toBeGreaterThan(p.blinkRatePerMin * 0.4);
      expect(baseline.blinkRatePerMin).toBeLessThan(p.blinkRatePerMin * 1.8 + 4);
      expect(baseline.pulse).not.toBeNull();
      expect(baseline.quality).toBeGreaterThan(0.9);
    }
  });

  test('ignores low confidence and unstable frames', () => {
    const p = quietPlayer(3);
    const body = new SimBody(p, 3, 30);
    const frames = body.run(30000);
    const junk: SignalFrame[] = frames.map((f, i) => (i % 3 === 0 ? { ...f, chest: 1000, conf: 0.1, stable: false } : f));
    const clean = learnBaseline(frames);
    const dirty = learnBaseline(junk);
    expect(Math.abs(dirty.breathAmp - clean.breathAmp) / clean.breathAmp).toBeLessThan(0.2);
  });
});

describe('extractFeatures (simulated traces)', () => {
  test('a normal pause between breaths is never a catch', () => {
    let peeks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { body, baseline } = bodyFor(quietPlayer(seed), seed);
      for (let k = 0; k < 3; k++) {
        body.run(1500);
        body.react('small'); // no breath reaction for a small treasure
        const f = extractFeatures(body.run(8000), baseline);
        expect(f.breathCatchMs).toBe(0);
        peeks++;
      }
    }
    expect(peeks).toBe(120);
  });

  test('players with long natural pauses still do not read as a catch', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const p = { ...quietPlayer(seed), bottomPause: 0.26, periodMs: 5200 };
      const { body, baseline } = bodyFor(p, seed);
      body.run(1500);
      body.react('small');
      expect(extractFeatures(body.run(8000), baseline).breathCatchMs).toBe(0);
    }
  });

  test('a 1.5 s held breath after a sharp inhale is a catch of about 1.5 s', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const p: SimPlayerParams = { ...quietPlayer(seed), trapCatch: 1, catchMs: [1500, 1500] };
      const { body, baseline } = bodyFor(p, seed);
      body.run(1500);
      body.react('trap');
      const f = extractFeatures(body.run(8000), baseline);
      expect(f.breathCatchMs).toBeGreaterThan(1100);
      expect(f.breathCatchMs).toBeLessThan(2300);
    }
  });

  test('holding the breath through the whole peek reads as no breath at all', () => {
    const p = makeSimPlayer('holdBreath', 5);
    const { body, baseline } = bodyFor({ ...p, talkProb: 0, dropoutPerMin: 0 }, 5);
    body.run(1500);
    body.react('small');
    const f = extractFeatures(body.run(8000), baseline);
    expect(f.breathCatchMs).toBeGreaterThan(5000);
  });

  test('freezing stops the blinks and the breath', () => {
    const p = makeSimPlayer('freeze', 6);
    const { body, baseline } = bodyFor({ ...p, talkProb: 0, dropoutPerMin: 0 }, 6);
    body.run(1500);
    body.react('small');
    const f = extractFeatures(body.run(8000), baseline);
    expect(f.breathCatchMs).toBeGreaterThan(1500);
    expect(f.blinkBurst).toBeLessThan(0);
  });

  test('works at a different frame rate', () => {
    const p: SimPlayerParams = { ...quietPlayer(9), trapCatch: 1, catchMs: [1600, 1600] };
    const { body, baseline } = bodyFor(p, 9, 12);
    body.run(1500);
    body.react('trap');
    const f = extractFeatures(body.run(8000), baseline);
    expect(f.breathCatchMs).toBeGreaterThan(1100);
  });

  test('low quality makes the banker say unread', () => {
    const { body, baseline } = bodyFor(quietPlayer(4), 4);
    body.run(1500);
    body.react('trap');
    const frames = body.run(8000).map((f, i) => (i % 5 < 3 ? { ...f, conf: 0.2, stable: false } : f));
    const f = extractFeatures(frames, baseline);
    expect(f.quality).toBeLessThan(0.5);
    let s = step(step(newGame(1), { type: 'begin' }), { type: 'baselineDone', baseline });
    s = step(s, { type: 'practiceDone', peeks: [] });
    const box = s.boxes[0]!;
    const read = readBanker(emptyModel(), f, box, bankerView(s));
    expect(read.decision).toBe('unread');
    expect(read.reason).toMatch(/lost you/);
  });

  test('blink bursts and talking are picked up', () => {
    const p: SimPlayerParams = { ...quietPlayer(8), blinkLeak: 3, blinkRatePerMin: 18, talkProb: 1 };
    const { body, baseline } = bodyFor({ ...p, talkProb: 0 }, 8);
    (body.params as { talkProb: number }).talkProb = 1;
    let burst = 0;
    let talking = 0;
    for (let k = 0; k < 6; k++) {
      body.run(1500);
      body.react('trap');
      const f = extractFeatures(body.run(8000), baseline);
      burst += f.blinkBurst;
      if (f.talking) talking++;
    }
    expect(burst / 6).toBeGreaterThan(0.5);
    expect(talking).toBeGreaterThan(0);
  });
});
