/**
 * One AudioContext for the game's sound effects and its music, made only after the player has pressed a
 * key or clicked (autoplay rules). Two buses meet at one master:
 *
 *   sfx ─────────────────────────────┐
 *   music ── duck (dips under his voice) ── master ── destination
 *   stings ──────────────────────────┘
 *
 * M (speech.ts setMuted) silences the master; his voice plays as clips outside WebAudio and stops itself.
 */
import { isMuted, onMuteChange, onVoice } from './speech';

export interface AudioBus {
  ctx: AudioContext;
  /** sound effects */
  sfx: GainNode;
  /** the music bed, ducked under his voice */
  music: GainNode;
  /** musical stings: not ducked, they land on the event itself */
  stings: GainNode;
}

/** How far the music dips while he talks (gain multiplier). */
export const DUCK_TO = 0.22;

let bus: AudioBus | null = null;
let master: GainNode | null = null;
let duckNode: GainNode | null = null;
let gestured = false;
const waiters: (() => void)[] = [];

function arm(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  const go = (): void => {
    gestured = true;
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
    for (const f of waiters.splice(0)) { try { f(); } catch { /* a listener failing must not stop the rest */ } }
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}
arm();

/** The player has pressed a key or clicked at least once. */
export function hasGesture(): boolean { return gestured; }

/** Run once the player has pressed a key or clicked (at once if they already have). */
export function onGesture(cb: () => void): void {
  if (gestured) cb(); else waiters.push(cb);
}

function build(): AudioBus | null {
  const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  master = ctx.createGain();
  master.gain.value = isMuted() ? 0 : 1;
  // a gentle glue so stings, door and music never clip together
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp); comp.connect(ctx.destination);
  const sfx = ctx.createGain(); sfx.gain.value = 0.5; sfx.connect(master);
  duckNode = ctx.createGain(); duckNode.gain.value = 1; duckNode.connect(master);
  const music = ctx.createGain(); music.gain.value = 1; music.connect(duckNode);
  const stings = ctx.createGain(); stings.gain.value = 0.55; stings.connect(master);
  return { ctx, sfx, music, stings };
}

/**
 * The shared bus, or null before the first key or click, while muted (when `evenMuted` is false), or where
 * WebAudio is missing. Resumes a suspended context on every call.
 */
export function audioBus(evenMuted = false): AudioBus | null {
  if (!gestured) return null;
  if (!evenMuted && isMuted()) return null;
  try {
    if (!bus) bus = build();
    if (!bus) return null;
    if (bus.ctx.state === 'suspended') void bus.ctx.resume().catch(() => undefined);
    return bus;
  } catch { return null; }
}

onMuteChange((m) => {
  if (!bus || !master) return;
  const g = master.gain; const now = bus.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(m ? 0 : 1, now, m ? 0.02 : 0.15);
});

onVoice((talking) => {
  if (!bus || !duckNode) return;
  const g = duckNode.gain; const now = bus.ctx.currentTime;
  g.cancelScheduledValues(now);
  // dip fast as he starts, come back slowly after his last word
  g.setTargetAtTime(talking ? DUCK_TO : 1, now, talking ? 0.06 : 0.45);
});
