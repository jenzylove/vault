import { describe, expect, it } from 'vitest';
import { MODES, musicMode, stingsFor, walkBar, type MusicSnap } from '../../src/renderer/ui/music';

const base: MusicSnap = {
  screen: 'play', phase: 'board', stage: 'board', practice: 'intro', paused: false, pace: 1, gameNo: 1,
  logLen: 0, last: null, strikes: 0, busted: false, finalStage: 0, finalRight: null,
};
const snap = (o: Partial<MusicSnap>): MusicSnap => ({ ...base, ...o });

describe('music follows the job', () => {
  it('picks a bed for every screen and phase', () => {
    expect(musicMode(snap({ screen: 'title' }))).toBe('menu');
    expect(musicMode(snap({ screen: 'jobs' }))).toBe('menu');
    expect(musicMode(snap({ screen: 'lineup' }))).toBe('calm');
    expect(musicMode(snap({ phase: 'baseline', stage: 'baseline' }))).toBe('calm');
    expect(musicMode(snap({ phase: 'practice', stage: 'practice', practice: 'peek' }))).toBe('look');
    expect(musicMode(snap({}))).toBe('board');
    expect(musicMode(snap({ phase: 'peek', stage: 'lead' }))).toBe('crack');
    expect(musicMode(snap({ phase: 'peek', stage: 'look' }))).toBe('look');
    expect(musicMode(snap({ phase: 'bankerRead', stage: 'offer' }))).toBe('offer');
    expect(musicMode(snap({ phase: 'bankerRead', stage: 'tooslow' }))).toBe('call');
    expect(musicMode(snap({ phase: 'audit', stage: 'replay' }))).toBe('replay');
    expect(musicMode(snap({ phase: 'reveal', stage: 'replay' }))).toBe('replay');
    expect(musicMode(snap({ phase: 'finalChoice', stage: 'finalChoice' }))).toBe('last');
    expect(musicMode(snap({ phase: 'finalCall', stage: 'call0', finalStage: 0 }))).toBe('call');
    expect(musicMode(snap({ phase: 'finalCall', stage: 'call2', finalStage: 2 }))).toBe('after');
    expect(musicMode(snap({ phase: 'reveal', stage: 'reveal' }))).toBe('reveal');
    expect(musicMode(snap({ phase: 'over', stage: 'over' }))).toBe('over');
    expect(musicMode(snap({ phase: 'audit', stage: 'replay', busted: true }))).toBe('bust');
    expect(musicMode(snap({ paused: true }))).toBe('paused');
  });

  it('plays nothing in screenshot mode', () => {
    expect(musicMode(snap({ pace: 4 }))).toBe('off');
    expect(stingsFor(snap({ pace: 4 }), snap({ pace: 4, logLen: 1, last: { result: 'sold', strike: false, expired: false, final: false } }))).toEqual([]);
  });

  it('drops to near silence on the look: no beat, only the drone', () => {
    const look = MODES.look;
    expect(look.bass).toBeNull();
    expect(look.hats).toBeNull();
    expect(look.brush).toBe(0);
    expect(look.kick).toBeNull();
    expect(look.pad).toBe(0);
    expect(look.drone).toBeGreaterThan(0);
    // the offer is tighter than the board: sixteenths and a pedal bass
    expect(MODES.offer.hats).toBe('tight');
    expect(MODES.offer.bass).toBe('ostinato');
  });

  it('stings each settled safe once, by how it settled', () => {
    const settled = (result: string, o: Partial<MusicSnap> = {}, extra: Partial<NonNullable<MusicSnap['last']>> = {}): MusicSnap =>
      snap({ logLen: 1, last: { result, strike: false, expired: false, final: false, ...extra }, ...o });
    expect(stingsFor(base, settled('sold'))).toEqual(['sold']);
    expect(stingsFor(base, settled('opened'))).toEqual(['kept']);
    expect(stingsFor(base, settled('opened', {}, { expired: true }))).toEqual([]);
    expect(stingsFor(base, settled('burned'))).toEqual(['passed']);
    expect(stingsFor(base, settled('sold', { strikes: 1 }, { strike: true }))).toEqual(['caught']);
    expect(stingsFor(snap({ strikes: 1 }), settled('sold', { strikes: 2, busted: true }, { strike: true }))).toEqual(['bust']);
    // the same snapshot again: nothing new
    expect(stingsFor(settled('sold'), settled('sold'))).toEqual([]);
    // a new job never stings for the old one's log
    expect(stingsFor(base, settled('sold', { gameNo: 2 }))).toEqual([]);
  });

  it('stings the last safe once his call is opened', () => {
    const call = snap({ phase: 'finalCall', finalStage: 1, logLen: 3, last: { result: 'opened', strike: false, expired: false, final: true } });
    expect(stingsFor(snap({ logLen: 2 }), call)).toEqual([]);
    expect(stingsFor(call, { ...call, finalStage: 2, finalRight: true })).toEqual(['finalLoss']);
    expect(stingsFor(call, { ...call, finalStage: 2, finalRight: false })).toEqual(['finalWin']);
    // he lost you: no bet, a neutral sting, never the win
    expect(stingsFor(call, { ...call, finalStage: 2, finalRight: null })).toEqual(['noBet']);
  });

  it('walks the bass from the root into the next chord', () => {
    let seed = 1;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const dm = { root: 38, tones: [0, 3, 7, 10, 14] };
    const bb = { root: 34, tones: [0, 4, 7, 11, 14] };
    for (let i = 0; i < 50; i++) {
      const bar = walkBar(dm, bb, rnd);
      expect(bar).toHaveLength(4);
      expect(bar[0]).toBe(38);
      for (const m of bar) { expect(m).toBeGreaterThanOrEqual(31); expect(m).toBeLessThanOrEqual(50); }
      // beat four leans into Bb by a half or whole step
      const d = Math.abs((bar[3] as number) - 46) % 12;
      expect([1, 2, 10, 11]).toContain(d);
    }
  });
});
