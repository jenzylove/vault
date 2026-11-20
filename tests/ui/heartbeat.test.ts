import { afterEach, describe, expect, it, vi } from 'vitest';
import { Heartbeat } from '../../src/renderer/ui/heartbeat';
import { flareEnvelope, pushEnvelope } from '../../src/renderer/scene/fx';

// Minimal WebAudio stand in: counts oscillators and records the master gain targets.
class FakeParam { value = 0; targets: number[] = []; setValueAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} setTargetAtTime(v: number) { this.targets.push(v); this.value = v; } }
class FakeNode { connect() {} disconnect() {} }
class FakeCtx {
  static oscs = 0;
  currentTime = 0;
  destination = new FakeNode();
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }); }
  createOscillator() { FakeCtx.oscs++; return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), start() {}, stop() {}, onended: null }); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

afterEach(() => { vi.useRealTimers(); delete (globalThis as Record<string, unknown>).AudioContext; FakeCtx.oscs = 0; });

describe('Heartbeat', () => {
  it('is a safe no-op without WebAudio', () => {
    const hb = new Heartbeat();
    expect(() => { hb.start(); hb.setBpm(70); hb.setLevel(1); hb.stop(); hb.dispose(); }).not.toThrow();
    expect(hb.playing).toBe(false);
  });

  it('stays silent until a pulse arrives, follows level, and respects mute', () => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).AudioContext = FakeCtx;
    const hb = new Heartbeat();
    hb.start();
    const master = (hb as unknown as { master: { gain: FakeParam } }).master.gain;
    vi.advanceTimersByTime(200);
    expect(FakeCtx.oscs).toBe(0);
    expect(master.value).toBe(0);
    hb.setBpm(75);
    vi.advanceTimersByTime(100);
    expect(FakeCtx.oscs).toBeGreaterThan(0);
    const quiet = master.value;
    hb.setLevel(1);
    expect(master.value).toBeGreaterThan(quiet);
    hb.muted = true;
    expect(master.value).toBe(0);
    hb.muted = false; hb.setBpm(null);
    expect(master.value).toBe(0);
    hb.dispose();
  });
});

describe('catch envelopes', () => {
  it('flare peaks fast and is gone by ~0.6 s; push eases in and out', () => {
    expect(flareEnvelope(-5)).toBe(0);
    expect(flareEnvelope(40)).toBeCloseTo(1);
    expect(flareEnvelope(600)).toBeLessThan(0.05);
    expect(pushEnvelope(0)).toBe(0);
    expect(pushEnvelope(180)).toBeCloseTo(1);
    expect(pushEnvelope(880)).toBeCloseTo(0);
  });
});
