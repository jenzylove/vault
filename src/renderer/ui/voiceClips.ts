/**
 * The Fence's voice clips: every line he can say is rendered at build time (npm run voice, edge-tts) and
 * ships as small files in public/voice with this manifest. Nothing is synthesized or sent anywhere at run
 * time: a line is looked up by its exact words.
 *
 * A line is found whole, or as a run of whole sentences ("There." + "You stopped breathing for 3
 * seconds." + "I knew it was empty."), so lines built from a few parts need only their parts rendered.
 */
import manifestJson from '../voice/manifest.json';

/** One rendered clip: its path under the public dir and its length in ms. */
export type Clip = readonly [file: string, ms: number];
export interface VoiceManifest {
  voice: string;
  rate: string;
  pitch: string;
  fx: string;
  clips: Record<string, Clip>;
}

export const MANIFEST = manifestJson as unknown as VoiceManifest;

/** The lookup key for a line: lower case, plain quotes, single spaces. */
export function normalizeLine(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

/** Whole sentences, in order ("Too slow." / "See that?" / "Blind offer: take it or leave it."). */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+["']?|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * The clips that say this line, in order: the whole line if it was rendered whole, else the longest runs
 * of sentences that were. Null when any part is missing (the caller falls back).
 */
export function planClips(text: string, clips: Record<string, Clip> = MANIFEST.clips): Clip[] | null {
  const whole = clips[normalizeLine(text)];
  if (whole) return [whole];
  const parts = splitSentences(text);
  if (parts.length < 2) return null;
  const out: Clip[] = [];
  let i = 0;
  while (i < parts.length) {
    let j = parts.length;
    let found: Clip | undefined;
    for (; j > i; j--) {
      found = clips[normalizeLine(parts.slice(i, j).join(' '))];
      if (found) break;
    }
    if (!found) return null;
    out.push(found);
    i = j;
  }
  return out;
}
