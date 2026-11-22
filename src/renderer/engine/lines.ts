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
    'Dud. You started talking the moment you looked.',
    'Dud. Nobody chats over real loot. You did.',
    'Dud. The second you saw it, you started talking.',
    'Dud. You talked right over it. I pass.',
    'Dud. Quiet thieves keep loot. You got chatty.',
    'Dud. Talk all you like. I heard enough.',
  ],
  breath: (s: string): string[] => [
    `Dud. Your breath stopped for ${s} seconds.`,
    `Dud. You held your breath ${s} seconds. I counted.`,
    `Dud. ${s} seconds without a breath. I pass.`,
    `Dud. Your chest went still for ${s} seconds.`,
    `Dud. You froze your breath for ${s} seconds. That is a tell.`,
    `Dud. I watched you hold it ${s} seconds. No deal.`,
  ],
  shallow: (p: number): string[] => [
    `Dud. Your breathing went ${p} percent shallower.`,
    `Dud. Your breaths shrank by ${p} percent. I saw it.`,
    `Dud. ${p} percent shallower the moment you looked. I pass.`,
    `Dud. You started breathing small, ${p} percent smaller.`,
    `Dud. Your chest barely moved, ${p} percent less than your calm.`,
    `Dud. Shallow breaths, ${p} percent down. No deal.`,
  ],
  noBreath: [
    'Dud. You did not take a single breath.',
    'Dud. Not one breath the whole look. I pass.',
    'Dud. You forgot to breathe. Loot never does that.',
    'Dud. The whole look, no breath at all.',
    'Dud. You held it the whole way. No deal.',
    'Dud. Your chest never moved once. I pass.',
  ],
  rate: (dir: string, r: number): string[] => [
    `Dud. Your breathing ${dir} by ${r} percent.`,
    `Dud. Your breath ${dir} ${r} percent the moment you looked.`,
    `Dud. ${r} percent off your calm pace. I pass.`,
    `Dud. Your breathing ${dir}, ${r} percent. That tells me plenty.`,
    `Dud. You changed pace by ${r} percent. No deal.`,
    `Dud. Calm thieves keep their pace. Yours ${dir} ${r} percent.`,
  ],
  blinkStop: (w: number): string[] => [
    `Dud. You stopped blinking for ${w} seconds.`,
    `Dud. Not one blink in ${w} seconds. I pass.`,
    `Dud. Your eyes locked open for ${w} seconds.`,
    'Dud. You stared and never blinked. No deal.',
    `Dud. ${w} seconds without a blink. That is a tell.`,
    'Dud. Your blinking stopped dead. I saw it.',
  ],
  blinkBurst: (n: number, w: number, e: number): string[] => [
    `Dud. You blinked ${n} times in ${w} seconds. You usually blink ${e}.`,
    `Dud. ${n} blinks in ${w} seconds. Your calm is ${e}.`,
    `Dud. Your eyes got busy, ${n} blinks where you usually do ${e}.`,
    `Dud. You blinked ${n} times. On a calm look you do ${e}.`,
    `Dud. ${n} blinks in one look. Too many. I pass.`,
    `Dud. Blink, blink, blink. ${n} times in ${w} seconds.`,
  ],
  smile: [
    'Dud. You smiled, and you smiled the same way at your last dud.',
    'Dud. That smile again. You wore it at your last dud too.',
    'Dud. I know that smile. It came with a dud last time.',
    'Dud. Nice smile. Same one you gave me on a dud.',
    'Dud. You grinned the way you grin at duds.',
    'Dud. That is your dud smile. I pass.',
  ],
  smileDrop: [
    'Dud. Your smile dropped the moment you looked.',
    'Dud. The smile left your face fast. I pass.',
    'Dud. You stopped smiling the second you saw it.',
    'Dud. Your face fell. No deal.',
    'Dud. You were all smiles, then you looked.',
    'Dud. Where did that smile go? I pass.',
  ],
  alarm: (a: number): string[] => [
    `Dud. Your face jumped: surprise up ${a} points.`,
    `Dud. Your face jumped ${a} points. I saw the shock.`,
    `Dud. Surprise all over your face, ${a} points up.`,
    `Dud. You flinched. Your face moved ${a} points.`,
    `Dud. Your brows gave it away, ${a} points of surprise.`,
    `Dud. That jump on your face says dud. ${a} points.`,
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
    'Dud. Something changed when you looked. I pass.',
    'Dud. I cannot say what, but you changed. I pass.',
    'Dud. You moved wrong when you looked.',
    'Dud. Something in you shifted. No deal.',
    'Dud. Gut call. Something was off.',
    'Dud. Too many little things. I pass.',
  ],
} as const;

export const UNREAD = (o: number): string[] => [
  `I could not read you on that one, so I'll only pay ${o}.`,
  `I lost you there. Blind offer: ${o}.`,
  `Out of my sight, out of my price. ${o}.`,
  `Could not see you. I'll pay ${o} and no more.`,
  `You slipped my eye. ${o}, take it or leave it.`,
  `I could not watch you, so I pay blind. ${o}.`,
];

export const OFFER = {
  smileCalm: (o: number): string[] => [
    `Gold? You smiled, but your breathing did not change. I'm not sure. I'll pay ${o}.`,
    `A smile, but calm breath. Maybe gold, maybe not. ${o}.`,
    `You smiled. Your breath did not. I'll pay ${o}.`,
    `That smile says gold. Your breath says maybe. ${o}.`,
    `Nice smile. Calm chest. I'll meet you halfway: ${o}.`,
    `I saw a smile, nothing else. ${o} for it.`,
  ],
  bigSmile: (o: number): string[] => [
    `Gold bars. That smile was real. I'll pay ${o}.`,
    `That grin says gold. ${o}.`,
    `You lit up. Gold, I bet. ${o}.`,
    `Real smile, real gold. I'll pay ${o}.`,
    `That smile was worth something. ${o}.`,
    `Gold. Your face gave it away. ${o}.`,
  ],
  big: (o: number): string[] => [
    `Gold bars. Your breathing picked up. I'll pay ${o}.`,
    `Gold, I think. ${o} for it.`,
    `Something good in there. I'll pay ${o}.`,
    `Big one, I can tell. ${o}.`,
    `That looks like gold to me. ${o}.`,
    `I smell gold. ${o} on the table.`,
  ],
  close: (what: string, o: number): string[] => [
    `Close call. Something in ${what} moved. I'll risk ${o}.`,
    `I almost passed. ${cap(what)} moved. ${o}.`,
    `Something in ${what} bugs me. I'll still pay ${o}.`,
    `On the edge. ${cap(what)} twitched. ${o}, final.`,
    `I do not love ${what}. ${o}, and that is generous.`,
    `Risky. ${cap(what)} moved a little. ${o}.`,
  ],
  calm: (o: number): string[] => [
    `Real loot, I think. Your breath stayed even. I'll pay ${o}.`,
    `Your breath never broke. Loot. ${o}.`,
    `Steady breathing. I believe it. ${o}.`,
    `Even breath, calm eyes. I'll pay ${o}.`,
    `Not a ripple in your breath. ${o} for it.`,
    `Smooth breathing. Loot, I say. ${o}.`,
  ],
  plain: (o: number): string[] => [
    `Real loot, I think. I'll pay ${o}.`,
    `Looks like loot to me. ${o}.`,
    `I'll take a chance. ${o}.`,
    `Loot, probably. ${o} on the table.`,
    `I buy it. ${o}.`,
    `Fair enough. ${o} for the safe.`,
  ],
} as const;

// ---------- the replay, once the safe is settled ----------

export const VERDICT = {
  walkDud: (d: string): string[] => [
    `There. ${d} I knew it was a dud.`,
    `See that? ${d} Dud, like I said.`,
    `${d} That is why I passed. Dud.`,
    `Right there. ${d} Called it.`,
    `${d} Never fails. Dud.`,
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
    'I would have bought that dud. You kept it.',
    'I saw nothing, and you kept the dud anyway.',
    'You had me fooled, then kept the dud.',
    'I was ready to pay. You kept it.',
    'Fooled me, and you did not cash in.',
    'You beat me and walked away from the money.',
  ],
  believedCalm: [
    'Your breath stayed even. I believed you.',
    'Calm breath, real loot. I believed it.',
    'You stayed steady. I bought it.',
    'Even breathing. I trusted it.',
    'Nothing moved. I took your word.',
    'Steady as a vault door. I believed you.',
  ],
  believed: [
    'I believed you.',
    'I read loot, and loot it was.',
    'I trusted that one.',
    'Loot, like I thought.',
    'I called loot. Right again.',
    'Fair enough. That one was real.',
  ],
} as const;

// ---------- strikes ----------

export const STRIKE = {
  /** first strike: a dud you sold him, found at his audit */
  sold: [
    'That dud you sold me? That is one strike.',
    'My audit found the dud. Strike one.',
    'I opened it. Empty. One strike.',
    'You sold me a dud. Strike one. Do not do it again.',
    'Dud in my bag. That is a strike.',
    'I checked. Nothing inside. Strike one.',
  ],
  /** first strike: Double Cross, he caught you at a dud */
  caught: [
    'I caught you at a dud. That is a strike.',
    'Dud, and I saw it. Strike one.',
    'Caught you. One strike.',
    'Nice try. That dud is a strike.',
    'I saw the dud on you. Strike one.',
    'Caught at a dud. That costs you a strike.',
  ],
  /** the second strike: busted */
  busted: [
    'Another dud. Two strikes. Sound the alarm.',
    'Strike two. You are done here.',
    'Two duds. Two strikes. Get out.',
    'That is strike two. The alarm is on.',
    'Second dud, second strike. You are busted.',
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
    'Dud. I saw your breath stop.',
    'Dud. You held your breath. I call dud.',
    'Dud. Your chest went still. I know that look.',
    'Dud. That breath hold says it all.',
    'Dud. You stopped breathing. Double nothing.',
    'Dud. Your breath gave it away.',
  ],
  dud: [
    'Dud. Something changed when you looked.',
    'Dud. I read you. You found nothing.',
    'Dud. Your body says empty.',
    'Dud. I have seen that look before.',
    'Dud. Call it a hunch, but I am sure.',
    'Dud. You could not hide that one.',
  ],
  loot: [
    'Loot. You looked too calm to be bluffing.',
    'Loot. Your breath never broke.',
    'Loot. Nothing moved on you. Real loot.',
    'Loot. You are too steady for a dud.',
    'Loot. I believe what I see.',
    'Loot. Calm face, calm breath. Loot.',
  ],
  lootUnread: [
    'Loot. I could not read you, so I say loot.',
    'I lost you. I call loot.',
    'No read on you. I guess loot.',
    'Out of sight. Loot, I say.',
    'I could not see you. Loot.',
    'A blind call: loot.',
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
