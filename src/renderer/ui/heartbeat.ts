/**
 * A low synthesized heartbeat (lub dub) that follows the player's own pulse. No samples: each beat is two
 * short sine thumps with a falling pitch, through a low pass, so it reads as felt more than heard.
 *
 *   const hb = new Heartbeat();
 *   hb.start();            // call from a user gesture (AudioContext autoplay rules)
 *   hb.setBpm(72);         // null = no pulse yet: silent
 *   hb.setLevel(alert);    // 0..1: quiet by default, louder as the banker grows suspicious
 *   hb.muted = true;       // the M voice toggle
 *   hb.stop();
 *
 * Or from React: useHeartbeat({ bpm, level, muted, enabled }).
 */
import { useEffect, useRef } from 'react';

const LOOKAHEAD_S = 0.15;
const TICK_MS = 40;
/** master gain at level 0 and level 1 */
const QUIET = 0.1;
const LOUD = 0.55;

type Ctx = AudioContext;

function makeContext(): Ctx | null {
  const C = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try { return new C(); } catch { return null; }
}

export class Heartbeat {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextAt = 0;
  private bpm: number | null = null;
  private level = 0;
  private _muted = false;
  private running = false;

  get muted(): boolean { return this._muted; }
  set muted(m: boolean) { this._muted = m; this.applyGain(); }
  get playing(): boolean { return this.running; }

  /** Beats per minute from the live pulse; null (or not finite) means no pulse yet, so it stays silent. */
  setBpm(bpm: number | null): void {
    const ok = typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0;
    const was = this.bpm;
    this.bpm = ok ? Math.max(40, Math.min(180, bpm)) : null;
    // first pulse after silence: start on the next tick, not after a stale gap
    if (was == null && this.bpm != null && this.ctx) this.nextAt = this.ctx.currentTime + 0.05;
    this.applyGain();
  }

  /** 0..1 loudness: quiet at 0, clearly present at 1. Eased, so it never jumps. */
  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    this.applyGain();
  }

  /** Create the audio graph and begin scheduling. Safe to call twice; a no-op where WebAudio is missing. */
  start(): void {
    if (this.running) return;
    if (!this.ctx) {
      this.ctx = makeContext();
      if (!this.ctx) return;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.7;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(lp); lp.connect(this.ctx.destination);
    }
    void this.ctx.resume().catch(() => undefined);
    this.running = true;
    this.nextAt = this.ctx.currentTime + 0.1;
    this.applyGain();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  /** Stop scheduling and fade out. The context is kept for a later start(); dispose() frees it. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.applyGain();
  }

  dispose(): void {
    this.stop();
    const c = this.ctx; this.ctx = null; this.master = null;
    if (c) void c.close().catch(() => undefined);
  }

  private target(): number {
    if (!this.running || this._muted || this.bpm == null) return 0;
    return QUIET + (LOUD - QUIET) * this.level * this.level;
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    const g = this.master.gain; const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.target(), now, 0.25);
  }

  private schedule(): void {
    const ctx = this.ctx; if (!ctx || !this.master) return;
    if (this.bpm == null) { this.nextAt = Math.max(this.nextAt, ctx.currentTime); return; }
    const period = 60 / this.bpm;
    // fell behind (tab hidden, long frame): skip ahead instead of playing a burst of missed beats
    if (this.nextAt < ctx.currentTime - period) this.nextAt = ctx.currentTime + 0.05;
    while (this.nextAt < ctx.currentTime + LOOKAHEAD_S) {
      const t = Math.max(this.nextAt, ctx.currentTime);
      // lub, then the softer, slightly higher dub; the gap tightens a little as the pulse quickens
      this.thump(t, 62, 44, 1.0, 0.13);
      this.thump(t + Math.min(0.32, period * 0.3), 74, 52, 0.62, 0.1);
      this.nextAt += period;
    }
  }

  private thump(t: number, f0: number, f1: number, amp: number, dur: number): void {
    const ctx = this.ctx!; const out = this.master!;
    // the fundamental is felt; a quiet second partial lets laptop speakers (no real bass) still carry it
    for (const [mul, a] of [[1, amp], [2.05, amp * 0.32]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0 * mul, t);
      osc.frequency.exponentialRampToValueAtTime(f1 * mul, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + dur + 0.02);
      osc.onended = () => { osc.disconnect(); g.disconnect(); };
    }
  }
}

/**
 * React wrapper: one Heartbeat for the component's life. `enabled` starts/stops it (start needs a prior user
 * gesture somewhere on the page for audio to be heard). bpm null = silent until a pulse arrives.
 */
export function useHeartbeat({ bpm, level, muted, enabled }: { bpm: number | null; level: number; muted: boolean; enabled: boolean }): Heartbeat {
  const ref = useRef<Heartbeat | null>(null);
  if (!ref.current) ref.current = new Heartbeat();
  const hb = ref.current;
  useEffect(() => () => hb.dispose(), [hb]);
  useEffect(() => { if (enabled) hb.start(); else hb.stop(); }, [hb, enabled]);
  useEffect(() => { hb.setBpm(bpm); }, [hb, bpm]);
  useEffect(() => { hb.setLevel(level); }, [hb, level]);
  useEffect(() => { hb.muted = muted; }, [hb, muted]);
  return hb;
}
