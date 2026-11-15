/** The banker's voice: Web Speech API, low and slow. Always paired with on screen subtitles. */
let voice: SpeechSynthesisVoice | null = null;
let muted = false;

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

export function setMuted(m: boolean): void { muted = m; if (m) stopSpeaking(); }
export function isMuted(): boolean { return muted; }

export function stopSpeaking(): void {
  try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* no speech engine */ }
}

/**
 * Speak a line. Resolves when the voice finishes, or after a reading time fallback so the game never
 * waits on a missing speech engine. `pace` > 1 shortens the fallback (screenshots only).
 */
export function speak(text: string, pace = 1): { done: Promise<void>; cancel: () => void } {
  const readMs = Math.max(2200, 900 + text.length * 62) / pace;
  let cancelled = false;
  let finish!: () => void;
  const done = new Promise<void>((r) => { finish = r; });
  const timer = setTimeout(() => finish(), readMs + (muted ? 0 : 2500 / pace));
  let fallback: ReturnType<typeof setTimeout> | null = null;
  try {
    if (!muted && pace === 1 && typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.pitch = 0.55;
      u.rate = 0.84;
      u.volume = 0.95;
      u.onend = () => { finish(); };
      u.onerror = () => { finish(); };
      speechSynthesis.speak(u);
    } else {
      fallback = setTimeout(() => finish(), readMs);
    }
  } catch {
    fallback = setTimeout(() => finish(), readMs);
  }
  done.then(() => { clearTimeout(timer); if (fallback) clearTimeout(fallback); });
  return {
    done,
    cancel: () => { if (!cancelled) { cancelled = true; stopSpeaking(); finish(); } },
  };
}
