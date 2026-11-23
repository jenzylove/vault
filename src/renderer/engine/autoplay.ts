/**
 * SIMULATED games: a simulated body plays the real reducer with a simple decision policy.
 * Used by the incentive probe and the keyless demo's autoplay. Nothing here is a real person.
 */
import type { BoxKind } from './types';
import { learnBaseline } from './baseline';
import { extractFeatures } from './features';
import { MAX_STRIKES, RULES, newGame, offerAt, step, type GameState, type RunRules, type Scoreboard } from './game';
import { SimBody, makeSimPlayer, type Strategy } from './sim';
import { createRng } from './rng';
import { BASELINE_MS, PEEK_MS, PEEK_LEAD_MS } from './timing';
import type { LevelNo } from './levels';
import type { BankerMemory } from './memory';

export { PEEK_MS, BASELINE_MS } from './timing';

/** rational: sells a treasure only above its value, sells a dud only while a strike would not bust it.
 *  greedy: same, but sells every dud and never leaves. */
export type Policy = 'rational' | 'greedy';

/** What a simulated player does at the last safe when the take is on the line: walk out (default) or bet it. */
export type FinalPolicy = 'leave' | 'bet';

export interface SimGameResult extends Scoreboard {
  strategy: Strategy;
  policy: Policy;
  seed: number;
  peeks: number;
  trapWalks: number;
  trapSaleTotal: number;     // money from traps sold to the banker
  burnedValue: number;       // treasure value the banker burned
  offersSeen: number;
}

export function wantsToSell(s: GameState, kind: BoxKind, value: number, policy: Policy, elapsedMs = 0): boolean {
  const offer = offerAt(s.read?.offer ?? 0, elapsedMs);
  if (kind !== 'trap') return offer > value;
  if (offer <= 0) return false;
  if (policy === 'greedy') return true;
  // a dud he finds is a strike: never take the one that would bust you
  return s.strikes + RULES.strikesPerDudFound < MAX_STRIKES;
}

export function wantsToLeave(s: GameState, policy: Policy): boolean {
  if (policy === 'greedy') return false;
  // Double Cross: one strike down, a dud he catches you at would bust you
  return s.rules.caughtDudStrike && s.strikes >= MAX_STRIKES - 1;
}

export interface SimOpts {
  fps?: number; policy?: Policy; level?: LevelNo; practice?: boolean; peekMs?: number; rules?: Partial<RunRules>; final?: FinalPolicy;
  /** what he remembers from this player's earlier jobs (memory.ts) */
  memory?: BankerMemory;
  /** the same body plays another job: seeds the safes and the body's draws, not who the player is */
  job?: number;
}

export function runSimGame(strategy: Strategy, seed: number, opts: SimOpts = {}): SimGameResult {
  return playSimGame(strategy, seed, opts).result;
}

/** Same as runSimGame, but also hands back the final state (for tell sheets in the demo and tests). */
export function playSimGame(strategy: Strategy, seed: number, opts: SimOpts = {}): { result: SimGameResult; state: GameState } {
  const policy = opts.policy ?? 'rational';
  const player = makeSimPlayer(strategy, seed);
  const gameSeed = opts.job ? seed + 7919 * opts.job : seed;
  const body = new SimBody(player, gameSeed, opts.fps ?? 15);
  const r = createRng(gameSeed * 31 + 7);

  const peekMs = opts.peekMs ?? PEEK_MS;
  let s = newGame(gameSeed, opts.level, opts.rules);
  if (opts.memory) s = step(s, { type: 'remember', memory: opts.memory });
  s = step(s, { type: 'begin' });
  const baseline = learnBaseline(body.run(BASELINE_MS), peekMs);
  s = step(s, { type: 'baselineDone', baseline });

  // Practice is optional: offered on a player's first game, skipped by default after that.
  const practice = !opts.practice ? [] : s.practice.map((p) => {
    body.run(PEEK_LEAD_MS);
    body.react(p.kind);
    return { kind: p.kind, features: extractFeatures(body.run(peekMs), baseline) };
  });
  s = step(s, { type: 'practiceDone', peeks: practice });

  let peeks = 0;
  let trapWalks = 0;
  const finalPolicy = opts.final ?? 'leave';
  while (s.phase === 'board' || s.phase === 'finalChoice') {
    if (s.phase === 'finalChoice') { s = step(s, { type: finalPolicy === 'bet' ? 'finalBet' : 'leave' }); continue; }
    if (!s.finalBet && wantsToLeave(s, policy)) { s = step(s, { type: 'leave' }); break; }
    const sealed = s.boxes.filter((b) => b.state === 'sealed');
    const box = r.pick(sealed);
    s = step(s, { type: 'choose', boxId: box.id });
    body.run(PEEK_LEAD_MS);
    body.react(box.kind);
    s = step(s, { type: 'peekDone', features: extractFeatures(body.run(peekMs), baseline) });
    peeks++;
    if (s.phase === 'bankerRead') {
      s = step(s, wantsToSell(s, box.kind, box.value, policy) ? { type: 'sell', elapsedMs: 0 } : { type: 'open' });
    } else if (s.phase === 'finalCall') {
      s = step(s, { type: 'next' });
    } else if (box.kind === 'trap') trapWalks++;
    if (s.phase === 'audit') s = step(s, { type: 'next' });
  }
  if (s.phase === 'audit' || s.phase === 'board') s = step(s, { type: 'leave' });
  if (s.phase === 'reveal') s = step(s, { type: 'reveal' });
  const score = s.score as Scoreboard;
  const trapSaleTotal = s.log.filter((o) => o.kind === 'trap' && o.result === 'sold').reduce((a, o) => a + (o.paid ?? 0), 0);
  const burnedValue = s.log.filter((o) => o.kind !== 'trap' && o.result === 'burned').reduce((a, o) => a + o.value, 0);
  const offersSeen = s.log.filter((o) => o.decision !== 'walk').length;
  return { result: { ...score, strategy, policy, seed, peeks, trapWalks, trapSaleTotal, burnedValue, offersSeen }, state: s };
}
