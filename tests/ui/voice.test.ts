import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BASELINE_MS, GHOST_OFFER, PEEK_MS, SimBody, extractFeatures, learnBaseline, makeSimPlayer, newGame, replayVerdict, step,
  type GameState, type Strategy,
} from '../../src/renderer/engine';
import { LITERAL_LINES, families, renderUnits, replayDetails, spokenLines } from '../../src/renderer/voice/catalog';
import { MANIFEST, normalizeLine, planClips, splitSentences } from '../../src/renderer/ui/voiceClips';

const ROOT = join(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'src', 'renderer', 'public');

describe('his voice: every line he can say has a recorded clip', () => {
  test('the catalog is finite and small', () => {
    // numbers he says come from fixed sets (replay.ts saySeconds and friends), so the details stay few
    expect(replayDetails().length).toBeLessThan(120);
    expect(renderUnits().length).toBeLessThan(600);
    // offers never say the price
    const offers = families().find((f) => f.name === 'offer')!.lines;
    for (const l of offers) expect(l).not.toMatch(/\d/);
    expect(offers).toContain(GHOST_OFFER);
  });

  test('every spoken line plays from clips, whole or sentence by sentence', () => {
    const missing = spokenLines().filter((l) => planClips(l) === null);
    expect(missing).toEqual([]);
    // whole lines play as one clip; only the replay's built lines are joined from sentences
    for (const fam of families()) {
      if (fam.split) continue;
      for (const l of fam.lines) expect(planClips(l)).toHaveLength(1);
    }
  });

  test('every clip in the manifest is on disk, and nothing else is', () => {
    const files = new Set(Object.values(MANIFEST.clips).map(([f]) => f));
    for (const f of files) {
      const p = join(PUBLIC, f);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(1000);
    }
    const onDisk = readdirSync(join(PUBLIC, 'voice')).filter((f) => f.endsWith('.ogg')).map((f) => `voice/${f}`);
    expect(onDisk.filter((f) => !files.has(f))).toEqual([]);
    for (const [, ms] of Object.values(MANIFEST.clips)) { expect(ms).toBeGreaterThan(250); expect(ms).toBeLessThan(9000); }
    // nothing more than what the catalog asks for
    const keys = new Set(renderUnits().map((u) => u.key));
    expect(Object.keys(MANIFEST.clips).filter((k) => !keys.has(k))).toEqual([]);
  });

  test('the literal strings Game.tsx speaks are all in the catalog', () => {
    const src = readFileSync(join(ROOT, 'src', 'renderer', 'ui', 'Game.tsx'), 'utf8');
    const found: string[] = [];
    let i = src.indexOf('speak(');
    while (i >= 0) {
      // the argument list, up to the matching close paren
      let depth = 0; let j = i + 'speak'.length;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') { depth--; if (depth === 0) break; }
      }
      const args = src.slice(i + 'speak('.length, j);
      expect(args, `a spoken template with a number cannot have a clip: ${args}`).not.toMatch(/`[^`]*\$\{/);
      for (const m of args.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
        // a string compared against (fc.call === 'dud') is not spoken
        if (/[!=]==\s*$/.test(args.slice(0, m.index))) continue;
        found.push((m[1] ?? m[2] ?? '').replace(/\\'/g, "'"));
      }
      i = src.indexOf('speak(', j);
    }
    expect(found.length).toBeGreaterThan(3);
    for (const s of found) expect(LITERAL_LINES as readonly string[]).toContain(s);
    // the end of job tell has its own fallback line in Game.tsx
    expect(src).toContain("'I could not find your tell this time.'");
  });

  test('the lookup splits sentences and ignores case and spacing', () => {
    expect(splitSentences('There. You stopped breathing for 3 seconds. I knew it was empty.')).toEqual([
      'There.', 'You stopped breathing for 3 seconds.', 'I knew it was empty.',
    ]);
    expect(splitSentences('See that? Something changed when you looked. Empty, like I said.')).toHaveLength(3);
    expect(normalizeLine('  Too   SLOW. ')).toBe('too slow.');
    const clips = { 'there.': ['a', 1] as const, 'too slow.': ['b', 1] as const, 'there. too slow.': ['c', 1] as const };
    expect(planClips('There. Too slow.', clips)).toEqual([['c', 1]]);
    expect(planClips('There.  There. Too slow.', clips)).toEqual([['a', 1], ['c', 1]]);
    expect(planClips('There. Nope.', clips)).toBeNull();
  });

  test('lines from real games, as Game.tsx speaks them, all have clips', () => {
    const said = new Set<string>();
    const strategies: Strategy[] = ['honest', 'steady', 'freeze', 'hide'];
    for (let seed = 1; seed <= 5; seed++) {
      for (const strategy of strategies) {
        const p = makeSimPlayer(strategy, seed);
        const body = new SimBody(p, seed, 15);
        const bl = learnBaseline(body.run(BASELINE_MS));
        let s: GameState = step(step(step(newGame(seed, 3, { caughtDudStrike: seed % 2 === 0 }), { type: 'begin' }), { type: 'baselineDone', baseline: bl }), { type: 'practiceDone', peeks: [] });
        for (let turn = 0; turn < 12 && s.phase !== 'reveal' && s.phase !== 'over'; turn++) {
          if (s.phase === 'finalChoice') { s = step(s, { type: 'finalBet' }); continue; }
          if (s.phase !== 'board') break;
          const box = s.boxes.find((b) => b.state === 'sealed');
          if (!box) break;
          s = step(s, { type: 'choose', boxId: box.id });
          body.run(1000); body.react(box.kind);
          s = step(s, { type: 'peekDone', features: extractFeatures(body.run(PEEK_MS), bl) });
          if (s.phase === 'finalCall') { said.add(s.finalCall!.line!); s = step(s, { type: 'next' }); break; }
          if (s.phase === 'bankerRead') {
            said.add(s.read!.reason);
            s = step(s, turn % 2 ? { type: 'sell', elapsedMs: 0 } : { type: 'open' });
          }
          const o = s.lastOutcome!;
          said.add(replayVerdict(o.features, s.read!, o.kind, s.level, { result: o.result, strike: o.strike, strikes: o.strikes }).line);
          if (s.phase === 'audit') s = step(s, { type: 'next' });
        }
      }
    }
    expect(said.size).toBeGreaterThan(15);
    const missing = [...said].filter((l) => planClips(l) === null);
    expect(missing).toEqual([]);
  }, 120000);
});
