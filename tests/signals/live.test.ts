import { describe, expect, it } from 'vitest';
import { LiveSource, METRIC_TIERS } from '../../src/renderer/signals/live';
import type { SignalFrame } from '../../src/renderer/signals/types';
import { chestMetrics, fakeDeps, flush } from './fakeSdk';

const setup = () => {
  const clock = { t: 1000 };
  const deps = fakeDeps(clock);
  const src = new LiveSource('test-key', deps);
  const frames: SignalFrame[] = [];
  src.subscribe((f) => frames.push(f));
  const sdk = () => deps.made[deps.made.length - 1]!;
  return { clock, deps, src, frames, sdk };
};

describe('LiveSource on a mocked SDK', () => {
  it('asks for breathing, cardio and face metrics 12, 13, 14 but never landmarks (11)', async () => {
    const { src, sdk } = setup();
    await src.start();
    expect(sdk().opts.apiKey).toBe('test-key');
    expect(sdk().opts.requestedMetrics).toEqual([0, 1, 2, 15, 16, 17, 12, 13, 14]);
    expect(sdk().opts.requestedMetrics).not.toContain(11);
    await src.stop();
  });

  it('exposes processing status, validation code and hint, and the camera stream', async () => {
    const { src, sdk, clock } = setup();
    const seen: string[] = [];
    src.onStatus((s) => seen.push(s.processing));
    await src.start();
    const stream = { id: 'cam' } as unknown as MediaStream;
    sdk().emit('streamAvailable', stream);
    sdk().emit('processingStatus', 3);
    clock.t = 1234;
    sdk().emit('validationStatus', 7, 0, 'Chest not visible');
    const st = src.status();
    expect(st.stream).toBe(stream);
    expect(st.processing).toBe('running');
    expect(st.validation).toEqual({ code: 7, hint: 'Chest not visible', at: 1234 });
    expect(seen).toContain('starting');
    await src.stop();
    expect(src.status().stream).toBeNull();
    expect(src.status().processing).toBe('idle');
  });

  it('turns metrics into frames and keeps time running forward across sessions', async () => {
    const { src, sdk, frames } = setup();
    await src.start();
    sdk().emit('metrics', chestMetrics([5_000_000, 5_033_000]), 5_000_000);
    sdk().emit('metrics', chestMetrics([5_033_000, 5_066_000]), 5_066_000); // repeat sample is skipped
    expect(frames.map((f) => f.t)).toEqual([0, 33, 66]);
    expect(frames.every((f) => typeof f.chest === 'number')).toBe(true);
    await src.stop();
    await src.start();
    sdk().emit('metrics', chestMetrics([1_000]), 1_000);
    expect(frames[frames.length - 1]!.t).toBeGreaterThan(66);
    await src.stop();
  });

  it('stop ends the SDK session: stop then destroy', async () => {
    const { src, sdk } = setup();
    await src.start();
    const s = sdk();
    expect(s.live).toBe(true);
    await src.stop();
    expect(s.stopped).toBe(1);
    expect(s.destroyed).toBe(true);
  });

  it('a network error retries once, then ends the session for good', async () => {
    const { src, deps, sdk } = setup();
    await src.start();
    const first = sdk();
    first.emit('error', 5, 'network down', true);
    await flush(); await flush();
    expect(first.destroyed).toBe(true);
    expect(deps.made.length).toBe(2);
    const second = sdk();
    expect(second.started).toBe(1);
    expect(src.status().error).toBeNull();
    second.emit('error', 5, 'network down again', true);
    await flush(); await flush();
    expect(deps.made.length).toBe(2);
    expect(second.destroyed).toBe(true);
    expect(src.status().processing).toBe('error');
    expect(src.status().error?.code).toBe(5);
    expect(deps.made.some((s) => s.live)).toBe(false);
  });

  it('frame rate too low (14) ends the session and tells the player to close other apps', async () => {
    const { src, sdk } = setup();
    await src.start();
    sdk().emit('error', 14, 'sustained low frame rate', false);
    await flush();
    expect(sdk().destroyed).toBe(true);
    expect(src.status().error?.say).toMatch(/close other apps/i);
    expect(src.status().error?.say).not.toMatch(/[-–—]/);
  });

  it('a metric not authorized error steps down to fewer metrics and starts again', async () => {
    const { src, deps, sdk } = setup();
    await src.start();
    sdk().emit('error', 13, 'metric not authorized', false);
    await flush(); await flush();
    expect(deps.made.length).toBe(2);
    expect(sdk().opts.requestedMetrics).toEqual(METRIC_TIERS[1]);
    expect(src.metricTier).toBe(1);
    await src.stop();
  });

  it('a rejected start (bad key) rejects with plain words and leaves no session', async () => {
    const clock = { t: 0 };
    const deps = fakeDeps(clock, (s) => { s.startImpl = async () => { throw Object.assign(new Error('auth'), { code: 2, retryable: false }); }; });
    const src = new LiveSource('bad', deps);
    await expect(src.start()).rejects.toThrow(/did not accept that key/);
    expect(deps.made[0]!.destroyed).toBe(true);
    expect(src.status().processing).toBe('error');
  });

  it('a network failure while starting retries once and start resolves on the retry', async () => {
    const clock = { t: 0 };
    let n = 0;
    const deps = fakeDeps(clock, (s) => { if (n++ === 0) s.startImpl = async () => { throw Object.assign(new Error('net'), { code: 5, retryable: true }); }; });
    const src = new LiveSource('k', deps);
    await src.start();
    expect(deps.made.length).toBe(2);
    expect(deps.made[0]!.destroyed).toBe(true);
    expect(deps.made[1]!.live).toBe(true);
    await src.stop();
    expect(deps.made[1]!.destroyed).toBe(true);
  });

  it('a stop during a pending start waits for it, so no session is orphaned', async () => {
    const clock = { t: 0 };
    let release!: () => void;
    const deps = fakeDeps(clock, (s) => { s.startImpl = () => new Promise<void>((r) => { release = r; }); });
    const src = new LiveSource('k', deps);
    const started = src.start();
    const stopped = src.stop();
    await flush();
    expect(deps.made[0]!.stopped).toBe(0);
    release();
    await started; await stopped;
    expect(deps.made[0]!.stopped).toBe(1);
    expect(deps.made[0]!.destroyed).toBe(true);
  });

  it('processing status error without an error event still ends the session', async () => {
    const { src, sdk } = setup();
    await src.start();
    sdk().emit('processingStatus', 5);
    await new Promise((r) => setTimeout(r, 450));
    expect(sdk().destroyed).toBe(true);
    expect(src.status().processing).toBe('error');
  });

  it('events from a stopped session are ignored', async () => {
    const { src, sdk, frames } = setup();
    await src.start();
    const old = sdk();
    await src.stop();
    old.emit('metrics', chestMetrics([1]), 1);
    old.emit('error', 14, 'late', false);
    await flush();
    expect(frames.length).toBe(0);
    expect(src.status().error).toBeNull();
  });
});
