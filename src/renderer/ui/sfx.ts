/**
 * Game sounds, synthesized with WebAudio (no files): dial clicks while a safe is cracked, the heavy door
 * clunk and creak, a hit and a chime or a sour stab when the contents land, the offer ticking down, a cash
 * payout, a drum roll before his last call and an alarm bell on a strike. They play on the shared bus
 * (audioBus.ts) next to the music. Silent while muted (M).
 */
import { audioBus } from './audioBus';

interface A { ctx: AudioContext; out: AudioNode }

function audio(): A | null {
  const b = audioBus();
  return b ? { ctx: b.ctx, out: b.sfx } : null;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
/** A second of white noise per context, reused at random offsets. */
function noiseBuf(c: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}

function noise(c: BaseAudioContext, t: number, dur: number): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  src.start(t, Math.random() * Math.max(0, 1 - dur), dur);
  return src;
}

/** A gain that rises to `peak` in `attack` and dies away over `decay`. */
function env(c: BaseAudioContext, dest: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

function sine(c: BaseAudioContext, dest: AudioNode, t: number, f: number, peak: number, decay: number, type: OscillatorType = 'sine'): void {
  const o = c.createOscillator();
  o.type = type; o.frequency.value = f;
  o.connect(env(c, dest, t, peak, 0.002, decay));
  o.start(t); o.stop(t + decay + 0.05);
}

/** One hard metal tick at time t: a crack of bright noise with a tiny ring at `freq`. */
function tick(c: BaseAudioContext, o: AudioNode, t: number, freq: number, gain: number): void {
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 14;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1200;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
  noise(c, t, 0.03).connect(hp); hp.connect(bp); bp.connect(g); g.connect(o);
  sine(c, o, t, freq * 1.52, gain * 0.12, 0.03);
}

/** A low thump: a falling sine with a burst of dark noise. */
function thump(c: BaseAudioContext, o: AudioNode, t: number, f0: number, f1: number, gain: number, decay: number): void {
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.7);
  osc.connect(env(c, o, t, gain, 0.003, decay));
  osc.start(t); osc.stop(t + decay + 0.05);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 380;
  noise(c, t, 0.2).connect(lp); lp.connect(env(c, o, t, gain * 0.7, 0.002, 0.16));
}

/** Dial clicks: a run of crisp detent ticks, then a deeper tock as the last number falls. */
export function dialClicks(n = 7, overMs = 900, delayMs = 0): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02 + delayMs / 1000;
  for (let i = 0; i < n; i++) {
    const jitter = (Math.random() - 0.5) * 0.025;
    const t = t0 + (i * overMs) / 1000 / n + jitter;
    tick(a.ctx, a.out, t, i % 2 ? 4300 : 3700, 0.55);
    // the tumbler behind it: a soft body under each tick
    sine(a.ctx, a.out, t, 820, 0.06, 0.02, 'triangle');
  }
  const t = t0 + overMs / 1000;
  tick(a.ctx, a.out, t, 1500, 0.95);
  thump(a.ctx, a.out, t, 240, 120, 0.25, 0.09);
}

/** The heavy door: bolts give, a deep thud you feel, and the steel rings. */
export function doorClunk(delayMs = 0): void {
  const a = audio(); if (!a) return;
  const c = a.ctx; const o = a.out;
  const t = c.currentTime + 0.02 + delayMs / 1000;
  // the latch
  tick(c, o, t, 1100, 0.9);
  tick(c, o, t + 0.018, 2300, 0.5);
  // the weight of the door
  thump(c, o, t + 0.01, 95, 36, 1.0, 0.55);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
  noise(c, t + 0.01, 0.25).connect(lp); lp.connect(env(c, o, t + 0.01, 0.55, 0.004, 0.2));
  // big steel: a few inharmonic partials ringing out
  for (const [f, g, d] of [[187, 0.06, 0.9], [431, 0.045, 0.7], [829, 0.03, 0.5], [1312, 0.02, 0.35]] as const) {
    sine(c, o, t + 0.012, f, g, d, 'triangle');
  }
}

/** Cash: a register drawer, a bell, and coins spilling, more of them for more cash. */
export function coins(amount: number): void {
  const a = audio(); if (!a) return;
  const c = a.ctx; const o = a.out;
  const t0 = c.currentTime + 0.02;
  // the drawer
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.4;
  noise(c, t0, 0.09).connect(bp); bp.connect(env(c, o, t0, 0.35, 0.003, 0.08));
  thump(c, o, t0, 160, 80, 0.35, 0.12);
  // the bell
  for (const [f, g] of [[2093, 0.13], [2637, 0.1], [2093 * 2.76, 0.03]] as const) sine(c, o, t0 + 0.05, f, g, 0.9);
  // the coins: inharmonic pings that pour faster, then settle
  const n = Math.max(4, Math.min(18, Math.round(Math.log2(Math.max(2, amount / 30)) * 2.4)));
  let t = t0 + 0.12; let gap = 0.075;
  for (let i = 0; i < n; i++) {
    const f = 3000 + Math.random() * 2400;
    const g = 0.05 + Math.random() * 0.07;
    for (const [mul, k] of [[1, 1], [1.47, 0.6], [2.09, 0.35]] as const) sine(c, o, t, f * mul, g * k, 0.09 + Math.random() * 0.16);
    t += gap * (0.6 + Math.random() * 0.8);
    gap = Math.max(0.03, gap * 0.9);
  }
}

/** Alarm: an old vault bell, hammering, under two rising sweeps. */
export function alarm(): void {
  const a = audio(); if (!a) return;
  const c = a.ctx; const o = a.out;
  const t0 = c.currentTime + 0.02;
  const dur = 1.0;
  // the bell: partials chopped by the hammer
  const bell = c.createGain(); bell.gain.value = 0.5;
  const hammer = c.createOscillator(); hammer.type = 'square'; hammer.frequency.value = 19;
  const depth = c.createGain(); depth.gain.value = 0.5;
  hammer.connect(depth); depth.connect(bell.gain);
  const out = env(c, o, t0, 0.22, 0.01, dur);
  bell.connect(out);
  for (const [f, g] of [[1046, 1], [2632, 0.5], [4110, 0.25]] as const) {
    const s = c.createOscillator(); s.frequency.value = f;
    const sg = c.createGain(); sg.gain.value = g;
    s.connect(sg); sg.connect(bell);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }
  hammer.start(t0); hammer.stop(t0 + dur + 0.05);
  for (let i = 0; i < 2; i++) {
    const t = t0 + i * 0.3;
    const sw = c.createOscillator();
    sw.type = 'square';
    sw.frequency.setValueAtTime(620, t);
    sw.frequency.linearRampToValueAtTime(900, t + 0.24);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    sw.connect(lp); lp.connect(env(c, o, t, 0.11, 0.02, 0.24));
    sw.start(t); sw.stop(t + 0.3);
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

/** The reveal hit under whatever is inside: a deep thud and a bright air burst. */
function impact(c: BaseAudioContext, o: AudioNode, t: number, gain: number): void {
  thump(c, o, t, 120, 34, gain, 0.7);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
  noise(c, t, 0.35).connect(hp); hp.connect(env(c, o, t, gain * 0.12, 0.004, 0.3));
}

/** Full safe: a hit, then a bright bell run, higher and longer for gold. */
export function lootChime(big = false): void {
  const a = audio(); if (!a) return;
  const t0 = a.ctx.currentTime + 0.02;
  impact(a.ctx, a.out, t0, big ? 0.95 : 0.75);
  const notes = big ? [784, 988, 1175, 1568, 1976] : [880, 1109, 1319, 1760];
  notes.forEach((f, i) => {
    const t = t0 + 0.03 + i * 0.07;
    for (const [mul, vol] of [[1, 0.16], [2.01, 0.05]] as const) sine(a.ctx, a.out, t, f * mul, vol, 0.5 + i * 0.05);
  });
}

/** Empty safe: a hit, then a low sour stab that sags. */
export function dudSting(): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.02;
  impact(a.ctx, a.out, t, 0.8);
  for (const f of [155, 164]) {
    const o = a.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.78, t + 0.55);
    const lp = a.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.55);
    o.connect(lp); lp.connect(env(a.ctx, a.out, t, 0.14, 0.015, 0.6));
    o.start(t); o.stop(t + 0.65);
  }
}

/** One tick of his offer running down; a tick and a tock, sharper in the last seconds. */
export function offerTick(urgent = false): void {
  const a = audio(); if (!a) return;
  const t = a.ctx.currentTime + 0.01;
  tick(a.ctx, a.out, t, urgent ? 2800 : 1900, urgent ? 0.9 : 0.6);
  sine(a.ctx, a.out, t, urgent ? 1400 : 1000, urgent ? 0.12 : 0.08, 0.04, 'triangle');
  if (urgent) tick(a.ctx, a.out, t + 0.08, 2100, 0.5);
}

/** A snare roll while he makes up his mind, building to his call. */
export function drumRoll(ms = 1500): void {
  const a = audio(); if (!a) return;
  const c = a.ctx;
  const t0 = c.currentTime + 0.02;
  const end = ms / 1000;
  let t = 0, gap = 0.09;
  while (t < end) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const vol = 0.05 + 0.22 * (t / end) ** 1.4;
    noise(c, t0 + t, 0.06).connect(bp); bp.connect(env(c, a.out, t0 + t, vol, 0.002, 0.05));
    sine(c, a.out, t0 + t, 190, vol * 0.25, 0.04, 'triangle');
    t += gap; gap = Math.max(0.035, gap * 0.93);
  }
}

/** A short low hit under a big call. */
export function hit(): void {
  const a = audio(); if (!a) return;
  const c = a.ctx;
  const t = c.currentTime + 0.02;
  thump(c, a.out, t, 160, 38, 0.95, 0.55);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.9;
  noise(c, t, 0.15).connect(bp); bp.connect(env(c, a.out, t, 0.3, 0.002, 0.12));
}
