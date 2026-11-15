/**
 * SIMULATED games: a simulated body plays the real reducer with a simple decision policy.
 * Used by the incentive probe and the keyless demo's autoplay. Nothing here is a real person.
 */
import type { BoxKind } from './types';
import { learnBaseline } from './baseline';
import { extractFeatures } from './features';
import { RULES, newGame, step, type GameState, type Scoreboard } from './game';
import { SimBody, makeSimPlayer, type Strategy } from './sim';
import { createRng } from './rng';

export const PEEK_MS = 8000;
export const BASELINE_MS = 30000;

/** rational: sells a treasure only above its value, never sells the trap that would bust it, leaves near full heat.
 *  greedy: same, but sells every trap and never leaves. */
export type Policy = 'rational' | 'greedy';

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

export function wantsToSell(s: GameState, kind: BoxKind, value: number, policy: Policy): boolean {
  const offer = s.read?.offer ?? 0;
  if (kind !== 'trap') return offer > value;
  if (offer <= 0) return false;
  if (policy === 'greedy') return true;
  // Plan the heat budget: after this sale, can I still peek every sealed box without busting?
  const sealed = s.boxes.filter((b) => b.state === 'sealed').length;
  const projected = s.heat + RULES.heatPerTrapBought + sealed * RULES.heatPerPeek + 0.5 * RULES.pulseHeatMax;
  return projected < RULES.bustAt;
}

export function wantsToLeave(s: GameState, policy: Policy): boolean {
  if (policy === 'greedy') return false;
  // the next peek alone adds heat; leave before it can tip the banker over
  return s.heat + RULES.heatPerPeek + 0.4 * RULES.pulseHeatMax >= RULES.bustAt;
}

export function runSimGame(strategy: Strategy, seed: number, opts: { fps?: number; policy?: Policy } = {}): SimGameResult {
  const policy = opts.policy ?? 'rational';
  const player = makeSimPlayer(strategy, seed);
  const body = new SimBody(player, seed, opts.fps ?? 15);
  const r = createRng(seed * 31 + 7);

  let s = step(newGame(seed), { type: 'begin' });
  const baseline = learnBaseline(body.run(BASELINE_MS));
  s = step(s, { type: 'baselineDone', baseline });

  const practice = s.practice.map((p) => {
    body.run(1500);
    body.react(p.kind);
    return { kind: p.kind, features: extractFeatures(body.run(PEEK_MS), baseline) };
  });
  s = step(s, { type: 'practiceDone', peeks: practice });

  let peeks = 0;
  let trapWalks = 0;
  while (s.phase === 'board') {
    if (wantsToLeave(s, policy)) { s = step(s, { type: 'leave' }); break; }
    const sealed = s.boxes.filter((b) => b.state === 'sealed');
    const box = r.pick(sealed);
    s = step(s, { type: 'choose', boxId: box.id });
    body.run(1500);
    body.react(box.kind);
    s = step(s, { type: 'peekDone', features: extractFeatures(body.run(PEEK_MS), baseline) });
    peeks++;
    if (s.phase === 'bankerRead') {
      s = step(s, { type: wantsToSell(s, box.kind, box.value, policy) ? 'sell' : 'open' });
    } else if (box.kind === 'trap') trapWalks++;
    if (s.phase === 'audit') s = step(s, { type: 'next' });
  }
  if (s.phase === 'audit' || s.phase === 'board') s = step(s, { type: 'leave' });
  if (s.phase === 'reveal') s = step(s, { type: 'reveal' });
  const score = s.score as Scoreboard;
  const trapSaleTotal = s.log.filter((o) => o.kind === 'trap' && o.result === 'sold').reduce((a, o) => a + (o.offer ?? 0), 0);
  const burnedValue = s.log.filter((o) => o.kind !== 'trap' && o.result === 'burned').reduce((a, o) => a + o.value, 0);
  const offersSeen = s.log.filter((o) => o.decision !== 'walk').length;
  return { ...score, strategy, policy, seed, peeks, trapWalks, trapSaleTotal, burnedValue, offersSeen };
}
