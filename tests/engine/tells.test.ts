import { describe, expect, test, vi } from 'vitest';

// simulated games are slow when the probe runs alongside in another worker
vi.setConfig({ testTimeout: 60000 });
import {
  playSimGame, tellSheet, updateHistory, emptyHistory, tellTrend, unlockedLevel, dailySeed, shareLine, newGame, step,
  levelConfig, LEVELS, readBanker, bankerView, featureMask, learnBaseline, SimBody, makeSimPlayer, TELL_KEYS, BASELINE_MS,
  type PeekFeatures, type GameState,
} from '../../src/renderer/engine';
import { emptyModel, learnExample } from '../../src/renderer/engine/banker';
import { sayTell, trendSentence } from '../../src/renderer/engine/tells';

const banned = /\b(lie|lies|lying|liar|stress|stressed|anxiety|anxious|poker|straight face)\b/i;

describe('tell sheet', () => {
  test('an honest player is given away by the breath, with real numbers', () => {
    let breathTop = 0;
    let breathHigher = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { state } = playSimGame('honest', seed, { level: 3, practice: true }); // a first game: the practice peeks guarantee a labelled trap
      const sheet = tellSheet(state);
      expect(sheet.tells).toHaveLength(TELL_KEYS.length);
      expect(sheet.readLine).toMatch(/^The Fence read \d+ of \d+ safes right\.$/);
      const breath = sheet.tells.find((t) => t.key === 'breath')!;
      expect(breath.sentence).toMatch(/^At empty safes your breath (never stopped|stopped for \d+\.\d seconds on average)\. At full safes it (never stopped|stopped for \d+\.\d seconds)\.$/);
      if (breath.trap > breath.treasure) breathHigher++; // a sim player catches at 70 to 95% of traps, so not every run
      if (sheet.biggest && ['breath', 'shallow', 'rate'].includes(sheet.biggest.key)) breathTop++;
      for (const t of sheet.tells) expect(t.sentence).not.toMatch(banned);
      expect(sheet.headline).not.toMatch(banned);
    }
    // a run is short (5 boxes plus 2 practice), so the face sometimes edges out the breath; breath still leads by far
    expect(breathTop).toBeGreaterThanOrEqual(65);
    expect(breathHigher).toBeGreaterThanOrEqual(85);
  });

  test('a skilled steady player shows a much smaller breath tell', () => {
    const effect = (strategy: 'honest' | 'steady'): number => {
      let sum = 0;
      for (let seed = 1; seed <= 20; seed++) sum += tellSheet(playSimGame(strategy, seed, { practice: true }).state).tells.find((t) => t.key === 'breath')!.effect;
      return sum / 20;
    };
    expect(effect('steady')).toBeLessThan(effect('honest') / 2);
  });

  test('a smile faked at traps shows up as a smile tell', () => {
    const sheet = tellSheet(playSimGame('fakeSmile', 7).state);
    const smile = sheet.tells.find((t) => t.key === 'smile')!;
    expect(smile.trap).toBeGreaterThan(smile.treasure);
    expect(smile.sentence).toMatch(/^At empty safes you smiled \d+ points more than at your calm\./);
  });

  test('every line is plain words: no signs, symbols, hyphens or dashes', () => {
    const symbols = /[-+%‐-―−;]/;
    for (const strategy of ['honest', 'steady', 'fakeSmile', 'freeze'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const sheet = tellSheet(playSimGame(strategy, seed, { level: 5 }).state);
        expect(sheet.headline).not.toMatch(symbols);
        for (const t of sheet.tells) {
          expect(t.sentence).not.toMatch(symbols);
          expect(t.sentence).not.toMatch(banned);
          expect(t.label).not.toMatch(symbols);
          expect(trendSentence(t.key, [t.trap, -t.trap, 0])).not.toMatch(symbols);
        }
      }
    }
    expect(sayTell('shallow', -10.2)).toBe('10 percent deeper');
    expect(sayTell('shallow', 10)).toBe('10 percent shallower');
    expect(sayTell('pulse', -3)).toBe('3 beats a minute slower');
    expect(sayTell('smile', 1.2)).toBe('1 point more');
    expect(trendSentence('breath', [1.4, 0.92, 0.6])).toBe('Breath catch at empty safes, your last 3 games: 1.4, 0.9 and 0.6 seconds.');
    expect(trendSentence('breath', [1.4])).toBe('Play again to watch this tell shrink.');
  });

  test('works before the reveal and with nothing played', () => {
    const s = step(step(step(newGame(1), { type: 'begin' }), { type: 'baselineDone', baseline: learnBaseline(new SimBody(makeSimPlayer('honest', 1), 1, 15).run(BASELINE_MS)) }), { type: 'practiceDone', peeks: [] });
    const sheet = tellSheet(s);
    expect(sheet.biggest).toBeNull();
    expect(sheet.headline).toBe('Nothing gave you away this time.');
  });
});

describe('tell history', () => {
  test('stores summary numbers only and shows a tell shrinking across games', () => {
    let h = emptyHistory();
    for (const strategy of ['honest', 'honest', 'steady'] as const) {
      h = updateHistory(h, tellSheet(playSimGame(strategy, 3, { practice: true }).state), '2026-11-15');
    }
    expect(h.games).toHaveLength(3);
    const trend = tellTrend(h, 'breath');
    expect(trend[2]!.trap).toBeLessThan(trend[0]!.trap);
    // no raw signal arrays: every stored value is a number, a string, a boolean or null
    const json = JSON.stringify(h);
    expect(json).not.toMatch(/chest|exprDelta|frames/);
    for (const g of h.games) for (const k of TELL_KEYS) expect(Object.keys(g.tells[k]).sort()).toEqual(['effect', 'trap', 'treasure']);
  });

  test('beating a banker unlocks the next one', () => {
    let h = emptyHistory();
    expect(unlockedLevel(h)).toBe(1);
    const sheet = tellSheet(playSimGame('steady', 2, { level: 1 }).state);
    h = updateHistory(h, { ...sheet, won: true, level: 1 });
    expect(unlockedLevel(h)).toBe(2);
    h = updateHistory(h, { ...sheet, won: true, level: 5 });
    expect(unlockedLevel(h)).toBe(5);
  });

  test('history is capped', () => {
    let h = emptyHistory();
    const sheet = tellSheet(playSimGame('honest', 1).state);
    for (let i = 0; i < 130; i++) h = updateHistory(h, sheet);
    expect(h.games.length).toBe(100);
  });
});

describe('banker ladder', () => {
  test('five ranks in order, each reads at least what the one before reads', () => {
    expect(LEVELS.map((l) => l.rank)).toEqual(['Pickpocket', 'Cutpurse', 'Cracksman', 'Safecracker', 'Ghost']);
    expect(featureMask(1)).toEqual([true, true, true, false, false, false]);
    expect(featureMask(2)).toEqual([true, true, true, true, false, false]);
    expect(featureMask(3).every(Boolean)).toBe(true);
    expect(levelConfig(3).signals.pulseHeat).toBe(false);
    expect(levelConfig(4).signals.pulseHeat).toBe(true);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i]!.learnWeight).toBeGreaterThanOrEqual(LEVELS[i - 1]!.learnWeight);
      expect(LEVELS[i]!.target).toBeGreaterThanOrEqual(LEVELS[i - 1]!.target);
    }
  });

  test('Bank 1 cannot read a face; Bank 3 can', () => {
    const s: GameState = step(step(step(newGame(1, 1), { type: 'begin' }), { type: 'baselineDone', baseline: learnBaseline(new SimBody(makeSimPlayer('honest', 1), 1, 15).run(BASELINE_MS)) }), { type: 'practiceDone', peeks: [] });
    const face: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: { surprise: 0.5, fear: 0.4 }, talking: false, pulseDelta: 0, quality: 1 };
    const calm: PeekFeatures = { ...face, exprDelta: {} };
    let m1 = emptyModel(1);
    let m3 = emptyModel(3);
    for (let i = 0; i < 3; i++) {
      m1 = learnExample(learnExample(m1, face, 'trap'), calm, 'small');
      m3 = learnExample(learnExample(m3, face, 'trap'), calm, 'small');
    }
    const v = bankerView(s);
    expect(readBanker(m1, face, s.boxes[0]!, v).pTrap).toBeCloseTo(readBanker(m1, calm, s.boxes[0]!, v).pTrap, 6);
    expect(readBanker(m3, face, s.boxes[0]!, v).decision).toBe('walk');
  });

  test('pulse heat only counts at banks that read pulse', () => {
    const run = (level: 3 | 4): number => {
      let s = step(step(step(newGame(1, level), { type: 'begin' }), { type: 'baselineDone', baseline: learnBaseline(new SimBody(makeSimPlayer('honest', 1), 1, 15).run(BASELINE_MS)) }), { type: 'practiceDone', peeks: [] });
      s = step(s, { type: 'choose', boxId: s.boxes.find((b) => b.kind !== 'trap')!.id });
      s = step(s, { type: 'peekDone', features: { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 20, quality: 1 } });
      return s.heatParts.pulse;
    };
    expect(run(3)).toBe(0);
    expect(run(4)).toBeGreaterThan(0);
  });

  test('the scoreboard says whether you beat him', () => {
    const r = playSimGame('steady', 4, { level: 1 }).result;
    expect(r.level).toBe(1);
    expect(r.rank).toBe('Pickpocket');
    expect(r.won).toBe(!r.busted && r.pile >= r.target);
  });
});

describe('daily vault', () => {
  test('same day, same layout for everyone; different days differ', () => {
    expect(dailySeed('2026-11-15')).toBe(dailySeed('2026-11-15T23:59:00Z'));
    expect(newGame(dailySeed('2026-11-15')).boxes).toEqual(newGame(dailySeed('2026-11-15')).boxes);
    const layouts = new Set(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((d) => newGame(dailySeed(d)).boxes.map((b) => b.kind[0]).join('')));
    expect(layouts.size).toBeGreaterThan(1);
    expect(() => dailySeed('yesterday')).toThrow();
  });

  test('share line', () => {
    expect(shareLine(2, 10)).toBe('He read me 2 of 10. Can he read you?');
  });
});
