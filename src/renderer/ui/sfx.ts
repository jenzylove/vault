/**
 * Game sounds, synthesized with WebAudio (no files): dial clicks while a safe is cracked, the door
 * clunk, coins on a payout and a short alarm sting on a bust. Silent while muted (M).
 */
import { isMuted } from './speech';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (isMuted()) return null;
  try {
    if (!ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(ctx.destination);
    }
    void ctx.resume().catch(() => undefined);
    return { ctx, out: out as GainNode };
  } catch { return null; }
}

function noise(c: AudioContext, secs: number): AudioBuffer {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * secs)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** One short metallic tick at time t. */
function tick(c: AudioContext, o: AudioNode, t: number, freq: number, gain: number): void {
  const src = c.createBufferSource();
  src.buffer = noise(c, 0.03);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 9;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(bp); bp.connect(g); g.connect(o);
  src.start(t); src.stop(t + 0.04);
}

/** Dial clicks: a run of ticks, then a deeper click as the last number falls. */
export function dialClicks(n = 7, overMs = 900): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    const jitter = (Math.random() - 0.5) * 0.03;
    tick(a.ctx, a.out, t0 + (i * overMs) / 1000 / n + jitter, 3200 + Math.random() * 900, 0.5);
  }
  tick(a.ctx, a.out, t0 + overMs / 1000, 1400, 0.9);
}

/** The heavy door: a low thump with a metal ring. */
export function doorClunk(delayMs = 0): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.02 + delayMs / 1000;
  const osc = a.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc.connect(g); g.connect(a.out);
  osc.start(t); osc.stop(t + 0.4);
  const ring = a.ctx.createOscillator();
  ring.type = 'triangle'; ring.frequency.value = 620;
  const rg = a.ctx.createGain();
  rg.gain.setValueAtTime(0.08, t);
  rg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  ring.connect(rg); rg.connect(a.out);
  ring.start(t); ring.stop(t + 0.55);
  tick(a.ctx, a.out, t, 900, 0.8);
}

/** Coins: bright pings, more of them for more cash. */
export function coins(amount: number): void {
  const a = audio(); if (!a) return;
  const n = Math.max(3, Math.min(14, Math.round(Math.log2(Math.max(2, amount / 40)) * 2)));
  const t0 = a.ctx.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 0.055 + Math.random() * 0.03;
    for (const f of [2600 + Math.random() * 1400, 4100 + Math.random() * 900]) {
      const o = a.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(a.out);
      o.start(t); o.stop(t + 0.2);
    }
  }
}

/** Alarm sting: two short sweeping bursts. */
export function alarm(): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02;
  for (let i = 0; i < 2; i++) {
    const t = t0 + i * 0.28;
    const o = a.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t);
    o.frequency.linearRampToValueAtTime(620, t + 0.22);
    const lp = a.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(lp); lp.connect(g); g.connect(a.out);
    o.start(t); o.stop(t + 0.26);
  }
}
