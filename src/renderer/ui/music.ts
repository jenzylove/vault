/**
 * The heist score: an original groove synthesized live in WebAudio (no samples, no borrowed tunes). A walking
 * upright bass, brushed hats, a low pad, muted vibes and the odd brass stab, in D minor at 94 beats a minute,
 * written fresh every bar from chord tones by a seeded generator. It follows the job:
 *
 *   menu / title   a quiet bed: pad, a slow bass, soft brushes
 *   calm           learning your calm: pad and a low drone, no beat (nothing to breathe along to)
 *   board          the full cool groove while you pick a safe
 *   crack          the dial and the door: the band drops out, the drone comes in
 *   look           near silence: your own heartbeat (heartbeat.ts) and a low drone carry it
 *   offer          it tightens: a pedal bass in eighths, sixteenth hats, the filter opens and a riser climbs
 *                  over his ticking window and stops on your decision
 *   replay         bass, brushes and pad under his verdict
 *   last           the double or nothing choice: a slow pulse, a dark pad
 *   call           his last call: drone only (sfx.ts plays the drum roll and the hit)
 *   bust           low and dark after the alarm
 *
 * Stings land on the moments: sold, kept, passed, caught (with the alarm), bust, last safe won, last safe lost,
 * and no bet (he lost you on the last safe).
 * The bed ducks under his voice (audioBus.ts) and M silences it with everything else.
 */
import { useEffect, useRef } from 'react';
import { audioBus, onGesture } from './audioBus';
import { isMuted } from './speech';
import { OFFER_WINDOW_MS } from '../engine/game';

export type MusicMode =
  | 'off' | 'menu' | 'calm' | 'board' | 'crack' | 'look' | 'offer' | 'replay' | 'last' | 'call' | 'after' | 'reveal' | 'over' | 'bust' | 'paused';
export type StingKind = 'sold' | 'kept' | 'passed' | 'caught' | 'bust' | 'finalWin' | 'finalLoss' | 'noBet';

type BassStyle = 'walk' | 'half' | 'pulse' | 'ostinato' | null;
interface ModeSpec {
  /** overall level of the bed */
  level: number;
  /** low pass on the whole bed, Hz */
  lp: number;
  bass: BassStyle;
  hats: 'swing' | 'tight' | null;
  /** brush slaps on two and four, 0..1 */
  brush: number;
  kick: 'soft' | 'four' | null;
  rim: boolean;
  /** pad level, 0..1 */
  pad: number;
  vibes: number;
  stab: boolean;
  /** drone level, 0..1 */
  drone: number;
  harmony: 'song' | 'pedal' | 'edge';
}

const OFF: ModeSpec = { level: 0, lp: 400, bass: null, hats: null, brush: 0, kick: null, rim: false, pad: 0, vibes: 0, stab: false, drone: 0, harmony: 'song' };
export const MODES: Record<MusicMode, ModeSpec> = {
  off: OFF,
  menu: { ...OFF, level: 0.5, lp: 2400, bass: 'half', brush: 0.5, pad: 0.8, vibes: 0.35 },
  calm: { ...OFF, level: 0.45, lp: 1400, pad: 0.75, drone: 0.45 },
  board: { ...OFF, level: 0.8, lp: 7000, bass: 'walk', hats: 'swing', brush: 1, kick: 'soft', pad: 0.5, vibes: 0.6, stab: true },
  crack: { ...OFF, level: 0.55, lp: 700, pad: 0.25, drone: 0.7 },
  look: { ...OFF, level: 0.55, lp: 420, drone: 1 },
  offer: { ...OFF, level: 0.85, lp: 900, bass: 'ostinato', hats: 'tight', kick: 'four', rim: true, drone: 0.35, harmony: 'pedal' },
  replay: { ...OFF, level: 0.6, lp: 3200, bass: 'walk', brush: 0.7, pad: 0.5 },
  last: { ...OFF, level: 0.7, lp: 1800, bass: 'pulse', pad: 0.75, drone: 0.5, harmony: 'edge' },
  call: { ...OFF, level: 0.5, lp: 380, drone: 0.85, harmony: 'edge' },
  after: { ...OFF, level: 0.45, lp: 2200, pad: 0.55 },
  reveal: { ...OFF, level: 0.55, lp: 4200, bass: 'half', brush: 0.6, pad: 0.5, vibes: 0.5 },
  over: { ...OFF, level: 0.5, lp: 2600, bass: 'half', brush: 0.45, pad: 0.65, vibes: 0.4 },
  bust: { ...OFF, level: 0.4, lp: 700, pad: 0.6, drone: 0.55, harmony: 'edge' },
  paused: { ...OFF, level: 0.3, lp: 800, pad: 0.55, drone: 0.3 },
};

// ---------- music ----------

const BPM = 94;
const S16 = 60 / BPM / 4;
/** the off beat eighth sits this far (in sixteenths) late: a light swing */
const SWING = 0.42;
/** the whole bed into the music bus */
const BED = 0.3;
const OFFER_S = OFFER_WINDOW_MS / 1000;

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Freeze a param where it is now (a running ramp stops there), then let new automation take over. */
function hold(p: AudioParam, at: number): void {
  const h = (p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }).cancelAndHoldAtTime;
  if (typeof h === 'function') h.call(p, at); else p.cancelScheduledValues(at);
}

export interface Chord { root: number; tones: number[] }
// D minor: Dm9 | Dm9 | Bbmaj9 | A7b9 | Gm9 | Ebmaj7#11 | Em7b5 | A7b9
const SONG: Chord[] = [
  { root: 38, tones: [0, 3, 7, 10, 14] },
  { root: 38, tones: [0, 3, 7, 10, 14] },
  { root: 34, tones: [0, 4, 7, 11, 14] },
  { root: 33, tones: [0, 4, 7, 10, 13] },
  { root: 43, tones: [0, 3, 7, 10, 14] },
  { root: 39, tones: [0, 4, 7, 11, 18] },
  { root: 40, tones: [0, 3, 6, 10] },
  { root: 33, tones: [0, 4, 7, 10, 13] },
];
const PEDAL: Chord = { root: 38, tones: [0, 3, 7, 13] };
const EDGE: Chord[] = [{ root: 34, tones: [0, 4, 7, 11, 18] }, { root: 33, tones: [0, 4, 7, 10, 13] }];
/** the offer's bass, in eighths over D: a pedal that leans on the flat second */
const OSTINATO = [0, 0, 12, 0, 1, 0, 12, 1];

function chordFor(bar: number, harmony: ModeSpec['harmony']): Chord {
  if (harmony === 'pedal') return PEDAL;
  if (harmony === 'edge') return EDGE[bar % 2] as Chord;
  return SONG[bar % SONG.length] as Chord;
}

/** Chord tones (no root) placed between D3 and G4: a close, dark voicing. */
function voicing(ch: Chord): number[] {
  return ch.tones.filter((t) => t !== 0).map((t) => {
    let m = ch.root + t;
    while (m < 50) m += 12;
    while (m > 67) m -= 12;
    return m;
  }).sort((a, b) => a - b);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One bar of walking bass, four quarter notes: root, two chord tones, an approach into the next root. */
export function walkBar(ch: Chord, next: Chord, rnd: () => number): number[] {
  const fit = (m: number): number => { while (m < 31) m += 12; while (m > 50) m -= 12; return m; };
  const r = fit(ch.root);
  const nr = fit(next.root);
  const tones = ch.tones.filter((t) => t < 12 && t !== 0).map((t) => r + t);
  const pool = [...tones, r + 12].map(fit);
  const approach = fit(rnd() < 0.65 ? nr + (rnd() < 0.5 ? -1 : 1) : nr + (rnd() < 0.5 ? -2 : 2));
  const b2 = pool[Math.floor(rnd() * pool.length)] as number;
  const near = pool.filter((m) => m !== b2).sort((x, y) => Math.abs(x - approach) - Math.abs(y - approach));
  const b3 = (near[0] ?? b2) === approach ? (near[1] ?? b2) : (near[0] ?? b2);
  return [r, b2, b3, approach];
}

/** A short vibes figure for one bar: a few chord tones up high, on syncopated sixteenths. */
function motif(ch: Chord, rnd: () => number): Map<number, number> {
  const slots = [0, 3, 6, 8, 10, 11, 14].filter(() => rnd() < 0.55).slice(0, 4);
  const tones = [0, ...ch.tones].map((t) => { let m = ch.root + t; while (m < 70) m += 12; while (m > 86) m -= 12; return m; }).sort((a, b) => a - b);
  const out = new Map<number, number>();
  let idx = Math.floor(rnd() * tones.length);
  for (const s of slots) {
    idx = Math.max(0, Math.min(tones.length - 1, idx + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.7 ? 1 : 2)));
    out.set(s, tones[idx] as number);
  }
  return out;
}

/** The live score. Works on any BaseAudioContext, so it can be rendered offline too. */
export class HeistMusic {
  readonly ctx: BaseAudioContext;
  private mode: MusicMode = 'off';
  private stepNo = 0;
  private nextT = 0;
  private started = false;
  private rnd = mulberry(0x5eed1e);
  private noiseBuf: AudioBuffer;
  private sum: GainNode;
  private lp: BiquadFilterNode;
  private level: GainNode;
  private padG: GainNode;
  private droneG: GainNode;
  private stingIn: GainNode;
  private walk: number[] = [];
  private vib: Map<number, number> | null = null;
  private offerAt = -1;
  private riser: { stop: (t: number) => void } | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode, stingOut: AudioNode = out) {
    this.ctx = ctx;
    const n = Math.floor(ctx.sampleRate * 1.5);
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    // a small dark room shared by the bed and the stings
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.2);
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.8;
    verb.connect(verbOut); verbOut.connect(out);

    this.sum = ctx.createGain(); this.sum.gain.value = 1;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 400; this.lp.Q.value = 0.6;
    this.level = ctx.createGain(); this.level.gain.value = 0;
    this.sum.connect(this.lp); this.lp.connect(this.level); this.level.connect(out);
    const send = ctx.createGain(); send.gain.value = 0.22;
    this.level.connect(send); send.connect(verb);

    this.padG = ctx.createGain(); this.padG.gain.value = 0; this.padG.connect(this.sum);
    this.droneG = ctx.createGain(); this.droneG.gain.value = 0; this.droneG.connect(this.sum);

    this.stingIn = ctx.createGain(); this.stingIn.gain.value = 1;
    this.stingIn.connect(stingOut);
    const sSend = ctx.createGain(); sSend.gain.value = 0.3;
    this.stingIn.connect(sSend); sSend.connect(verb);
  }

  get current(): MusicMode { return this.mode; }

  /** Begin the clock and the drone at `at` (defaults to now). */
  start(at = this.ctx.currentTime + 0.05): void {
    if (this.started) return;
    this.started = true;
    this.nextT = at;
    this.stepNo = 0;
    this.buildDrone(at);
  }

  /** Switch the bed; layers fade, the beat changes at the next sixteenth. */
  setMode(m: MusicMode, at = this.ctx.currentTime): void {
    const prev = this.mode;
    if (m === prev) return;
    this.mode = m;
    const s = MODES[m];
    const fast = m === 'look' || m === 'call' || m === 'crack' || m === 'off';
    const lvl = this.level.gain;
    lvl.cancelScheduledValues(at);
    lvl.setTargetAtTime(s.level * BED, at, fast ? 0.12 : 0.45);
    const f = this.lp.frequency;
    hold(f, at);
    if (m === 'offer') {
      // the filter opens over his whole window
      f.setTargetAtTime(s.lp, at, 0.03);
      f.setValueAtTime(s.lp, at + 0.12);
      f.exponentialRampToValueAtTime(9000, at + OFFER_S);
    } else {
      f.setTargetAtTime(s.lp, at, 0.25);
    }
    this.padG.gain.cancelScheduledValues(at);
    this.padG.gain.setTargetAtTime(s.pad, at, 0.6);
    this.droneG.gain.cancelScheduledValues(at);
    this.droneG.gain.setTargetAtTime(s.drone * 0.5, at, fast ? 0.25 : 0.8);
    if (m === 'offer') { this.offerAt = at; this.riser?.stop(at); this.riser = this.startRiser(at, OFFER_S); }
    else if (prev === 'offer') { this.riser?.stop(at); this.riser = null; this.offerAt = -1; }
  }

  /** Schedule every sixteenth that starts before `until`. */
  pump(until: number): void {
    if (!this.started) return;
    while (this.nextT < until) {
      try { this.step(this.stepNo, this.nextT); } catch { /* one bad note must not stop the clock */ }
      this.stepNo++;
      this.nextT += S16;
    }
  }

  /** Move the clock on without playing (muted, or the context was asleep). */
  skipTo(t: number): void {
    if (!this.started) return;
    while (this.nextT < t) { this.stepNo++; this.nextT += S16; }
  }

  // ---------- the band ----------

  private step(n: number, t0: number): void {
    const spec = MODES[this.mode];
    if (this.mode === 'off') return;
    const bar = Math.floor(n / 16);
    const s = n % 16;
    const beat = Math.floor(s / 4);
    const sub = s % 4;
    const swung = spec.hats !== 'tight';
    const t = t0 + (swung && sub === 2 ? S16 * SWING : 0);
    const ch = chordFor(bar, spec.harmony);
    const next = chordFor(bar + 1, spec.harmony);
    const barDur = S16 * 16;
    const prog = this.offerAt >= 0 ? Math.min(1, Math.max(0, (t - this.offerAt) / OFFER_S)) : 0;

    if (s === 0 || this.walk.length < 4) {
      this.walk = walkBar(ch, next, this.rnd);
      this.vib = spec.vibes > 0 && bar % 4 !== 3 && this.rnd() < 0.5 * spec.vibes + 0.15 ? motif(ch, this.rnd) : null;
      if (spec.pad > 0) this.pad(t, voicing(ch), barDur);
    }

    switch (spec.bass) {
      case 'walk':
        if (sub === 0) this.pluck(t, this.walk[beat] as number, S16 * 3.6, 0.8);
        if (s === 14 && this.rnd() < 0.3) this.pluck(t, this.walk[3] as number, 0.07, 0.25);
        break;
      case 'half':
        if (s === 0) this.pluck(t, this.walk[0] as number, S16 * 7, 0.65);
        if (s === 8) this.pluck(t, (this.walk[0] as number) + 7, S16 * 6, 0.5);
        break;
      case 'pulse':
        if (s === 0 || s === 8) this.pluck(t, this.walk[0] as number, S16 * 3, 0.85);
        if (s === 2 || s === 10) this.pluck(t, this.walk[0] as number, S16 * 1.5, 0.35);
        break;
      case 'ostinato':
        if (sub % 2 === 0) this.pluck(t, ch.root + (OSTINATO[s / 2] as number), S16 * 1.7, 0.6 + 0.25 * prog);
        break;
      default: break;
    }

    if (spec.hats === 'swing' && sub % 2 === 0) {
      const open = s === 14 && bar % 2 === 1;
      this.hat(t, sub === 0 ? 0.12 : 0.2, open);
    } else if (spec.hats === 'tight') {
      // sixteenths that get louder and brighter as his clock runs down
      this.hat(t, (sub === 0 ? 0.2 : sub === 2 ? 0.14 : 0.08) * (0.55 + 0.75 * prog), false, 7000 + 4000 * prog);
    }
    if (spec.brush > 0 && (s === 4 || s === 12)) this.brush(t, 0.32 * spec.brush);
    if (spec.kick === 'soft' && (s === 0 || (s === 10 && this.rnd() < 0.6))) this.kick(t, 0.55);
    if (spec.kick === 'four' && sub === 0) this.kick(t, 0.5 + 0.2 * prog);
    if (spec.rim && (s === 4 || s === 12)) this.rim(t, 0.3);
    if (spec.stab && s === 14 && bar % 4 === 3) this.brass(t, voicing(next), 0.2, 0.28, 1, 0, this.sum);
    const v = this.vib?.get(s);
    if (v !== undefined) this.vibes(t, v, 0.9, 0.09 * spec.vibes + 0.03, this.sum);
  }

  private noise(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    return src;
  }

  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  /** Upright bass: a filtered saw for the finger and the wood, a sine underneath for the weight. */
  private pluck(t: number, midi: number, dur: number, gain: number): void {
    if (!Number.isFinite(midi)) return;
    const c = this.ctx; const f = mtof(midi);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(Math.min(2400, f * 10), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), t + 0.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, dur));
    lp.connect(g); g.connect(this.sum);
    const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f;
    const sine = c.createOscillator(); sine.type = 'sine'; sine.frequency.value = f;
    const sg = c.createGain(); sg.gain.value = 0.9;
    saw.connect(lp); sine.connect(sg); sg.connect(g);
    const end = t + Math.max(0.12, dur) + 0.05;
    saw.start(t); sine.start(t); saw.stop(end); sine.stop(end);
  }

  private hat(t: number, gain: number, open: boolean, hp = 7000): void {
    const c = this.ctx; const src = this.noise();
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = this.env(t, gain, 0.002, open ? 0.32 : 0.045, this.sum);
    src.connect(f); f.connect(g);
    src.start(t, Math.random() * 1.2, open ? 0.4 : 0.08);
  }

  /** A brush slap: a soft wide burst of noise. */
  private brush(t: number, gain: number): void {
    const c = this.ctx; const src = this.noise();
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.7;
    const g = this.env(t, gain, 0.012, 0.17, this.sum);
    src.connect(f); f.connect(g);
    src.start(t, Math.random() * 1.2, 0.22);
  }

  private kick(t: number, gain: number): void {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = this.env(t, gain, 0.004, 0.26, this.sum);
    o.connect(g); o.start(t); o.stop(t + 0.32);
  }

  private rim(t: number, gain: number): void {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 1750;
    const g = this.env(t, gain, 0.001, 0.035, this.sum);
    o.connect(g); o.start(t); o.stop(t + 0.05);
    const src = this.noise();
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 5;
    const g2 = this.env(t, gain * 0.8, 0.001, 0.03, this.sum);
    src.connect(f); f.connect(g2); src.start(t, Math.random(), 0.05);
  }

  /** A slow pad: two detuned saws a note, dark, swelling in over the bar. */
  private pad(t: number, notes: number[], dur: number): void {
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.5;
    const g = c.createGain();
    const peak = 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.9);
    g.gain.setValueAtTime(peak, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
    lp.connect(g); g.connect(this.padG);
    for (const m of notes) {
      for (const det of [-7, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 1.5);
      }
    }
  }

  /** Muted vibes: a sine with a quick bright overtone and a slow shimmer. */
  private vibes(t: number, midi: number, dur: number, gain: number, dest: AudioNode): void {
    const c = this.ctx; const f = mtof(midi);
    const g = this.env(t, gain, 0.003, dur, dest);
    const trem = c.createGain(); trem.gain.value = 1; trem.connect(g);
    const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
    const depth = c.createGain(); depth.gain.value = 0.25;
    lfo.connect(depth); depth.connect(trem.gain);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(trem);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 4;
    const g2 = this.env(t, gain * 0.35, 0.002, 0.25, dest);
    o2.connect(g2);
    const end = t + dur + 0.05;
    o.start(t); o2.start(t); lfo.start(t); o.stop(end); o2.stop(end); lfo.stop(end);
  }

  /** Muted brass: detuned saws through a closing filter. `bend` in semitones over the note. */
  private brass(t: number, notes: number[], dur: number, gain: number, bright: number, bend: number, dest: AudioNode): void {
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(900 + 2600 * bright, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(500, t + Math.min(dur, 0.25) + 0.1);
    // many voices sum loud: scale so a big chord lands about as hard as a small one
    const peak = gain / Math.sqrt(notes.length * 2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(peak * 0.5, t + Math.min(dur, 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    lp.connect(g); g.connect(dest);
    for (const m of notes) {
      for (const det of [-9, 8]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        const f = mtof(m);
        o.frequency.setValueAtTime(f, t);
        if (bend) o.frequency.exponentialRampToValueAtTime(f * 2 ** (bend / 12), t + dur);
        o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.3);
      }
    }
  }

  /** A deep hit: a falling sine and a thump of low noise. */
  private boom(t: number, gain: number, dest: AudioNode): void {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    const g = this.env(t, gain, 0.005, 1.2, dest);
    o.connect(g); o.start(t); o.stop(t + 1.3);
    const src = this.noise();
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g2 = this.env(t, gain * 0.9, 0.003, 0.35, dest);
    src.connect(f); f.connect(g2); src.start(t, Math.random(), 0.45);
  }

  private buildDrone(at: number): void {
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 3;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    const g = c.createGain(); g.gain.value = 0.16;
    lp.connect(g); g.connect(this.droneG);
    for (const [m, type] of [[38, 'sawtooth'], [45, 'triangle'], [26, 'sine']] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(lp); o.start(at);
    }
    // a little room air on top
    const air = this.noise(); air.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.4;
    const ag = c.createGain(); ag.gain.value = 0.05;
    air.connect(bp); bp.connect(ag); ag.connect(this.droneG);
    air.start(at); lfo.start(at);
  }

  /** The offer riser: noise and a saw climbing together over his window. */
  private startRiser(t: number, dur: number): { stop: (at: number) => void } {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.32, t + dur);
    g.connect(this.sum);
    const src = this.noise(); src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    src.connect(bp); bp.connect(g);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(50), t); o.frequency.exponentialRampToValueAtTime(mtof(62), t + dur);
    const og = c.createGain(); og.gain.value = 0.25;
    const olp = c.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.setValueAtTime(400, t); olp.frequency.exponentialRampToValueAtTime(3000, t + dur);
    o.connect(olp); olp.connect(og); og.connect(g);
    src.start(t); o.start(t);
    const hardEnd = t + dur + 0.05;
    src.stop(hardEnd); o.stop(hardEnd);
    let stopped = false;
    return {
      stop: (at: number) => {
        if (stopped) return;
        stopped = true;
        if (at >= hardEnd) return;
        g.gain.cancelScheduledValues(at);
        g.gain.setTargetAtTime(0.0001, at, 0.03);
        try { src.stop(at + 0.15); o.stop(at + 0.15); } catch { /* already stopped */ }
      },
    };
  }

  // ---------- stings ----------

  sting(kind: StingKind, at = this.ctx.currentTime + 0.01): void {
    const d = this.stingIn;
    const vibeRun = (notes: number[], t0: number, gap: number, gain: number): void => {
      notes.forEach((m, i) => this.vibes(t0 + i * gap, m, 0.8, gain, d));
    };
    switch (kind) {
      case 'sold':
        // a bright, cool stab and a run up the vibes: the money is yours
        this.brass(at, [62, 65, 69, 72, 76], 0.45, 0.45, 1.1, 0, d);
        vibeRun([74, 77, 81, 84, 88], at + 0.06, 0.065, 0.12);
        break;
      case 'kept':
        // you held on: two low notes, unbothered
        this.brass(at, [45, 52], 0.18, 0.45, 0.5, 0, d);
        this.brass(at + 0.2, [38, 50, 57], 0.6, 0.5, 0.6, 0, d);
        this.vibes(at + 0.2, 74, 1.2, 0.1, d);
        break;
      case 'passed':
        // he walks away: a muted fall of a half step
        this.brass(at, [58, 62, 65], 0.22, 0.38, 0.5, 0, d);
        this.brass(at + 0.24, [57, 61, 64], 0.8, 0.4, 0.4, -0.3, d);
        break;
      case 'caught':
        // caught: a hard clash on top of the alarm
        this.boom(at, 0.45, d);
        this.brass(at, [50, 56, 63, 68], 0.75, 0.6, 1.4, -1, d);
        break;
      case 'bust':
        this.boom(at, 0.6, d);
        this.boom(at + 0.5, 0.4, d);
        this.brass(at, [38, 44, 50, 51, 56], 1.9, 0.7, 1.3, -5, d);
        break;
      case 'finalWin':
        // double: a big open major chord and a run to the top
        this.boom(at, 0.35, d);
        this.brass(at, [50, 57, 62, 66, 69, 71, 76], 1.5, 0.6, 1.3, 0, d);
        vibeRun([74, 78, 81, 83, 86, 90, 93], at + 0.1, 0.07, 0.12);
        break;
      case 'noBet':
        // no read, no bet: a suspended chord that never lands
        this.brass(at, [43, 50, 55, 57], 1.2, 0.4, 0.5, 0, d);
        this.vibes(at + 0.15, 69, 1.4, 0.08, d);
        break;
      case 'finalLoss':
        // nothing: a dark chord that sinks
        this.boom(at, 0.55, d);
        this.brass(at, [38, 46, 50, 53], 2.2, 0.6, 0.8, -2, d);
        this.vibes(at + 0.4, 63, 1.8, 0.08, d);
        break;
    }
  }

  private impulse(secs: number): AudioBuffer {
    const c = this.ctx; const n = Math.floor(c.sampleRate * secs);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3.2;
    }
    return b;
  }
}

// ---------- the one live score ----------

let engine: HeistMusic | null = null;
let wanted: MusicMode = 'off';
let waiting = false;

function ensure(): HeistMusic | null {
  if (engine) return engine;
  const b = audioBus(true);
  if (!b) {
    if (!waiting) { waiting = true; onGesture(() => { waiting = false; if (wanted !== 'off') ensure(); }); }
    return null;
  }
  try {
    const e = new HeistMusic(b.ctx, b.music, b.stings);
    e.start();
    e.setMode(wanted);
    engine = e;
    setInterval(() => {
      const now = b.ctx.currentTime;
      if (isMuted() || b.ctx.state !== 'running') e.skipTo(now + 0.05);
      else e.pump(now + 0.2);
    }, 50);
    return e;
  } catch { return null; }
}

/** Set the bed for what is on screen now. */
export function setMusicMode(m: MusicMode): void {
  wanted = m;
  if (m === 'off' && !engine) return;
  ensure()?.setMode(m);
}

/** Play a sting now (skipped while muted). */
export function playSting(k: StingKind): void {
  if (isMuted()) return;
  ensure()?.sting(k);
}

// ---------- the game drives it ----------

/** What the score needs to know about the game, from Game.tsx. */
export interface MusicSnap {
  screen: string;
  phase: string;
  /** Game.tsx's data-stage: lead, look, offer, tooslow, call0..2, replay, or the phase */
  stage: string;
  /** practice step: intro, peek or noted */
  practice?: string;
  paused: boolean;
  /** screenshot pace: above 1 plays no music */
  pace: number;
  /** which job this is (a new job resets the stings) */
  gameNo: number;
  logLen: number;
  last: { result: string; strike: boolean; expired: boolean; final: boolean } | null;
  strikes: number;
  busted: boolean;
  finalStage: number;
  /** his last call was right (you lose the take); null when there was no call or no bet */
  finalRight: boolean | null;
}

export function musicMode(s: MusicSnap): MusicMode {
  if (s.pace > 1) return 'off';
  if (s.screen !== 'play') return s.screen === 'lineup' ? 'calm' : 'menu';
  if (s.paused) return 'paused';
  if (s.busted) return 'bust';
  if (s.stage === 'replay') return 'replay';
  switch (s.phase) {
    case 'begin': case 'baseline': return 'calm';
    case 'practice': return s.practice === 'peek' ? 'look' : 'calm';
    case 'board': return 'board';
    case 'peek': return s.stage === 'lead' ? 'crack' : 'look';
    case 'bankerRead': return s.stage === 'offer' ? 'offer' : 'call';
    case 'audit': return 'replay';
    case 'finalChoice': return 'last';
    case 'finalCall': return s.finalStage >= 2 ? 'after' : 'call';
    case 'reveal': return 'reveal';
    case 'over': return 'over';
    default: return 'board';
  }
}

/** The stings owed between two snapshots of the same job. */
export function stingsFor(p: MusicSnap, s: MusicSnap): StingKind[] {
  if (s.pace > 1 || s.screen !== 'play' || p.gameNo !== s.gameNo) return [];
  const out: StingKind[] = [];
  if (s.busted && !p.busted) out.push('bust');
  else if (s.logLen > p.logLen && s.last && !s.last.final) {
    if (s.strikes > p.strikes) out.push('caught');
    else if (s.last.result === 'sold') out.push('sold');
    else if (s.last.result === 'burned') out.push('passed');
    else if (!s.last.expired) out.push('kept');
  }
  if (s.phase === 'finalCall' && s.finalStage >= 2 && p.finalStage < 2) out.push(s.finalRight === null ? 'noBet' : s.finalRight ? 'finalLoss' : 'finalWin');
  return out;
}

/** Drive the score from the game: the bed follows the screen, stings land on what just happened. */
export function useMusic(s: MusicSnap): void {
  const mode = musicMode(s);
  useEffect(() => { setMusicMode(mode); }, [mode]);
  const prev = useRef<MusicSnap>(s);
  useEffect(() => {
    const p = prev.current;
    prev.current = s;
    for (const k of stingsFor(p, s)) playSting(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.gameNo, s.logLen, s.strikes, s.busted, s.finalStage]);
}
