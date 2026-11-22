import { describe, expect, test, vi } from 'vitest';

// simulated games are slow when the probe runs alongside in another worker
vi.setConfig({ testTimeout: 60000 });
import {
  newGame, step, offerAt, learnBaseline, SimBody, makeSimPlayer, bankerView, readBanker, memoryLine, replayVerdict, jobById,
  emptyHistory, pickLine, pickIndex, OFFER_WINDOW_MS, MAX_STRIKES, BASELINE_MS,
  type GameState, type PeekFeatures, type TellHistory,
} from '../../src/renderer/engine';
import { FINAL, MEMORY, OFFER, STRIKE, UNREAD, VERDICT, WALK } from '../../src/renderer/engine/lines';

const calm: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1 };
const caught: PeekFeatures = { ...calm, breathCatchMs: 2000, shallowing: 0.3, rateChange: -0.4 };
const unread: PeekFeatures = { ...calm, quality: 0.1 };
const dashes = /[-‐-―−]/;
const banned = /\b(lie|lies|lying|liar|stress|stressed|anxiety|anxious|poker|straight face|detector)\b/i;

const bl = learnBaseline(new SimBody(makeSimPlayer('honest', 1), 1, 15).run(BASELINE_MS));

function board(seed = 1, level: 1 | 2 | 3 | 4 | 5 = 3, rules = {}): GameState {
  let s = step(newGame(seed, level, rules), { type: 'begin' });
  s = step(s, { type: 'baselineDone', baseline: bl });
  return step(s, { type: 'practiceDone', peeks: [{ features: caught, kind: 'trap' }, { features: calm, kind: 'small' }] });
}

/** Look at a sealed safe of this kind with these features. */
function look(s: GameState, kind: 'trap' | 'treasure', f: PeekFeatures): GameState {
  const box = s.boxes.find((b) => b.state === 'sealed' && (kind === 'trap' ? b.kind === 'trap' : b.kind !== 'trap'))!;
  return step(step(s, { type: 'choose', boxId: box.id }), { type: 'peekDone', features: f });
}

/** Settle four safes by opening calm treasures: the take is on the line at the last safe. */
function toLastSafe(seed = 1): GameState {
  let s = board(seed);
  for (let i = 0; i < 4; i++) {
    s = look(s, 'treasure', calm);
    expect(s.phase).toBe('bankerRead');
    s = step(step(s, { type: 'open' }), { type: 'next' });
  }
  return s;
}

describe('the ticking offer', () => {
  test('full at 0 ms, falls linearly to 60% at the end of the window, rounded down to 10', () => {
    expect(OFFER_WINDOW_MS).toBe(5000);
    expect(offerAt(500, 0)).toBe(500);
    expect(offerAt(500, 2500)).toBe(400);
    expect(offerAt(500, 5000)).toBe(300);
    expect(offerAt(500, 9000)).toBe(300);
    expect(offerAt(500, -50)).toBe(500);
    expect(offerAt(250, 1000)).toBe(230);
    expect(offerAt(330, 5000)).toBe(190);
    expect(offerAt(255, 0)).toBe(250);
    let prev = Infinity;
    for (let t = 0; t <= 5000; t += 100) {
      const x = offerAt(1270, t);
      expect(x % 10).toBe(0);
      expect(x).toBeLessThanOrEqual(prev);
      prev = x;
    }
  });

  test('a sale pays the offer at the moment you took it', () => {
    let s = look(board(), 'treasure', calm);
    const offer = s.read!.offer!;
    s = step(s, { type: 'sell', elapsedMs: 2500 });
    expect(s.pile).toBe(offerAt(offer, 2500));
    expect(s.lastOutcome).toMatchObject({ result: 'sold', offer, paid: offerAt(offer, 2500), expired: false });
    // no elapsed time given: the full offer
    const t = step(look(board(), 'treasure', calm), { type: 'sell' });
    expect(t.pile).toBe(offer);
  });

  test('expire: the offer ran out, you keep what is inside, like open', () => {
    const s = look(board(), 'treasure', calm);
    const box = s.boxes.find((b) => b.id === s.activeBoxId)!;
    const opened = step(s, { type: 'open' });
    const expired = step(s, { type: 'expire' });
    expect(expired.pile).toBe(box.value);
    expect(expired.pile).toBe(opened.pile);
    expect(expired.phase).toBe('audit');
    expect(expired.lastOutcome).toMatchObject({ result: 'opened', expired: true, paid: null, strike: false });
    expect(expired.boxes.find((b) => b.id === box.id)!.state).toBe('opened');
    // only from bankerRead
    expect(step(board(), { type: 'expire' })).toEqual(board());
  });
});

describe('strikes', () => {
  test('a dud you sold him is a strike at his audit', () => {
    let s = look(board(), 'trap', calm);
    expect(s.read?.decision).toBe('offer');
    s = step(s, { type: 'sell' });
    expect(s.strikes).toBe(1);
    expect(s.busted).toBe(false);
    expect(s.phase).toBe('audit');
    expect(s.lastOutcome).toMatchObject({ strike: true, strikes: 1, result: 'sold' });
    expect(MAX_STRIKES).toBe(2);
  });

  test('a dud you open (keep) is no strike', () => {
    const s = step(look(board(), 'trap', calm), { type: 'open' });
    expect(s.strikes).toBe(0);
    expect(s.lastOutcome?.strike).toBe(false);
  });

  test('two strikes: busted, the take goes to 0, and the end data says so', () => {
    let s = board();
    s = step(step(look(s, 'treasure', calm), { type: 'open' }), { type: 'next' });
    s = { ...s, strikes: 1, pile: 1200 };
    s = step(look(s, 'trap', calm), { type: 'sell' });
    expect(s.strikes).toBe(2);
    expect(s.busted).toBe(true);
    expect(s.pile).toBe(0);
    expect(s.phase).toBe('reveal');
    s = step(s, { type: 'reveal' });
    expect(s.score).toMatchObject({ busted: true, pile: 0, strikes: 2, maxStrikes: 2, won: false });
  });

  test('Double Cross: a dud he catches you at is a strike; in other jobs it is not', () => {
    for (const [id, strikes] of [['heist', 0], ['double', 1]] as const) {
      const job = jobById(id);
      const s = look(board(1, job.level, job.rules), 'trap', caught);
      expect(s.read?.decision).toBe('walk');
      expect(s.strikes).toBe(strikes);
      expect(s.lastOutcome?.strike).toBe(strikes === 1);
    }
    // a second catch busts you
    const job = jobById('double');
    let s = { ...board(1, job.level, job.rules), strikes: 1, pile: 800 };
    s = look(s, 'trap', caught);
    expect(s).toMatchObject({ strikes: 2, busted: true, pile: 0, phase: 'reveal' });
  });

  test('the replay calls a strike when given the outcome', () => {
    let s = step(look(board(), 'trap', calm), { type: 'sell' });
    const o = s.lastOutcome!;
    expect(STRIKE.sold).toContain(replayVerdict(o.features, s.read!, o.kind, s.level, o).line);
    s = { ...board(), strikes: 1 };
    s = step(look(s, 'trap', calm), { type: 'sell' });
    const o2 = s.lastOutcome!;
    expect(STRIKE.busted).toContain(replayVerdict(o2.features, s.read!, o2.kind, s.level, o2).line);
    const kept = step(look(board(), 'trap', calm), { type: 'open' });
    expect(VERDICT.dudKept).toContain(replayVerdict(calm, kept.read!, 'trap', 3, kept.lastOutcome!).line);
  });
});

describe('the last safe: double or nothing', () => {
  test('one safe left with a take: next goes to finalChoice, and leave walks out with it', () => {
    const s = toLastSafe();
    expect(s.phase).toBe('finalChoice');
    expect(s.pile).toBeGreaterThan(0);
    const out = step(s, { type: 'leave' });
    expect(out).toMatchObject({ phase: 'reveal', left: true, pile: s.pile, finalBet: false });
    expect(step(s, { type: 'choose', boxId: s.boxes.find((b) => b.state === 'sealed')!.id })).toBe(s);
  });

  test('finalBet goes back to the board, and you can no longer walk out', () => {
    const s = step(toLastSafe(), { type: 'finalBet' });
    expect(s).toMatchObject({ phase: 'board', finalBet: true });
    expect(step(s, { type: 'leave' })).toBe(s);
    expect(step(board(), { type: 'finalBet' }).finalBet).toBe(false);
  });

  test('he calls dud on a held breath at a dud: right, the take goes to 0', () => {
    const bet = step(toLastSafe(), { type: 'finalBet' });
    const s = look(bet, 'trap', caught);
    expect(s.phase).toBe('finalCall');
    expect(s.finalCall).toMatchObject({ call: 'dud', right: true, before: bet.pile, after: 0 });
    expect(s.read?.offer).toBeUndefined();
    expect(FINAL.dudBreath).toContain(s.read!.reason);
    expect(s.finalCall!.line).toBe(s.read!.reason);
    expect(s.lastOutcome).toMatchObject({ final: true, strike: false, kind: 'trap' });
    const end = step(s, { type: 'next' });
    expect(end).toMatchObject({ phase: 'reveal', pile: 0, busted: false });
    const over = step(end, { type: 'reveal' });
    expect(over.score).toMatchObject({ pile: 0, finalBet: true, finalCall: { call: 'dud', right: true }, won: false });
  });

  test('he calls loot on a calm dud: wrong, the take doubles and the dud adds nothing', () => {
    const bet = step(toLastSafe(), { type: 'finalBet' });
    const s = look(bet, 'trap', calm);
    expect(s.finalCall).toMatchObject({ call: 'loot', right: false, before: bet.pile, after: 2 * bet.pile });
    expect(FINAL.loot).toContain(s.read!.reason);
    expect(step(s, { type: 'next' }).pile).toBe(2 * bet.pile);
  });

  test('calm loot: he calls loot, right, the take goes to 0; a held breath at loot: dud, wrong, double', () => {
    const bet = step(toLastSafe(), { type: 'finalBet' });
    const a = look(bet, 'treasure', calm);
    expect(a.finalCall).toMatchObject({ call: 'loot', right: true, after: 0 });
    const b = look(bet, 'treasure', caught);
    expect(b.finalCall).toMatchObject({ call: 'dud', right: false, after: 2 * bet.pile });
    // the safe's own value never adds on a final bet
    expect(step(b, { type: 'next' }).pile).toBe(2 * bet.pile);
  });

  test('he could not read you: no call, the bet is off and the take stays', () => {
    const bet = step(toLastSafe(), { type: 'finalBet' });
    for (const kind of ['trap', 'treasure'] as const) {
      const s = look(bet, kind, unread);
      expect(s.finalCall).toMatchObject({ call: 'none', right: false, before: bet.pile, after: bet.pile });
      expect(FINAL.none).toContain(s.read!.reason);
      expect(step(s, { type: 'next' }).pile).toBe(bet.pile);
    }
  });

  test('his last call is your body alone: the board odds never decide it', () => {
    // a body that gives nothing (exactly at the line between his two reads) must not be called full just
    // because most safes are full; whatever he calls comes with a reason on screen
    const bet = step(toLastSafe(), { type: 'finalBet' });
    const s = look(bet, 'treasure', calm);
    expect(s.finalCall!.why).toBeTruthy();
    expect(s.finalCall!.why).not.toMatch(/odds|most safes/i);
  });

  test('nothing in the take: no choice, the last safe plays as usual', () => {
    let s = board();
    for (let i = 0; i < 4; i++) {
      s = look(s, 'treasure', caught); // he passes: burned, the take stays 0
      expect(s.phase).toBe('audit');
      s = step(s, { type: 'next' });
    }
    expect(s.pile).toBe(0);
    expect(s.phase).toBe('board');
    s = look(s, 'treasure', calm);
    expect(s.phase).toBe('bankerRead');
    s = step(step(s, { type: 'open' }), { type: 'next' });
    expect(s.phase).toBe('reveal');
  });

  test('every job gets it: First Job asks after its second safe', () => {
    const job = jobById('first');
    let s = board(2, job.level, job.rules);
    for (let i = 0; i < 2; i++) s = step(step(look(s, 'treasure', calm), { type: 'open' }), { type: 'next' });
    expect(s.phase).toBe('finalChoice');
  });
});

describe('his lines', () => {
  test('a seeded pick: same seed and turn, same line; one run never repeats a line in one situation', () => {
    const bank = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let seed = 1; seed <= 20; seed++) {
      const seen = new Set<string>();
      for (let turn = 0; turn < 6; turn++) {
        expect(pickLine(bank, { seed, turn }, 'x')).toBe(pickLine(bank, { seed, turn }, 'x'));
        seen.add(pickLine(bank, { seed, turn }, 'x'));
      }
      expect(seen.size).toBe(6);
    }
    const firsts = new Set(Array.from({ length: 30 }, (_, i) => pickIndex(6, { seed: i + 1, turn: 0 }, 'x')));
    expect(firsts.size).toBeGreaterThan(3);
  });

  test('his reason is deterministic per seed and varies across seeds', () => {
    const reasons = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = board(seed);
      const box = s.boxes.find((b) => b.kind === 'trap')!;
      const r1 = readBanker(s.model, caught, box, bankerView(s));
      const r2 = readBanker(s.model, caught, box, bankerView(board(seed)));
      expect(r1.reason).toBe(r2.reason);
      expect(WALK.breath('2.0')).toContain(r1.reason);
      expect(r1.lines).toEqual({ seed, turn: 0 });
      reasons.add(r1.reason);
    }
    expect(reasons.size).toBeGreaterThanOrEqual(4);
  });

  test('the memory line is seeded too', () => {
    const h: TellHistory = { ...emptyHistory(), games: [{ at: null, level: 3, pile: 0, won: false, bankerCorrect: 0, bankerCalls: 0, biggest: null, tells: {} as never }] };
    const lines = new Set(Array.from({ length: 30 }, (_, i) => memoryLine(h, i + 1)));
    expect(lines.size).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(MEMORY.none).toContain(l);
    expect(memoryLine(h, 7)).toBe(memoryLine(h, 7));
    expect(memoryLine(emptyHistory(), 7)).toBeNull();
  });

  test('every bank has at least 6 short lines in plain words, no dashes, no banned words', () => {
    const banks: string[][] = [
      [...WALK.talking], WALK.breath('1.8'), WALK.shallow(24), [...WALK.noBreath], WALK.rate('sped up', 40), WALK.rate('slowed', 40),
      WALK.blinkStop(5), WALK.blinkBurst(9, 5, 2), [...WALK.smile], [...WALK.smileDrop], WALK.alarm(12), WALK.sold('a dud'), WALK.sold('2 duds'),
      [...WALK.vague], [...UNREAD], [...OFFER.smileCalm], [...OFFER.bigSmile], [...OFFER.big], OFFER.close('your breathing'),
      [...OFFER.calm], [...OFFER.plain], VERDICT.walkDud('You stopped breathing for 1 second.'), VERDICT.walkLoot('Your face jumped.'),
      [...VERDICT.unread], [...VERDICT.missedSaw], [...VERDICT.missed], [...VERDICT.dudKept], [...VERDICT.believedCalm], [...VERDICT.believed],
      [...STRIKE.sold], [...STRIKE.caught], [...STRIKE.busted], [...FINAL.dudBreath], [...FINAL.dud], [...FINAL.loot], [...FINAL.none],
      [...FINAL.right], [...FINAL.wrong], MEMORY.named('you held your breath', 'empty safes'), [...MEMORY.none],
    ];
    for (const bank of banks) {
      expect(bank.length).toBeGreaterThanOrEqual(6);
      expect(new Set(bank).size).toBe(bank.length);
      for (const line of bank) {
        expect(line).not.toMatch(dashes);
        expect(line).not.toMatch(banned);
        expect(line).not.toMatch(/%/);
        expect(line.length).toBeLessThanOrEqual(90);
      }
    }
  });
});
