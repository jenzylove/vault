import { describe, expect, it } from 'vitest';
import { LiveSource } from '../../src/renderer/signals/live';
import { FaceWatch, GapWatch, LineupGate, wireGate } from '../../src/renderer/signals/lineup';
import { noDashes, validationWords } from '../../src/renderer/signals/status';
import { SimulatedSource } from '../../src/renderer/ui/simSource';
import { chestMetrics, fakeDeps } from './fakeSdk';

/** A live source on a mocked SDK with a gate wired to it, sharing one fake clock. */
async function rig() {
  const clock = { t: 10_000 };
  const deps = fakeDeps(clock);
  const src = new LiveSource('k', deps);
  await src.start();
  const sdk = deps.made[0]!;
  sdk.emit('processingStatus', 3);
  const gate = new LineupGate();
  wireGate(src, gate, () => clock.t);
  let us = 1_000_000;
  /** Advance the clock, delivering one metrics batch of chest samples every `every` ms. */
  const run = (ms: number, every = 500, chest = true, repeat?: number) => {
    const end = clock.t + ms;
    while (clock.t + every <= end) {
      clock.t += every;
      us += every * 1000;
      if (repeat !== undefined) sdk.emit('validationStatus', repeat, us, '');
      if (chest) sdk.emit('metrics', chestMetrics([us - 30_000, us]), us);
    }
    clock.t = end;
  };
  const say = (code: number, hint = '') => sdk.emit('validationStatus', code, us, hint);
  return { clock, sdk, src, gate, run, say };
}

describe('lineup gate on a mocked SDK', () => {
  it('holds while the SDK reports a problem, even with chest samples flowing', async () => {
    const { gate, run, say, clock } = await rig();
    say(7, 'Chest not visible');
    run(5000, 250, true, 7);   // the SDK repeats a problem code while it lasts
    const r = gate.check(clock.t);
    expect(r.ready).toBe(false);
    expect(r.waiting).toBe('validation');
    expect(r.code).toBe(7);
  });

  it('opens only after about 2 s with no validation problem and steady chest samples', async () => {
    const { gate, run, say, clock } = await rig();
    say(1, 'No face found');
    run(1000);
    say(0);
    run(1500);
    expect(gate.check(clock.t).ready).toBe(false);
    expect(gate.check(clock.t).progress).toBeGreaterThan(0.5);
    run(600);
    expect(gate.check(clock.t).ready).toBe(true);
  });

  it('a validation problem mid lineup resets the 2 s clock', async () => {
    const { gate, run, say, clock } = await rig();
    say(0);
    run(1800);
    say(5, 'Increase light on face');
    run(200);
    say(0);
    run(1500);
    expect(gate.check(clock.t).ready).toBe(false);
    run(600);
    expect(gate.check(clock.t).ready).toBe(true);
  });

  it('waits for chest samples when the picture is fine but no breathing arrives', async () => {
    const { gate, run, say, clock } = await rig();
    say(0);
    run(4000, 500, false);
    const r = gate.check(clock.t);
    expect(r.ready).toBe(false);
    expect(r.waiting).toBe('chest');
  });

  it('a break in chest samples longer than 2.5 s closes the gate again', async () => {
    const { gate, run, say, clock } = await rig();
    say(0);
    run(3000);
    expect(gate.check(clock.t).ready).toBe(true);
    run(3000, 500, false);
    expect(gate.check(clock.t).ready).toBe(false);
    run(1000);
    expect(gate.check(clock.t).ready).toBe(false);
    run(1500);
    expect(gate.check(clock.t).ready).toBe(true);
  });

  it('passes on steady chest samples when the SDK never sends a validation packet', async () => {
    const { gate, run, clock } = await rig();
    run(2600);
    expect(gate.check(clock.t).ready).toBe(true);
  });

  it('opens once a problem code stops repeating, even if the SDK never sends an OK packet', async () => {
    const { gate, run, clock } = await rig();
    run(2000, 250, true, 7);
    expect(gate.check(clock.t).ready).toBe(false);
    run(1000);
    expect(gate.check(clock.t).ready).toBe(false);   // under 2 s since the last problem packet
    run(1200);
    expect(gate.check(clock.t).ready).toBe(true);
  });

  it('closes when the session stops', async () => {
    const { gate, run, say, clock, src } = await rig();
    say(0);
    run(3000);
    await src.stop();
    expect(gate.check(clock.t).ready).toBe(false);
  });
});

describe('face pause from SDK validation codes', () => {
  async function faceRig() {
    const clock = { t: 0 };
    const deps = fakeDeps(clock);
    const src = new LiveSource('k', deps);
    await src.start();
    const w = new FaceWatch();
    src.onStatus((s) => { if (s.validation) w.validation(s.validation.code, s.validation.at); });
    const at = (t: number, code: number) => { clock.t = t; deps.made[0]!.emit('validationStatus', code, t * 1000, ''); };
    return { w, at };
  }

  it('ignores a face gap under 5 s, pauses after it, and resumes once the face is back for a second', async () => {
    const { w, at } = await faceRig();
    at(0, 0);
    for (let t = 1000; t <= 6000; t += 200) at(t, 1);
    expect(w.check(1800)).toBeNull();     // a short dropout never pauses
    expect(w.check(5500)).toBeNull();     // still under 5 s
    expect(w.check(6000)).toBe('none');
    at(7000, 0);
    expect(w.check(7500)).toBe('none');   // still paused
    expect(w.check(8000)).toBeNull();
  });

  it('a 4 s gap that clears by itself never pauses', async () => {
    const { w, at } = await faceRig();
    for (let t = 0; t <= 4000; t += 100) { at(t, 1); expect(w.check(t)).toBeNull(); }
    at(4100, 0);
    for (let t = 4100; t <= 9000; t += 100) expect(w.check(t)).toBeNull();
  });

  it('resumes when the no face code stops repeating, with no OK packet ever sent', async () => {
    const { w, at } = await faceRig();
    for (let t = 0; t <= 6000; t += 100) at(t, 1);
    expect(w.check(6000)).toBe('none');
    expect(w.check(6900)).toBe('none');   // code only 0.9 s quiet
    expect(w.check(7100)).toBe('none');   // cleared at 7000, needs a second of calm
    expect(w.check(8100)).toBeNull();
  });

  it('pauses on multiple faces, and switches the reason while paused', async () => {
    const { w, at } = await faceRig();
    for (let t = 0; t <= 5000; t += 200) at(t, 2);
    expect(w.check(5000)).toBe('many');
    at(5100, 1);
    expect(w.check(5200)).toBe('none');
    at(6000, 0);
    expect(w.check(7100)).toBeNull();
  });

  it('other validation codes (dark, chest hidden) never pause the round', async () => {
    const { w, at } = await faceRig();
    at(0, 5);
    at(1000, 7);
    at(2000, 16);
    expect(w.check(5000)).toBeNull();
  });
});

describe('signal gap pause', () => {
  it('ignores gaps under 5 s, pauses after, resumes after a clear second', () => {
    const g = new GapWatch();
    expect(g.update(true, 0)).toBe(false);
    expect(g.update(true, 4900)).toBe(false);
    expect(g.update(false, 4950)).toBe(false); // cleared: the clock starts over
    expect(g.update(true, 5000)).toBe(false);
    expect(g.update(true, 9999)).toBe(false);
    expect(g.update(true, 10000)).toBe(true);
    expect(g.update(false, 10500)).toBe(true);
    expect(g.update(true, 10600)).toBe(true);  // a flicker while paused keeps it paused
    expect(g.update(false, 10700)).toBe(true);
    expect(g.update(false, 11700)).toBe(false);
  });
});

describe('player facing words', () => {
  it('maps the known codes to plain words and passes any other hint through without dashes', () => {
    expect(validationWords(1, 'x').big).toMatch(/no face/i);
    expect(validationWords(5, 'x').big).toMatch(/light/i);
    expect(validationWords(7, 'x').big).toMatch(/chest/i);
    expect(validationWords(16, 'x').big).toMatch(/move up, or tilt the camera down/i);
    expect(validationWords(17, 'Face the camera — look straight ahead').big).toBe('Face the camera, look straight ahead');
    expect(noDashes('Too-bright light - move')).toBe('Too bright light, move');
    for (const c of [1, 2, 5, 7, 16]) {
      const w = validationWords(c, '');
      expect(`${w.big} ${w.small ?? ''}`).not.toMatch(/[-–—]/);
    }
  });
});

describe('simulated source status', () => {
  it('reports running and idle, with no stream and no validation', async () => {
    const s = new SimulatedSource(1);
    await s.start();
    expect(s.status()).toMatchObject({ processing: 'running', stream: null, validation: null, error: null });
    await s.stop();
    expect(s.status().processing).toBe('idle');
  });
});
