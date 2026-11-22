/**
 * The Fence's voice. Every line he can say is a clip rendered at build time (npm run voice) and played from
 * disk; nothing is synthesized or sent anywhere while you play (his lines describe your body). A line with no
 * clip falls back to the system voice (Web Speech API). Always paired with on screen subtitles.
 */
import { planClips, type Clip } from './voiceClips';

let voice: SpeechSynthesisVoice | null = null;
let muted = false;

const muteListeners = new Set<(m: boolean) => void>();
const voiceListeners = new Set<(talking: boolean) => void>();

/** Called with the new state whenever M flips the sound. Returns an unsubscribe. */
export function onMuteChange(cb: (m: boolean) => void): () => void { muteListeners.add(cb); return () => muteListeners.delete(cb); }
/** Called with true as he starts a line and false when he stops (the music ducks under him). */
export function onVoice(cb: (talking: boolean) => void): () => void { voiceListeners.add(cb); return () => voiceListeners.delete(cb); }

let talking = false;
function setTalking(t: boolean): void {
  if (t === talking) return;
  talking = t;
  for (const f of voiceListeners) { try { f(t); } catch { /* ignore */ } }
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const male = /david|george|daniel|guy|ryan|male|james|arthur|fred|alex|mark|richard/i;
  return vs.find((v) => male.test(v.name) && /gb|uk/i.test(v.lang)) ?? vs.find((v) => male.test(v.name)) ?? vs[0] ?? null;
}

if (typeof speechSynthesis !== 'undefined') {
  voice = pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', () => { voice = pickVoice(); });
}

export function setMuted(m: boolean): void {
  muted = m;
  if (m) stopSpeaking();
  for (const f of muteListeners) { try { f(m); } catch { /* ignore */ } }
}
export function isMuted(): boolean { return muted; }

/** The clip line playing now (one at a time), and the newest line's number. */
let current: { stop: () => void } | null = null;
let seq = 0;

export function stopSpeaking(): void {
  const c = current; current = null;
  c?.stop();
  try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* no speech engine */ }
  setTalking(false);
}

/** The pause between two sentence clips of one line. */
const GAP_MS = 170;

/** Play clips back to back. Calls onEnd once (after the last clip, on an error, or when stopped). */
function playClips(clips: Clip[], onEnd: (ok: boolean) => void): { stop: () => void } {
  let i = 0;
  let over = false;
  let gap: ReturnType<typeof setTimeout> | null = null;
  const els = clips.map(([file]) => { const a = new Audio(file); a.preload = 'auto'; return a; });
  const end = (ok: boolean): void => {
    if (over) return;
    over = true;
    if (gap) clearTimeout(gap);
    for (const a of els) { a.onended = null; a.onerror = null; try { a.pause(); } catch { /* ignore */ } }
    onEnd(ok);
  };
  const next = (): void => {
    if (over) return;
    const a = els[i];
    if (!a) { end(true); return; }
    a.onended = () => { i++; if (i >= els.length) end(true); else gap = setTimeout(next, GAP_MS); };
    a.onerror = () => end(i > 0);
    a.play().catch(() => end(i > 0));
  };
  next();
  return { stop: () => end(true) };
}

/** The system voice: the old path, for a line with no clip. */
function systemVoice(text: string, finish: () => void): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.pitch = 0.55;
  u.rate = 0.84;
  u.volume = 0.95;
  u.onstart = () => setTalking(true);
  u.onend = () => { setTalking(false); finish(); };
  u.onerror = () => { setTalking(false); finish(); };
  speechSynthesis.speak(u);
  return true;
}

/**
 * Speak a line. Resolves when the voice finishes, or after a reading time fallback so the game never
 * waits on a missing clip or speech engine. `pace` > 1 shortens the fallback and plays no audio (screenshots only).
 */
export function speak(text: string, pace = 1): { done: Promise<void>; cancel: () => void } {
  const readMs = Math.max(2200, 900 + text.length * 62) / pace;
  const id = ++seq;
  let cancelled = false;
  let finish!: () => void;
  const done = new Promise<void>((r) => { finish = r; });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let mine: { stop: () => void } | null = null;
  try {
    const plan = !muted && pace === 1 && typeof Audio !== 'undefined' ? planClips(text) : null;
    if (plan) {
      stopSpeaking();
      const total = plan.reduce((s, [, ms]) => s + ms, 0) + GAP_MS * (plan.length - 1);
      timer = setTimeout(() => finish(), total + 2000);
      setTalking(true);
      const handle = playClips(plan, (ok) => {
        if (current === handle) { current = null; setTalking(false); }
        if (ok || cancelled) { finish(); return; }
        // a clip would not play: say it with the system voice instead
        if (!systemVoice(text, finish)) fallback = setTimeout(() => finish(), readMs);
      });
      mine = handle;
      current = handle;
    } else {
      timer = setTimeout(() => finish(), readMs + (muted ? 0 : 2500 / pace));
      if (!muted && pace === 1) {
        stopSpeaking();
        if (!systemVoice(text, finish)) fallback = setTimeout(() => finish(), readMs);
      } else {
        fallback = setTimeout(() => finish(), readMs);
      }
    }
  } catch {
    fallback = setTimeout(() => finish(), readMs);
  }
  done.then(() => { if (timer) clearTimeout(timer); if (fallback) clearTimeout(fallback); });
  return {
    done,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      // stop only this line: a newer one keeps playing (each new line already stopped the one before)
      if (id === seq) stopSpeaking(); else mine?.stop();
      finish();
    },
  };
}
