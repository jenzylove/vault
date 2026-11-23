/** He reads every signal live: the bar during the look runs on the same evidence as his read at the end. */
import { describe, expect, test, vi } from 'vitest';
import {
  SimBody, makeSimPlayer, learnBaseline, extractFeatures, liveRead, restingAlert, readBanker, newGame, step, bankerView, evidence,
  BASELINE_MS, PEEK_MS, PEEK_LEAD_MS, type BoxKind, type PeekFeatures,
} from '../../src/renderer/engine';
import { emptyModel, learnExample } from '../../src/renderer/engine/banker';
import { LIVE_BREATH_FROM_MS, LIVE_FACE_FROM_MS } from '../../src/renderer/engine/live';

vi.setConfig({ testTimeout: 120000 });

const KINDS: BoxKind[] = ['trap', 'small', 'big', 'trap', 'small', 'trap'];

describe('the live read during the look', () => {
  test('on the simulated body the live bar agrees in direction with his read at the end of the look', () => {
    let agree = 0;
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const body = new SimBody(makeSimPlayer('honest', seed), seed, 30);
      const bl = learnBaseline(body.run(BASELINE_MS));
      let s = step(step(step(newGame(seed, 3), { type: 'begin' }), { type: 'baselineDone', baseline: bl }), { type: 'practiceDone', peeks: [] });
      for (const kind of KINDS) {
        body.run(PEEK_LEAD_MS); body.react(kind);
        const frames = body.run(PEEK_MS);
        const view = bankerView(s);
        const rest = restingAlert(s.model, view);
        const f = extractFeatures(frames, bl);
        const end = readBanker(s.model, f, s.boxes[0]!, view).pTrap;
        const live = liveRead(frames, bl, s.model, view).alert;
        if (Math.abs(end - rest) > 0.05) {
          total++;
          if (Math.sign(live - rest) === Math.sign(end - rest)) agree++;
        }
        // he learns as the job goes on, so later looks are read by a model that knows this body
        s = { ...s, model: learnExample(s.model, f, kind) };
        body.run(2500);
      }
    }
    expect(total).toBeGreaterThan(40);
    expect(agree / total).toBeGreaterThan(0.85);
  });

  test('blinks and the face wait half a second, breath shape waits three seconds', () => {
    const body = new SimBody({ ...makeSimPlayer('honest', 4), talkProb: 0 }, 4, 30);
    const bl = learnBaseline(body.run(BASELINE_MS));
    const s = step(step(step(newGame(4, 3), { type: 'begin' }), { type: 'baselineDone', baseline: bl }), { type: 'practiceDone', peeks: [] });
    body.run(PEEK_LEAD_MS); body.react('trap');
    const frames = body.run(PEEK_MS);
    const t0 = frames[0]!.t;
    const upTo = (ms: number) => frames.filter((f) => f.t - t0 <= ms);
    const early = liveRead(upTo(LIVE_FACE_FROM_MS - 50), bl, s.model, bankerView(s)).partial;
    expect(early.blinkBurst).toBe(0);
    expect(Object.keys(early.exprDelta)).toHaveLength(0);
    const mid = liveRead(upTo(LIVE_BREATH_FROM_MS - 50), bl, s.model, bankerView(s)).partial;
    expect(mid.shallowing).toBe(0);
    expect(mid.rateChange).toBe(0);
    expect(Object.keys(mid.exprDelta).length).toBeGreaterThan(0);
  });

  test('a blink barely moves a fresh Fence and moves him a lot once blinking is your tell', () => {
    const calm: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1 };
    let tell = emptyModel(3);
    for (let i = 0; i < 4; i++) {
      tell = learnExample(tell, { ...calm, blinkBurst: 2.2 }, 'trap');
      tell = learnExample(tell, calm, 'small');
    }
    const blinky: PeekFeatures = { ...calm, blinkBurst: 1.5 };
    const lift = (m: typeof tell): number => (evidence(m, blinky)[3] as number) - (evidence(m, calm)[3] as number);
    expect(lift(emptyModel(3))).toBeGreaterThan(0);
    expect(lift(tell)).toBeGreaterThan(2 * lift(emptyModel(3)));
    // the Fence on First Job cannot read blinks at all
    expect(lift(emptyModel(1))).toBe(0);
  });
});
