import { describe, expect, test } from 'vitest';
import {
  newGame, step, RULES, VALUE_TABLE, createBanker, learnBaseline, SimBody, makeSimPlayer, extractFeatures,
  type GameState, type PeekFeatures, type Baseline, BASELINE_MS, PEEK_MS,
} from '../../src/renderer/engine';

const calm: PeekFeatures = {
  breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1,
};
const caught: PeekFeatures = { ...calm, breathCatchMs: 2000, shallowing: 0.3, rateChange: -0.4 };

function baseline(): Baseline {
  return learnBaseline(new SimBody(makeSimPlayer('honest', 1), 1, 15).run(BASELINE_MS));
}

function toBoard(seed = 1): GameState {
  let s = step(newGame(seed), { type: 'begin' });
  s = step(s, { type: 'baselineDone', baseline: baseline() });
  return step(s, { type: 'practiceDone', peeks: [{ features: caught, kind: 'trap' }, { features: calm, kind: 'small' }] });
}

describe('newGame', () => {
  test('10 boxes: 5 small, 2 big, 3 traps from the fixed table, seeded', () => {
    const g = newGame(42);
    expect(g.boxes).toHaveLength(10);
    expect(g.boxes.filter((b) => b.kind === 'small').map((b) => b.value).sort((a, b) => a - b)).toEqual([...VALUE_TABLE.small]);
    expect(g.boxes.filter((b) => b.kind === 'big').map((b) => b.value).sort((a, b) => a - b)).toEqual([...VALUE_TABLE.big]);
    expect(g.boxes.filter((b) => b.kind === 'trap')).toHaveLength(3);
    expect(newGame(42)).toEqual(g);
    expect(g.practice.map((p) => p.kind).sort()).toEqual(['small', 'trap']);
  });
});

describe('step', () => {
  test('phases run begin, baseline, practice, board, peek, bankerRead, audit', () => {
    let s = newGame(3);
    expect(s.phase).toBe('begin');
    s = step(s, { type: 'begin' });
    expect(s.phase).toBe('baseline');
    s = step(s, { type: 'baselineDone', baseline: baseline() });
    expect(s.phase).toBe('practice');
    s = step(s, { type: 'practiceDone', peeks: [{ features: caught, kind: 'trap' }, { features: calm, kind: 'small' }] });
    expect(s.phase).toBe('board');
    expect(s.model.examples).toHaveLength(2);
    const treasure = s.boxes.find((b) => b.kind !== 'trap')!;
    s = step(s, { type: 'choose', boxId: treasure.id });
    expect(s.phase).toBe('peek');
    s = step(s, { type: 'peekDone', features: calm });
    expect(s.phase).toBe('bankerRead');
    expect(s.read?.decision).toBe('offer');
    s = step(s, { type: 'open' });
    expect(s.phase).toBe('audit');
    expect(s.pile).toBe(treasure.value);
    expect(s.model.examples).toHaveLength(3);
  });

  test('invalid actions leave the state unchanged', () => {
    const s = newGame(1);
    expect(step(s, { type: 'sell' })).toBe(s);
    expect(step(s, { type: 'choose', boxId: 0 })).toBe(s);
  });

  test('a walk burns the box: lost to the player, scored at the reveal', () => {
    let s = toBoard();
    const trap = s.boxes.find((b) => b.kind === 'trap')!;
    s = step(s, { type: 'choose', boxId: trap.id });
    s = step(s, { type: 'peekDone', features: caught });
    expect(s.read?.decision).toBe('walk');
    expect(s.read?.reason).toBe('Trap. Your breath stopped for 2.0 seconds.');
    expect(s.read?.signal).toBe('breath');
    expect(s.boxes.find((b) => b.id === trap.id)!.state).toBe('burned');
    expect(s.log[0]!.correct).toBeNull();
    s = step(s, { type: 'leave' });
    s = step(s, { type: 'reveal' });
    expect(s.phase).toBe('over');
    expect(s.score!.bankerCorrect).toBe(1);
  });

  test('selling a trap pays the offer and raises heat at the audit', () => {
    let s = toBoard();
    const trap = s.boxes.find((b) => b.kind === 'trap')!;
    s = step(s, { type: 'choose', boxId: trap.id });
    s = step(s, { type: 'peekDone', features: calm });
    expect(s.read?.decision).toBe('offer');
    const offer = s.read!.offer!;
    s = step(s, { type: 'sell' });
    expect(s.pile).toBe(offer * (1 + RULES.heistBonus)); // the heist: paid again at the audit
    expect(s.heat).toBeCloseTo(RULES.heatPerTrapBought, 5);
    expect(s.trapsBought).toBe(1);
    expect(s.lastOutcome?.correct).toBe(false);
  });

  test('full heat busts you: the banker throws you out with nothing', () => {
    let s = toBoard();
    s = { ...s, pile: 1000, heatParts: { ...s.heatParts, traps: 0.9 }, heat: 0.9, trapsBought: 3 };
    const trap = s.boxes.find((b) => b.kind === 'trap')!;
    s = step(s, { type: 'choose', boxId: trap.id });
    s = step(s, { type: 'peekDone', features: calm });
    if (s.phase === 'bankerRead') s = step(s, { type: 'sell' });
    expect(s.busted).toBe(true);
    expect(s.phase).toBe('reveal');
    expect(s.pile).toBe(0);
  });

  test('leaving keeps the pile and ends the game', () => {
    let s = toBoard();
    const box = s.boxes.find((b) => b.kind === 'big')!;
    s = step(s, { type: 'choose', boxId: box.id });
    s = step(s, { type: 'peekDone', features: calm });
    s = step(s, { type: 'open' });
    s = step(s, { type: 'leave' });
    s = step(s, { type: 'reveal' });
    expect(s.score).toMatchObject({ pile: box.value, left: true, busted: false });
  });
});

describe('createBanker (stateful wrapper)', () => {
  test('learns from practice and reads a peek', () => {
    const b = createBanker(baseline());
    b.learn(caught, 'trap');
    b.learn(calm, 'small');
    const g = toBoard();
    const box = g.boxes[0]!;
    expect(b.read(caught, box, g).decision).toBe('walk');
    expect(b.read(calm, box, g).decision).toBe('offer');
    expect(b.model.examples).toHaveLength(2);
  });

  test('extractFeatures + banker on a simulated honest trap names the breath', () => {
    const p = { ...makeSimPlayer('honest', 12), trapCatch: 1, catchMs: [1800, 1800] as [number, number], talkProb: 0, dropoutPerMin: 0 };
    const body = new SimBody(p, 12, 30);
    const bl = learnBaseline(body.run(BASELINE_MS));
    body.run(1000); body.react('trap');
    const f = extractFeatures(body.run(PEEK_MS), bl);
    const b = createBanker(bl);
    const g = toBoard();
    const r = b.read(f, g.boxes[0]!, g);
    expect(r.decision).toBe('walk');
    expect(r.signal).toBe('breath');
    expect(r.reason).toMatch(/^Trap\. Your breath stopped for \d\.\d seconds\.$/);
  });
});
