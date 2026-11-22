/**
 * Game sounds, synthesized with WebAudio (no files): dial clicks while a safe is cracked, the door
 * clunk and creak, a chime or a sting when the contents land, the offer ticking down, coins on a payout,
 * a drum roll before his last call and a short alarm sting on a strike. Silent while muted (M).
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
export function dialClicks(n = 7, overMs = 900, delayMs = 0): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02 + delayMs / 1000;
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

/** The door creaks open: a slow, rough groan that rises, then a short scrape as it swings wide. */
export function doorCreak(delayMs = 0, durMs = 560): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.02 + delayMs / 1000;
  const d = durMs / 1000;
  const o = a.ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, t);
  o.frequency.linearRampToValueAtTime(115, t + d * 0.55);
  o.frequency.linearRampToValueAtTime(92, t + d);
  // the stick and slip of a dry hinge
  const lfo = a.ctx.createOscillator();
  lfo.type = 'square'; lfo.frequency.value = 23;
  const lg = a.ctx.createGain(); lg.gain.value = 14;
  lfo.connect(lg); lg.connect(o.frequency);
  const bp = a.ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 3;
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
  g.gain.setValueAtTime(0.16, t + d * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(bp); bp.connect(g); g.connect(a.out);
  o.start(t); o.stop(t + d + 0.05); lfo.start(t); lfo.stop(t + d + 0.05);
}

/** Loot lands: a bright little bell run, higher and longer for gold. */
export function lootChime(big = false): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02;
  const notes = big ? [784, 988, 1175, 1568, 1976] : [880, 1109, 1319, 1760];
  notes.forEach((f, i) => {
    const t = t0 + i * 0.07;
    for (const [mul, vol] of [[1, 0.16], [2.01, 0.05]] as const) {
      const o = a.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * mul;
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + i * 0.05);
      o.connect(g); g.connect(a.out);
      o.start(t); o.stop(t + 0.6 + i * 0.05);
    }
  });
}

/** A dud lands: a low sour stab that sags. */
export function dudSting(): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.02;
  for (const f of [155, 164]) {
    const o = a.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.78, t + 0.55);
    const lp = a.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.55);
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(lp); lp.connect(g); g.connect(a.out);
    o.start(t); o.stop(t + 0.65);
  }
}

/** One tick of his offer running down; sharper in the last seconds. */
export function offerTick(urgent = false): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.01;
  tick(a.ctx, a.out, t, urgent ? 2600 : 1800, urgent ? 0.8 : 0.55);
  if (urgent) tick(a.ctx, a.out, t + 0.07, 2000, 0.4);
}

/** A soft drum roll while he makes up his mind. */
export function drumRoll(ms = 1500): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02;
  const end = ms / 1000;
  let t = 0, gap = 0.09;
  while (t < end) {
    const src = a.ctx.createBufferSource();
    src.buffer = noise(a.ctx, 0.06);
    const bp = a.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = a.ctx.createGain();
    const vol = 0.05 + 0.2 * (t / end);
    g.gain.setValueAtTime(vol, t0 + t);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + t + 0.05);
    src.connect(bp); bp.connect(g); g.connect(a.out);
    src.start(t0 + t); src.stop(t0 + t + 0.06);
    t += gap; gap = Math.max(0.035, gap * 0.93);
  }
}

/** A short low hit under a big call. */
export function hit(): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.02;
  const o = a.ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(g); g.connect(a.out);
  o.start(t); o.stop(t + 0.55);
}
