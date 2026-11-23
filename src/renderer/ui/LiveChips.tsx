/**
 * What he notices during the look, as it happens: a chip per signal he caught (a blink, a smile, a breath
 * held), brighter the more it moved him for this player. A fresh Fence barely reacts to a blink; once
 * blinking is your tell, the same blink lights up.
 */
import type { LiveNotice } from '../engine';

const heat = (lift: number): 'hot' | 'warm' | 'cold' => (lift >= 0.5 ? 'hot' : lift >= 0.15 ? 'warm' : 'cold');

export function LiveChips({ notices }: { notices: LiveNotice[] }): JSX.Element {
  return (
    <div className="live-chips" aria-live="polite">
      <span className="lc-lab">He noticed</span>
      {notices.length === 0
        ? <span className="lc none">nothing yet</span>
        : notices.map((n) => <span key={n.kind} className={`lc ${heat(n.lift)}`}>{n.label}</span>)}
    </div>
  );
}
