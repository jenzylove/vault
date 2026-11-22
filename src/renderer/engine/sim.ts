/**
 * SIMULATED BODY. Labelled synthetic SignalFrame streams for tests, the incentive probe and the
 * keyless demo mode. Nothing here is a real person; every frame comes from the parameters below.
 */
import type { SignalFrame } from '../signals/types';
import type { BoxKind, ExprKey } from './types';
import { EXPR_KEYS } from './types';
import { createRng, type Rng } from './rng';

export const SIMULATED_LABEL = 'simulated' as const;

export type Strategy =
  | 'honest'      // natural tells: breath catches at traps
  | 'steady'      // skilled: controls breath at traps, small residual leaks
  | 'fakeGasp'    // natural at traps, fakes a gasp and hold at treasure
  | 'freeze'      // freezes blank at every peek (breath stops, blinks stop, face flat)
  | 'holdBreath'  // inhales and holds through every peek
  | 'fakeSmile'   // natural breath, puts on a big smile at traps
  | 'hide'        // ducks out of the camera at traps
  | 'sample';     // the keyless sample run: gives itself away at about half the duds, now and then a small hold at loot

export const STRATEGIES: readonly Strategy[] = ['honest', 'steady', 'fakeGasp', 'freeze', 'holdBreath', 'fakeSmile', 'hide'];

export interface SimPlayerParams {
  label: typeof SIMULATED_LABEL;
  strategy: Strategy;
  periodMs: number;          // calm breath period
  amp: number;               // chest swing
  noise: number;             // sensor noise, share of amp
  bottomPause: number;       // share of the cycle spent paused after an exhale
  trapCatch: number;         // probability a trap causes a catch
  catchMs: [number, number]; // catch hold range
  trapShallow: number;       // breathing gets this much shallower after a trap
  faceLeak: number;          // 0..1 how much the face shows contents
  blinkLeak: number;         // blink burst factor at traps
  pulseLeak: number;         // bpm rise per trap seen
  bigExcite: number;         // breathing speeds up at a big treasure (share)
  fakeGaspAtTreasure: boolean;
  /** the sample run body: its reactions come from SAMPLE_BODY, drawn per look from a seeded stream */
  sample: boolean;
  freeze: boolean;
  holdEveryPeek: boolean;
  fakeSmileAtTrap: boolean;
  hideAtTrap: boolean;
  blinkRatePerMin: number;
  pulse: number;
  dropoutPerMin: number;     // random low confidence moments
  talkProb: number;          // chance of talking during a peek
  exprBase: Record<ExprKey, number>;
}

/** A random body, then the strategy on top. Same seed, same body. */
export function makeSimPlayer(strategy: Strategy, seed: number): SimPlayerParams {
  const r = createRng(seed * 2654435761 + 17);
  const happy = r.range(0.05, 0.2);
  const p: SimPlayerParams = {
    label: SIMULATED_LABEL,
    strategy,
    periodMs: r.range(3200, 5200),
    amp: r.range(0.6, 1.4),
    noise: r.range(0.02, 0.08),
    bottomPause: r.range(0.12, 0.24),
    trapCatch: r.range(0.7, 0.95),
    catchMs: [r.range(1100, 1400), r.range(1700, 2400)],
    trapShallow: r.range(0.1, 0.35),
    faceLeak: r.range(0.1, 0.8),
    blinkLeak: r.range(0, 1.2),
    pulseLeak: r.range(0.5, 3),
    bigExcite: r.range(0, 0.2),
    fakeGaspAtTreasure: false,
    freeze: false,
    holdEveryPeek: false,
    fakeSmileAtTrap: false,
    hideAtTrap: false,
    sample: false,
    blinkRatePerMin: r.range(8, 22),
    pulse: r.range(60, 85),
    dropoutPerMin: r.range(0, 1.5),
    talkProb: r.range(0, 0.06),
    exprBase: {
      neutral: 0.75 - happy, happy, sad: r.range(0.01, 0.06), surprise: r.range(0.02, 0.06),
      fear: r.range(0.01, 0.04), disgust: r.range(0.01, 0.03), anger: r.range(0.01, 0.03), contempt: r.range(0.01, 0.03),
    },
  };
  switch (strategy) {
    case 'honest':
      break;
    case 'steady':
      p.trapCatch = 0.1;
      p.catchMs = [300, 600];
      p.trapShallow = 0.04;
      p.faceLeak = 0.05;
      p.blinkLeak = 0.1;
      p.pulseLeak *= 0.5;
      break;
    case 'fakeGasp':
      p.fakeGaspAtTreasure = true;
      break;
    case 'freeze':
      p.freeze = true;
      break;
    case 'holdBreath':
      p.holdEveryPeek = true;
      break;
    case 'fakeSmile':
      p.fakeSmileAtTrap = true;
      break;
    case 'hide':
      p.hideAtTrap = true;
      break;
    case 'sample':
      // a fairly steady thief who slips about half the time; reactions come from SAMPLE_BODY
      p.sample = true;
      p.talkProb = 0;
      p.dropoutPerMin = Math.min(p.dropoutPerMin, 0.3);
      break;
  }
  return p;
}

/** How the sample run body gives itself away. Shares of looks, times in ms. */
export const SAMPLE_BODY = {
  dudSlip: 0.5,                 // share of duds where it gives itself away
  dudHoldMs: [1000, 2500],      // the breath hold when it slips
  dudHoldAtMs: [150, 800],      // how soon after the contents show
  dudBlinkBurst: 0.4,           // when it slips: chance of a blink burst too
  quietBlinkBurst: 0.15,        // when it does not slip: chance of a blink burst alone
  lootHold: 0.2,                // share of loot looks with a small hold
  lootHoldMs: [500, 1100],
  lootSmile: 0.35,              // share of looks (loot, or a dud it bluffs) with a small smile
} as const;

type SegKind = 'in' | 'top' | 'out' | 'bottom' | 'sharpIn' | 'hold';
interface Seg { kind: SegKind; start: number; dur: number; from: number; to: number; }
interface Mod { from: number; until: number; }
interface Pending { at: number; type: 'catch' | 'freeze'; holdMs: number; }

/**
 * A simulated body you step forward in time. Call react(kind) when a peek starts and it schedules
 * the reactions this player's parameters say it would have.
 */
export class SimBody {
  readonly label = SIMULATED_LABEL;
  readonly params: SimPlayerParams;
  t = 0;
  private readonly r: Rng;
  private readonly dtMs: number;
  private seg: Seg;
  private cycleP: number;
  private cycleAmp: number;
  private pending: Pending[] = [];
  private shallowMod: Mod & { k: number } = { from: 0, until: 0, k: 0 };
  private rateMod: Mod & { k: number } = { from: 0, until: 0, k: 0 };
  private blinkMod: Mod & { k: number } = { from: 0, until: 0, k: 1 };
  private exprMods: (Mod & { key: ExprKey; add: number })[] = [];
  private flatFaceUntil = 0;
  private talkUntil = 0;
  private hideUntil = 0;
  private hideFrom = 0;
  private dropoutUntil = 0;
  private blinkUntil = 0;
  private pulseExtra = 0;
  private pulseAvg: number;
  private suppressBlinksUntil = 0;
  private readonly seed: number;
  private looks = 0;

  constructor(params: SimPlayerParams, seed: number, fps = 30) {
    this.params = params;
    this.seed = seed;
    this.r = createRng(seed ^ 0x51ed27);
    this.dtMs = 1000 / fps;
    this.cycleP = params.periodMs;
    this.cycleAmp = params.amp;
    this.pulseAvg = params.pulse;
    this.seg = { kind: 'in', start: 0, dur: 0.38 * params.periodMs * this.r.range(0.2, 1), from: 0, to: params.amp };
  }

  private value(at: number): number {
    const s = this.seg;
    const u = s.dur > 0 ? Math.min(1, (at - s.start) / s.dur) : 1;
    if (s.kind === 'in' || s.kind === 'out' || s.kind === 'sharpIn') return s.from + (s.to - s.from) * (1 - Math.cos(Math.PI * u)) / 2;
    return s.from;
  }

  private active(m: Mod): boolean { return this.t >= m.from && this.t < m.until; }

  private nextSeg(): void {
    const s = this.seg;
    const end = s.start + s.dur;
    const lvl = s.to;
    const P = this.cycleP;
    switch (s.kind) {
      case 'in': this.seg = { kind: 'top', start: end, dur: 0.06 * P, from: lvl, to: lvl }; break;
      case 'top': this.seg = { kind: 'out', start: end, dur: (0.56 - this.params.bottomPause) * P, from: lvl, to: 0 }; break;
      case 'sharpIn': this.seg = { kind: 'hold', start: end, dur: this.holdAfterGasp, from: lvl, to: lvl }; break;
      case 'hold': this.seg = { kind: 'out', start: end, dur: 0.45 * P, from: lvl, to: 0 }; break;
      case 'out': this.seg = { kind: 'bottom', start: end, dur: this.params.bottomPause * P * this.r.range(0.8, 1.15), from: 0, to: 0 }; break;
      case 'bottom': {
        const rateK = this.active(this.rateMod) ? 1 - this.rateMod.k : 1;
        this.cycleP = this.params.periodMs * rateK * (1 + 0.07 * this.r.gauss());
        const shallowK = this.active(this.shallowMod) ? 1 - this.shallowMod.k : 1;
        this.cycleAmp = this.params.amp * shallowK * (1 + 0.08 * this.r.gauss());
        this.seg = { kind: 'in', start: end, dur: 0.38 * this.cycleP, from: 0, to: this.cycleAmp };
        break;
      }
    }
  }

  private holdAfterGasp = 0;

  /** Advance one sample and return the frame. */
  frame(): SignalFrame {
    const p = this.params;
    this.t += this.dtMs;
    const t = this.t;

    // scheduled interruptions
    while (this.pending.length && (this.pending[0] as Pending).at <= t) {
      const ev = this.pending.shift() as Pending;
      const cur = this.value(t);
      if (ev.type === 'catch') {
        this.holdAfterGasp = ev.holdMs;
        this.seg = { kind: 'sharpIn', start: t, dur: 300, from: cur, to: Math.max(cur, this.cycleAmp) * 1.15 };
      } else {
        this.seg = { kind: 'hold', start: t, dur: ev.holdMs, from: cur, to: cur };
      }
    }
    while (t >= this.seg.start + this.seg.dur) this.nextSeg();

    const drift = 0.25 * p.amp * Math.sin((2 * Math.PI * t) / 41000);
    const chest = this.value(t) + drift + p.noise * p.amp * this.r.gauss();

    // blinks: ~150 ms closures, Poisson onsets
    let blink = false;
    if (t < this.blinkUntil) blink = true;
    else if (t >= this.suppressBlinksUntil) {
      const k = this.active(this.blinkMod) ? this.blinkMod.k : 1;
      const perMs = (p.blinkRatePerMin * k) / 60000;
      if (this.r.chance(perMs * this.dtMs)) { this.blinkUntil = t + 150; blink = true; }
    }

    const expr: Partial<Record<ExprKey, number>> = {};
    const flat = t < this.flatFaceUntil;
    for (const key of EXPR_KEYS) {
      let x = p.exprBase[key];
      if (flat) x = key === 'neutral' ? x + 0.05 : x * 0.7;
      else for (const m of this.exprMods) if (m.key === key && this.active(m)) x += m.add;
      expr[key] = Math.max(0, x + 0.02 * this.r.gauss());
    }

    // pulse: slow drift toward base + extra (12 s average)
    this.pulseExtra *= Math.exp(-this.dtMs / 90000);
    const target = p.pulse + this.pulseExtra + 1.5 * this.r.gauss();
    this.pulseAvg += (target - this.pulseAvg) * (this.dtMs / 6000);

    if (this.dropoutUntil <= t && this.r.chance((p.dropoutPerMin / 60000) * this.dtMs)) {
      this.dropoutUntil = t + this.r.range(600, 1600);
    }
    const hidden = t >= this.hideFrom && t < this.hideUntil;
    const lost = hidden || t < this.dropoutUntil;
    return {
      t,
      chest,
      abdomen: chest * 0.6,
      pulse: this.pulseAvg,
      blink,
      talking: t < this.talkUntil,
      expr,
      conf: lost ? this.r.range(0.05, 0.35) : this.r.range(0.8, 0.98),
      stable: !lost,
    };
  }

  run(ms: number): SignalFrame[] {
    const out: SignalFrame[] = [];
    const end = this.t + ms;
    while (this.t + this.dtMs <= end + 1e-9) out.push(this.frame());
    return out;
  }

  /**
   * The player has just seen the contents of a box. Schedule this player's reactions.
   * `key` seeds the sample body's draw for this look (pass a key from the game seed and turn so a job
   * replays the same); without it the sample body counts its own looks from its seed.
   */
  react(kind: BoxKind, key?: number): void {
    const p = this.params;
    if (p.sample) { this.reactSample(kind, key); return; }
    const r = this.r;
    const t = this.t;
    const treasure = kind !== 'trap';
    const addExpr = (key: ExprKey, add: number, from: number, len: number): void => {
      this.exprMods.push({ key, add, from, until: from + len });
    };
    this.exprMods = this.exprMods.filter((m) => m.until > t);

    if (r.chance(p.talkProb)) this.talkUntil = t + r.range(800, 2500) + r.range(0, 3000);

    if (p.holdEveryPeek) {
      this.pending.push({ at: t + r.range(150, 400), type: 'catch', holdMs: r.range(6500, 8000) });
      return;
    }
    if (p.freeze) {
      const at = t + r.range(250, 700);
      const hold = r.range(2500, 4500);
      this.pending.push({ at, type: 'freeze', holdMs: hold });
      this.suppressBlinksUntil = at + hold;
      this.flatFaceUntil = at + hold + 1000;
      return;
    }
    if (kind === 'trap') {
      if (p.hideAtTrap) { this.hideFrom = t + r.range(200, 500); this.hideUntil = t + 8500; }
      const at = t + r.range(400, 1300);
      if (r.chance(p.trapCatch)) this.pending.push({ at, type: 'catch', holdMs: r.range(p.catchMs[0], p.catchMs[1]) });
      this.shallowMod = { from: at, until: at + 6000, k: p.trapShallow };
      this.blinkMod = { from: at, until: at + 5000, k: 1 + p.blinkLeak };
      addExpr('surprise', 0.12 * p.faceLeak, at, 3000);
      addExpr('fear', 0.06 * p.faceLeak, at, 3000);
      addExpr('happy', -0.4 * p.faceLeak * p.exprBase.happy, at, 4000);
      // fixed timing (no draw from the body's random stream) so a smiler's body stays paired with the honest one
      if (p.fakeSmileAtTrap) addExpr('happy', 0.35, at + 600, 5000);
      this.pulseExtra += p.pulseLeak * 3;
    } else {
      const big = kind === 'big';
      addExpr('happy', (big ? 0.2 : 0.07) * p.faceLeak, t + 500, 4000);
      if (big) {
        addExpr('surprise', 0.06 * p.faceLeak, t + 400, 2000);
        this.rateMod = { from: t, until: t + 6000, k: p.bigExcite };
      }
      if (p.fakeGaspAtTreasure) {
        this.pending.push({ at: t + r.range(400, 1200), type: 'catch', holdMs: r.range(1200, 2200) });
      }
    }
    this.pending.sort((a, b) => a.at - b.at);
  }

  /** The sample run body: a fairly steady thief who slips at about half the duds. */
  private reactSample(kind: BoxKind, key?: number): void {
    const p = this.params;
    const t = this.t;
    const k = key ?? (Math.imul(this.seed >>> 0, 0x9e3779b1) + this.looks) >>> 0;
    this.looks++;
    const rr = createRng((k ^ 0x5a3e11) >>> 0);
    const B = SAMPLE_BODY;
    this.exprMods = this.exprMods.filter((m) => m.until > t);
    const addExpr = (ek: ExprKey, add: number, from: number, len: number): void => {
      this.exprMods.push({ key: ek, add, from, until: from + len });
    };
    if (kind === 'trap') {
      if (rr.chance(B.dudSlip)) {
        const at = t + rr.range(B.dudHoldAtMs[0], B.dudHoldAtMs[1]);
        this.pending.push({ at, type: 'catch', holdMs: rr.range(B.dudHoldMs[0], B.dudHoldMs[1]) });
        this.shallowMod = { from: at, until: at + 5000, k: rr.range(0.08, 0.25) };
        if (rr.chance(B.dudBlinkBurst)) this.blinkMod = { from: at, until: at + 3500, k: rr.range(2.5, 4) };
        addExpr('surprise', 0.06 * p.faceLeak, at, 2500);
        this.pulseExtra += 3;
      } else {
        // a clean bluff: it looks like any loot look, now and then with the same small smile
        if (rr.chance(B.quietBlinkBurst)) this.blinkMod = { from: t + 300, until: t + 3300, k: rr.range(1.8, 2.6) };
        if (rr.chance(B.lootSmile)) addExpr('happy', 0.05 * p.faceLeak, t + 500, 4000);
      }
    } else {
      const big = kind === 'big';
      // a smile at loot only some of the time, so a smile alone never gives every dud away
      if (rr.chance(B.lootSmile)) addExpr('happy', (big ? 0.15 : 0.05) * p.faceLeak, t + 500, 4000);
      if (rr.chance(B.lootHold)) this.pending.push({ at: t + rr.range(300, 1200), type: 'catch', holdMs: rr.range(B.lootHoldMs[0], B.lootHoldMs[1]) });
    }
    this.pending.sort((a, b) => a.at - b.at);
  }
}
