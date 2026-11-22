/**
 * What the Fence says. Every situation has a bank of short lines; the line for a turn is picked by
 * the game's seeded rng (the bank is shuffled once per seed and situation, then walked turn by turn),
 * so the same seed always says the same thing and one run never repeats a line in one situation.
 * Every number in a line comes from the read. Copy rules: plain words, no dashes or hyphens.
 */
import { createRng } from './rng';

/** Where a line pick comes from: the game's seed and the turn (safes settled before this one). */
export interface LinePick { seed: number; turn: number }

function hashSalt(salt: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Index into a bank of n lines for this seed, turn and situation. */
export function pickIndex(n: number, pick: LinePick | null | undefined, salt: string): number {
  if (n <= 1) return 0;
  const seed = pick?.seed ?? 0;
  const turn = Math.max(0, Math.floor(pick?.turn ?? 0));
  const order = createRng(((seed >>> 0) ^ hashSalt(salt)) >>> 0).shuffle(Array.from({ length: n }, (_, i) => i));
  return order[turn % n] as number;
}

export function pickLine(bank: readonly string[], pick: LinePick | null | undefined, salt: string): string {
  return bank[pickIndex(bank.length, pick, salt)] as string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- his reasons, the moment the look ends ----------

export const WALK = {
  talking: [
    'Empty. You started talking the moment you looked.',
    'Empty. Nobody chats over a full safe. You did.',
    'Empty. The second you saw it, you started talking.',
    'Empty. You talked right over it. I pass.',
    'Empty. Quiet thieves stay quiet over cash. You got chatty.',
    'Empty. Talk all you like. I heard enough.',
  ],
  breath: (s: string): string[] => [
    `Empty. Your breath stopped for ${s} seconds.`,
    `Empty. You held your breath ${s} seconds. I counted.`,
    `Empty. ${s} seconds without a breath. I pass.`,
    `Empty. Your chest went still for ${s} seconds.`,
    `Empty. You froze your breath for ${s} seconds. That is a tell.`,
    `Empty. I watched you hold it ${s} seconds. No deal.`,
  ],
  shallow: (p: number): string[] => [
    `Empty. Your breathing went ${p} percent shallower.`,
    `Empty. Your breaths shrank by ${p} percent. I saw it.`,
    `Empty. ${p} percent shallower the moment you looked. I pass.`,
    `Empty. You started breathing small, ${p} percent smaller.`,
    `Empty. Your chest barely moved, ${p} percent less than your calm.`,
    `Empty. Shallow breaths, ${p} percent down. No deal.`,
  ],
  noBreath: [
    'Empty. You did not take a single breath.',
    'Empty. Not one breath the whole look. I pass.',
    'Empty. You forgot to breathe. A full safe never does that.',
    'Empty. The whole look, no breath at all.',
    'Empty. You held it the whole way. No deal.',
    'Empty. Your chest never moved once. I pass.',
  ],
  rate: (dir: string, r: number): string[] => [
    `Empty. Your breathing ${dir} by ${r} percent.`,
    `Empty. Your breath ${dir} ${r} percent the moment you looked.`,
    `Empty. ${r} percent off your calm pace. I pass.`,
    `Empty. Your breathing ${dir}, ${r} percent. That tells me plenty.`,
    `Empty. You changed pace by ${r} percent. No deal.`,
    `Empty. Calm thieves keep their pace. Yours ${dir} ${r} percent.`,
  ],
  blinkStop: (w: number): string[] => [
    `Empty. You stopped blinking for ${w} seconds.`,
    `Empty. Not one blink in ${w} seconds. I pass.`,
    `Empty. Your eyes locked open for ${w} seconds.`,
    'Empty. You stared and never blinked. No deal.',
    `Empty. ${w} seconds without a blink. That is a tell.`,
    'Empty. Your blinking stopped dead. I saw it.',
  ],
  blinkBurst: (n: number, w: number, e: number): string[] => [
    `Empty. You blinked ${n} times in ${w} seconds. You usually blink ${e}.`,
    `Empty. ${n} blinks in ${w} seconds. Your calm is ${e}.`,
    `Empty. Your eyes got busy, ${n} blinks where you usually do ${e}.`,
    `Empty. You blinked ${n} times. On a calm look you do ${e}.`,
    `Empty. ${n} blinks in one look. Too many. I pass.`,
    `Empty. Blink, blink, blink. ${n} times in ${w} seconds.`,
  ],
  smile: [
    'Empty. You smiled, and you smiled the same way at your last empty safe.',
    'Empty. That smile again. You wore it at your last empty safe too.',
    'Empty. I know that smile. It came with an empty safe last time.',
    'Empty. Nice smile. Same one you gave me on an empty safe.',
    'Empty. You grinned the way you grin at empty safes.',
    'Empty. That is the smile you give an empty safe. I pass.',
  ],
  smileDrop: [
    'Empty. Your smile dropped the moment you looked.',
    'Empty. The smile left your face fast. I pass.',
    'Empty. You stopped smiling the second you saw it.',
    'Empty. Your face fell. No deal.',
    'Empty. You were all smiles, then you looked.',
    'Empty. Where did that smile go? I pass.',
  ],
  alarm: (a: number): string[] => [
    `Empty. Your face jumped: surprise up ${a} points.`,
    `Empty. Your face jumped ${a} points. I saw the shock.`,
    `Empty. Surprise all over your face, ${a} points up.`,
    `Empty. You flinched. Your face moved ${a} points.`,
    `Empty. Your brows gave it away, ${a} points of surprise.`,
    `Empty. That jump on your face says empty. ${a} points.`,
  ],
  sold: (dd: string): string[] => [
    `Not worth it. You already sold me ${dd}.`,
    `No deal. You sold me ${dd} already. Once bitten.`,
    `I pass. After ${dd} from you, I am careful.`,
    `Not this time. You sold me ${dd} before.`,
    `I pass. You already slipped me ${dd}.`,
    `No deal. I remember ${dd} you sold me.`,
  ],
  vague: [
    'Empty. Something changed when you looked. I pass.',
    'Empty. I cannot say what, but you changed. I pass.',
    'Empty. You moved wrong when you looked.',
    'Empty. Something in you shifted. No deal.',
    'Empty. Gut call. Something was off.',
    'Empty. Too many little things. I pass.',
  ],
} as const;

// His offers never say the price out loud: it is printed big on the offer card, and every spoken line
// has a recorded clip (npm run voice), which a free number would break.

export const UNREAD = [
  'I could not read you on that one, so I pay low.',
  'I lost you there. This is a blind offer.',
  'Out of my sight, out of my price. Take it or leave it.',
  'Could not see you. That is my price and no more.',
  'You slipped my eye. Take it or leave it.',
  'I could not watch you, so I pay blind.',
] as const;

export const OFFER = {
  smileCalm: [
    "Gold? You smiled, but your breathing did not change. I'm not sure. That is my price.",
    'A smile, but calm breath. Maybe gold, maybe not.',
    'You smiled. Your breath did not. That is my offer.',
    'That smile says gold. Your breath says maybe.',
    "Nice smile. Calm chest. I'll meet you halfway.",
    'I saw a smile, nothing else. That is all I pay.',
  ],
  bigSmile: [
    "Gold bars. That smile was real. I'll pay well.",
    'That grin says gold.',
    'You lit up. Gold, I bet.',
    'Real smile, real gold. I am buying.',
    'That smile was worth something. So is my offer.',
    'Gold. Your face gave it away.',
  ],
  big: [
    'Gold bars. Your breathing picked up. Here is my price.',
    'Gold, I think. That is my offer.',
    "Something good in there. I'll pay.",
    'Big one, I can tell.',
    'That looks like gold to me.',
    'I smell gold. My money is on the table.',
  ],
  close: (what: string): string[] => [
    `Close call. Something in ${what} moved. I'll risk it.`,
    `I almost passed. ${cap(what)} moved.`,
    `Something in ${what} bugs me. I'll still pay.`,
    `On the edge. ${cap(what)} twitched. Final offer.`,
    `I do not love ${what}. This is generous.`,
    `Risky. ${cap(what)} moved a little.`,
  ],
  calm: [
    'Full, I think. Your breath stayed even.',
    'Your breath never broke. Full.',
    'Steady breathing. I believe it.',
    "Even breath, calm eyes. I'll pay.",
    "Not a ripple in your breath. I'm buying.",
    'Smooth breathing. Full, I say.',
  ],
  plain: [
    'Full, I think. Here is my price.',
    'Looks full to me.',
    "I'll take a chance.",
    'Full, probably. My money is on the table.',
    'I buy it.',
    'Fair enough. That is my price for the safe.',
  ],
} as const;

/** On The Ghost he keeps his reasons: only this, while the price shows on the card. */
export const GHOST_OFFER = 'That is my price. Take it or leave it.';

// ---------- the replay, once the safe is settled ----------

export const VERDICT = {
  walkDud: (d: string): string[] => [
    `There. ${d} I knew it was empty.`,
    `See that? ${d} Empty, like I said.`,
    `${d} That is why I passed. Empty.`,
    `Right there. ${d} Called it.`,
    `${d} Never fails. Empty.`,
    `Look. ${d} I had you.`,
  ],
  walkLoot: (d: string): string[] => [
    `There. ${d} So I passed.`,
    `${d} So I passed. My loss.`,
    `See? ${d} That spooked me.`,
    `${d} I passed. Should I have?`,
    `Right there. ${d} I walked away.`,
    `${d} That was enough for me to pass.`,
  ],
  unread: [
    'I could not read you there, so I offered blind.',
    'You were out of sight. My offer was blind.',
    'I lost you on that one. A blind guess.',
    'No read on you there. I guessed.',
    'You slipped away from me. Blind offer.',
    'Could not see a thing. I guessed.',
  ],
  missedSaw: [
    'I saw something, but not enough. You got me.',
    'I felt it, but I bought it. You got me.',
    'Something moved. Not enough. Well played.',
    'I almost had you there. Not quite.',
    'A flicker, nothing more. You got me.',
    'I saw a hint and let it go. My mistake.',
  ],
  missed: [
    'I saw nothing. You got me.',
    'Not a flicker. You got me clean.',
    'Cool as ice. I never saw it.',
    'Nothing showed. Well played.',
    'You gave me nothing. Good work.',
    'Clean. I did not see it coming.',
  ],
  dudKept: [
    'I would have bought that empty safe. You kept it.',
    'I saw nothing, and you kept the empty safe anyway.',
    'You had me fooled, then kept the empty safe.',
    'I was ready to pay. You kept it.',
    'Fooled me, and you did not cash in.',
    'You beat me and walked away from the money.',
  ],
  believedCalm: [
    'Your breath stayed even. I believed you.',
    'Calm breath, full safe. I believed it.',
    'You stayed steady. I bought it.',
    'Even breathing. I trusted it.',
    'Nothing moved. I took your word.',
    'Steady as a vault door. I believed you.',
  ],
  believed: [
    'I believed you.',
    'I read full, and full it was.',
    'I trusted that one.',
    'Full, like I thought.',
    'I called full. Right again.',
    'Fair enough. That one was real.',
  ],
} as const;

// ---------- strikes ----------

export const STRIKE = {
  /** first strike: an empty safe you sold him, found at his audit */
  sold: [
    'That empty safe you sold me? That is one strike.',
    'My audit found it empty. Strike one.',
    'I opened it. Empty. One strike.',
    'You sold me an empty safe. Strike one. Do not do it again.',
    'An empty safe in my bag. That is a strike.',
    'I checked. Nothing inside. Strike one.',
  ],
  /** first strike: Double Cross, he caught you at an empty safe */
  caught: [
    'I caught you at an empty safe. That is a strike.',
    'Empty, and I saw it. Strike one.',
    'Caught you. One strike.',
    'Nice try. That empty safe is a strike.',
    'I saw the empty safe on you. Strike one.',
    'Caught at an empty safe. That costs you a strike.',
  ],
  /** the second strike: busted */
  busted: [
    'Another empty safe. Two strikes. Sound the alarm.',
    'Strike two. You are done here.',
    'Two empty safes. Two strikes. Get out.',
    'That is strike two. The alarm is on.',
    'Second empty safe, second strike. You are busted.',
    'Two strikes. Nobody cheats me twice.',
  ],
} as const;

/** His line for a strike. `strikes` is the count after this one. */
export function strikeLine(strikes: number, how: 'sold' | 'caught', pick: LinePick | null | undefined): string {
  if (strikes >= 2) return pickLine(STRIKE.busted, pick, 'strike.busted');
  return pickLine(how === 'caught' ? STRIKE.caught : STRIKE.sold, pick, `strike.${how}`);
}

// ---------- the last safe, double or nothing ----------

export const FINAL = {
  dudBreath: [
    'Empty. I saw your breath stop.',
    'Empty. You held your breath. I call it empty.',
    'Empty. Your chest went still. I know that look.',
    'Empty. That breath hold says it all.',
    'Empty. You stopped breathing when you looked.',
    'Empty. Your breath gave it away.',
  ],
  dud: [
    'Empty. Something changed when you looked.',
    'Empty. I read you. You found nothing.',
    'Empty. Your body says so.',
    'Empty. I have seen that look on you before.',
    'Empty. You could not hide that one.',
    'Empty. You moved like you do at empty safes.',
  ],
  loot: [
    'Full. You looked too calm to be bluffing.',
    'Full. Your breath never broke.',
    'Full. Nothing moved on you.',
    'Full. You are too steady for an empty safe.',
    'Full. I believe what I see.',
    'Full. Calm face, calm breath.',
  ],
  /** the camera lost you: no read, so no bet */
  none: [
    'I could not see you. No bet. Keep your take.',
    'I lost you on that one. The bet is off.',
    'No read on you, so no call. Keep what you have.',
    'Out of my sight. I will not bet blind. Keep it.',
    'I could not watch you. No bet this time.',
    'You slipped out of view. The bet is off.',
  ],
  /** he called it right: your take is gone */
  right: [
    'I called it. Your take is mine.',
    'Right again. You leave with nothing.',
    'Called it. Double or nothing, and it is nothing.',
    'I read you. Empty pockets tonight.',
    'Told you. Hand it over.',
    'My call was right. Better luck next job.',
  ],
  /** he called it wrong: your take doubles */
  wrong: [
    'I was wrong. Take double and go.',
    'You fooled me. Your take doubles.',
    'Wrong call. Double it is.',
    'You got me on the last one. Double.',
    'I missed it. Enjoy the double.',
    'Well played. Double your take.',
  ],
} as const;

// ---------- he remembers you ----------

export const MEMORY = {
  named: (past: string, side: string): string[] => [
    `Last time ${past} at ${side}. I am watching for that now.`,
    `I remember you. Last time ${past} at ${side}.`,
    `Welcome back. Last time ${past} at ${side}. Not again.`,
    `Last job ${past} at ${side}. I wrote it down.`,
    `I know your tell. Last time ${past} at ${side}.`,
    `Last time ${past} at ${side}. Let us see if you learned.`,
  ],
  none: [
    'Last time I could not find your tell. I am looking harder now.',
    'You hid well last time. Not today.',
    'I found nothing on you last time. I am watching closer.',
    'Last time you gave me nothing. Let us try again.',
    'No tell last time. I will find it.',
    'You beat my eyes last time. I am sharper now.',
  ],
} as const;
