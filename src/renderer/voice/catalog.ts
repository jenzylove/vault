/**
 * Every line the Fence can say out loud, for the voice generator (npm run voice) and its coverage test.
 * Not imported by the app.
 *
 * Lines come from the banks in engine/lines.ts (picked by pickLine), from tellLine and memoryLine, and from
 * the literal strings Game.tsx passes to speak(). Numbers in spoken lines come from small fixed sets
 * (engine/replay.ts saySeconds and friends; offers never say the price), so the set is finite.
 *
 * A family marked `split` is rendered one sentence at a time and played back as a run of sentence clips
 * (ui/voiceClips.ts planClips): "There." + "You stopped breathing for 3 seconds." + "I knew it was empty."
 */
import { FINAL, GHOST_OFFER, MEMORY, OFFER, STRIKE, UNREAD, VERDICT } from '../engine/lines';
import { detailFor } from '../engine/replay';
import { TELL_KEYS, memoryLine, tellLine, type TellHistory, type TellHistoryEntry, type TellKey } from '../engine/tells';
import type { BankerRead, PeekFeatures } from '../engine/types';
import { normalizeLine, splitSentences } from '../ui/voiceClips';

/** Strings Game.tsx speaks as they are (tests/ui/voice.test.ts checks Game.tsx against this list). */
export const LITERAL_LINES = [
  'Too slow.',
  'You flinched. The deal is off.',
  'Empty.',
  'Full.',
  'No bet.',
  'I could not find your tell this time.',
] as const;

export interface Family { name: string; lines: string[]; split?: boolean }

const BASE: PeekFeatures = { breathCatchMs: 0, shallowing: 0, rateChange: 0, blinkBurst: 0, exprDelta: {}, talking: false, pulseDelta: 0, quality: 1 };

/** Every detail sentence the replay can say, found by running detailFor over a fine grid of every measure. */
export function replayDetails(): string[] {
  const out = new Set<string>();
  const add = (f: Partial<PeekFeatures>, d: BankerRead['driver']): void => { out.add(detailFor({ ...BASE, ...f }, d)); };
  for (let ms = 0; ms <= 20000; ms += 25) add({ breathCatchMs: ms }, 'breath');
  for (let i = -400; i <= 2000; i++) add({ shallowing: i / 1000 }, 'shallow');
  for (let i = -1500; i <= 4000; i++) add({ rateChange: i / 1000 }, 'rate');
  for (const blinkBurst of [-1, 0.5, 2]) {
    for (let n = 0; n <= 60; n++) {
      for (let w = 0; w <= 12000; w += 50) add({ blinkBurst, blinkCount: n, windowMs: w }, 'blinks');
      add({ blinkBurst, blinkCount: n }, 'blinks');
    }
    add({ blinkBurst }, 'blinks');
  }
  for (const happy of [-0.3, 0, 0.3]) add({ exprDelta: { happy } }, 'joy');
  add({}, 'alarm');
  for (const talking of [false, true]) add({ talking }, null);
  return [...out];
}

function historyWith(key: TellKey | null, effect: number, games: number): TellHistory {
  const tells = Object.fromEntries(TELL_KEYS.map((k) => [k, { trap: 0, treasure: 0, effect: k === key ? effect : 0 }])) as TellHistoryEntry['tells'];
  const entry: TellHistoryEntry = { at: null, level: 1, pile: 0, won: false, bankerCorrect: 0, bankerCalls: 0, biggest: key, tells };
  return { version: 1, games: Array.from({ length: games }, () => entry) };
}

/** Every opening line he can remember you with: each tell, each side, every turn of the bank. */
export function memoryLines(): string[] {
  const out = new Set<string>();
  const n = Math.max(MEMORY.none.length, MEMORY.named('x', 'y').length);
  for (let games = 1; games <= n; games++) {
    for (const key of [...TELL_KEYS, null]) {
      for (const effect of [1, -1]) {
        const line = memoryLine(historyWith(key, effect, games));
        if (line) out.add(line);
      }
    }
  }
  return [...out];
}

export function families(): Family[] {
  const closeWhat = ['your breathing', 'your blinking', 'your face'];
  return [
    { name: 'offer', lines: [...UNREAD, ...OFFER.smileCalm, ...OFFER.bigSmile, ...OFFER.big, ...closeWhat.flatMap((w) => OFFER.close(w)), ...OFFER.calm, ...OFFER.plain, GHOST_OFFER] },
    { name: 'verdict', lines: [...VERDICT.unread, ...VERDICT.missedSaw, ...VERDICT.missed, ...VERDICT.dudKept, ...VERDICT.believedCalm, ...VERDICT.believed] },
    { name: 'verdict.walk', split: true, lines: replayDetails().flatMap((d) => [...VERDICT.walkDud(d), ...VERDICT.walkLoot(d)]) },
    { name: 'strike', lines: [...STRIKE.sold, ...STRIKE.caught, ...STRIKE.busted] },
    { name: 'final', lines: [...FINAL.dudBreath, ...FINAL.dud, ...FINAL.loot, ...FINAL.none, ...FINAL.right, ...FINAL.wrong] },
    { name: 'memory', lines: memoryLines() },
    { name: 'tell', lines: TELL_KEYS.flatMap((k) => [tellLine(k, 1), tellLine(k, -1)]) },
    { name: 'literal', lines: [...LITERAL_LINES] },
  ];
}

/** Every full line he can say. */
export function spokenLines(): string[] {
  return [...new Set(families().flatMap((f) => f.lines))];
}

/** What to record: whole lines, and the sentences of split families. Keyed by the lookup key. */
export function renderUnits(): { key: string; text: string }[] {
  const seen = new Map<string, string>();
  for (const fam of families()) {
    for (const line of fam.lines) {
      for (const text of fam.split ? splitSentences(line) : [line]) {
        const key = normalizeLine(text);
        if (!seen.has(key)) seen.set(key, text);
      }
    }
  }
  return [...seen].map(([key, text]) => ({ key, text }));
}
