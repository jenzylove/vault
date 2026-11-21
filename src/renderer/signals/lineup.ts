// Pure timing logic for the lineup gate and the mid game face pause. Times are wall clock ms
// (performance.now()) passed in, so tests drive them without a camera or the SDK.
import { V_MANY_FACES, V_NO_FACE, V_OK } from './status';
import type { SignalSource } from './types';

export const LINEUP_CLEAR_MS = 2000;   // no validation problem for this long
export const LINEUP_STEADY_MS = 2000;  // chest samples arriving without a break for this long
export const CHEST_GAP_MS = 2500;      // a longer silence than this breaks the run (metrics arrive in batches)
export const STALE_MS = 1000;          // a problem code not repeated for this long has cleared

export interface GateRead {
  ready: boolean;
  progress: number;          // 0..1 toward ready
  code: number | null;       // latest validation code, null before any packet
  waiting: 'validation' | 'chest' | null; // what still holds the player back
}

/** Lets the player past the lineup once the SDK is happy and chest samples flow steadily. */
export class LineupGate {
  private code: number | null = null;
  private lastBadAt: number | null = null;
  private lastChestAt: number | null = null;
  private runStart: number | null = null;

  reset(): void { this.code = null; this.lastBadAt = null; this.lastChestAt = null; this.runStart = null; }

  validation(code: number, now: number): void {
    // a problem lasts until the packet that clears it, so the clear clock starts at that packet
    const wasBad = this.code !== null && this.code !== V_OK;
    if (code !== V_OK || wasBad) this.lastBadAt = now;
    this.code = code;
  }

  chest(now: number): void {
    if (this.lastChestAt === null || now - this.lastChestAt > CHEST_GAP_MS) this.runStart = now;
    this.lastChestAt = now;
  }

  check(now: number): GateRead {
    // The SDK repeats a problem code many times a second while it lasts and may never send an
    // explicit OK, so a problem that has not been repeated for STALE_MS counts as cleared.
    const bad = this.code !== null && this.code !== V_OK && this.lastBadAt !== null && now - this.lastBadAt < STALE_MS;
    const clearFor = bad ? 0 : this.lastBadAt === null ? Infinity : now - this.lastBadAt;
    const flowing = this.lastChestAt !== null && this.runStart !== null && now - this.lastChestAt <= CHEST_GAP_MS;
    const flowFor = flowing ? now - (this.runStart as number) : 0;
    const p = Math.min(clearFor / LINEUP_CLEAR_MS, flowFor / LINEUP_STEADY_MS, 1);
    const ready = clearFor >= LINEUP_CLEAR_MS && flowFor >= LINEUP_STEADY_MS;
    return {
      ready,
      progress: Math.max(0, p),
      code: this.code,
      waiting: ready ? null : clearFor < LINEUP_CLEAR_MS ? 'validation' : 'chest',
    };
  }
}

/** A face problem must hold this long to pause: shorter gaps are ignored entirely. */
export const FACE_PAUSE_ENTER_MS = 5000;
export const FACE_PAUSE_EXIT_MS = 1000;   // and be gone this long to resume

export type FaceProblem = 'none' | 'many' | null;

/**
 * Watches the SDK's validation codes for "no face found" (1) and "multiple faces found" (2).
 * Nothing else is used: the SDK reports no face count in its metrics, only these codes.
 */
export class FaceWatch {
  private raw: FaceProblem = null;
  private since = 0;
  private paused: FaceProblem = null;
  private lastFaceCodeAt = 0;

  reset(): void { this.raw = null; this.since = 0; this.paused = null; this.lastFaceCodeAt = 0; }

  validation(code: number, now: number): void {
    const p: FaceProblem = code === V_NO_FACE ? 'none' : code === V_MANY_FACES ? 'many' : null;
    if (p !== null) this.lastFaceCodeAt = now;
    if (p !== this.raw) { this.raw = p; this.since = now; }
  }

  /** The problem the game should pause for right now, or null to play on. */
  check(now: number): FaceProblem {
    // The SDK may never send an OK packet: a face code that stopped repeating has cleared.
    if (this.raw !== null && now - this.lastFaceCodeAt >= STALE_MS) { this.raw = null; this.since = this.lastFaceCodeAt + STALE_MS; }
    const held = now - this.since;
    if (this.paused === null) {
      if (this.raw !== null && held >= FACE_PAUSE_ENTER_MS) this.paused = this.raw;
    } else if (this.raw === null) {
      if (held >= FACE_PAUSE_EXIT_MS) this.paused = null;
    } else {
      this.paused = this.raw; // none <-> many while paused: show the current one
    }
    return this.paused;
  }
}

/** Feed a gate from a source: wall clock chest arrivals and every new validation packet. Returns an unsubscribe. */
/** A signal gap (no frames, or a weak read) must last this long before the job pauses. */
export const GAP_PAUSE_ENTER_MS = 5000;
/** ...and be clear this long before it goes on. */
export const GAP_PAUSE_EXIT_MS = 1000;

/**
 * Any signal trouble (stale frames, weak read). Gaps shorter than GAP_PAUSE_ENTER_MS are ignored
 * entirely; past that the job pauses calmly until the signal has been clear for GAP_PAUSE_EXIT_MS.
 */
export class GapWatch {
  private badSince: number | null = null;
  private goodSince: number | null = null;
  private paused = false;

  reset(): void { this.badSince = null; this.goodSince = null; this.paused = false; }

  /** Feed whether the signal is bad right now; returns true while the job should be paused. */
  update(bad: boolean, now: number): boolean {
    if (bad) {
      this.goodSince = null;
      this.badSince ??= now;
      if (!this.paused && now - this.badSince >= GAP_PAUSE_ENTER_MS) this.paused = true;
    } else {
      this.badSince = null;
      this.goodSince ??= now;
      if (this.paused && now - this.goodSince >= GAP_PAUSE_EXIT_MS) this.paused = false;
    }
    return this.paused;
  }

  get isPaused(): boolean { return this.paused; }
}

export function wireGate(source: SignalSource, gate: LineupGate, now: () => number): () => void {
  gate.reset();
  let lastV = source.status().validation;
  if (lastV) gate.validation(lastV.code, lastV.at);
  const offS = source.onStatus((s) => {
    if (s.validation && s.validation !== lastV) { lastV = s.validation; gate.validation(s.validation.code, s.validation.at); }
    if (s.processing !== 'running' && s.processing !== 'starting') gate.reset();
  });
  const offF = source.subscribe((f) => { if (typeof f.chest === 'number') gate.chest(now()); });
  return () => { offS(); offF(); };
}
