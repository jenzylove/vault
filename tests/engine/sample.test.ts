import { describe, expect, test, vi } from 'vitest';
import {
  playSimGame, SimBody, makeSimPlayer, learnBaseline, extractFeatures, BASELINE_MS, PEEK_MS, PEEK_LEAD_MS,
} from '../../src/renderer/engine';
import { SAMPLE_BODY } from '../../src/renderer/engine/sim';
import { SimulatedSource, peekKey } from '../../src/renderer/ui/simSource';

vi.setConfig({ testTimeout: 120000 });

describe('the sample run body', () => {
  test('a sample job is repeatable: same seed, same job', () => {
    const a = playSimGame('sample', 7, { level: 3 });
    const b = playSimGame('sample', 7, { level: 3 });
    expect(a.result).toEqual(b.result);
    expect(a.state.log.map((o) => o.features)).toEqual(b.state.log.map((o) => o.features));
  });

  test('a keyed look replays the same reaction', () => {
    const run = (key: number): number => {
      const body = new SimBody(makeSimPlayer('sample', 3), 3, 30);
      const bl = learnBaseline(body.run(BASELINE_MS));
      body.run(PEEK_LEAD_MS);
      body.react('trap', key);
      return extractFeatures(body.run(PEEK_MS), bl).breathCatchMs;
    };
    for (const key of [1, 2, 3, 99, 12345]) expect(run(key)).toBe(run(key));
    expect(peekKey({ seed: 5, turn: 0 })).toBe(peekKey({ seed: 5, turn: 0 }));
    expect(peekKey({ seed: 5, turn: 0 })).not.toBe(peekKey({ seed: 5, turn: 1 }));
  });

  test('at a dud it holds its breath about half the time, soon after the contents show', () => {
    let looks = 0;
    let held = 0;
    let early = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const body = new SimBody(makeSimPlayer('sample', seed), seed, 30);
      const bl = learnBaseline(body.run(BASELINE_MS));
      for (let i = 0; i < 3; i++) {
        body.run(PEEK_LEAD_MS);
        body.react('trap');
        const f = extractFeatures(body.run(PEEK_MS), bl);
        looks++;
        if (f.breathCatchMs > 0) {
          held++;
          if ((f.catchStartMs ?? 99999) < 2000) early++;
        }
        body.run(3000);
      }
    }
    const share = held / looks;
    expect(SAMPLE_BODY.dudSlip).toBe(0.5);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
    expect(early / held).toBeGreaterThan(0.8);
  });

  test('the Fence catches it at some duds and is fooled at others, and a sample job can be lost', () => {
    let dudLooks = 0;
    let dudCaught = 0;
    let lootPassed = 0;
    let won = 0;
    let lost = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const { state, result } = playSimGame('sample', seed, { level: 3 });
      for (const o of state.log) {
        if (o.kind === 'trap') { dudLooks++; if (o.decision === 'walk') dudCaught++; }
        else if (o.decision === 'walk') lootPassed++;
      }
      if (result.won) won++; else lost++;
    }
    const caught = dudCaught / dudLooks;
    expect(caught).toBeGreaterThan(0.3); // caught sometimes
    expect(caught).toBeLessThan(0.75);   // fooled sometimes
    expect(lootPassed).toBeGreaterThan(0); // a small hold at loot can cost a safe
    expect(won).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(0);
  });

  test('the sample source plays the sample body by default and for the old honest default', () => {
    for (const s of [new SimulatedSource(4), new SimulatedSource(4, 'honest')]) {
      expect(s.label).toBe('Simulated body');
      expect(() => s.onPeek('trap', { seed: 4, turn: 0 })).not.toThrow();
      expect(() => s.onPeek('small')).not.toThrow();
    }
  });
});
