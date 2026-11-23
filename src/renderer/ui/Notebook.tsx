/**
 * His notebook: the model made visible. One row per signal this Fence can read, a bar for how far apart
 * your empty and full safes are on it, one word for how sure he is, and which kind of safe it shows at.
 * The row an audit moved pulses for a moment. On the end screen it shows what this job taught him.
 */
import { useEffect, useRef, useState } from 'react';
import { notebook, type BankerModel, type NoteRow } from '../engine';

/** Bar length: a gap of two spreads fills it. */
const fill = (sep: number): number => Math.min(1, Math.abs(sep) / 2);
const pct = (x: number): string => `${Math.round(4 + 96 * x)}%`;

function Row({ r, was, pulse }: { r: NoteRow; was?: NoteRow; pulse: number }): JSX.Element {
  const cls = r.word === 'sure' ? 'sure' : r.word === 'a hunch' ? 'hunch' : 'none';
  return (
    <div key={pulse ? `p${pulse}` : 'still'} className={`nb-row ${cls}${pulse ? ' pulse' : ''}`}>
      <span className="nb-lab">{r.label}</span>
      <span className="nb-word">{r.word}</span>
      <span className="nb-bar">
        {was && <i className="was" style={{ width: pct(fill(was.sep)) }} />}
        <i className="now" style={{ width: pct(fill(r.sep)) }} />
      </span>
      <span className="nb-side">{r.side ? `at ${r.side} safes` : ' '}</span>
    </div>
  );
}

/** During a job: what he knows about you right now. */
export function Notebook({ model }: { model: BankerModel }): JSX.Element {
  const nb = notebook(model);
  const prev = useRef<{ n: number; seps: Record<string, number> } | null>(null);
  const [pulse, setPulse] = useState<{ key: string; at: number } | null>(null);
  const n = model.examples.length;
  useEffect(() => {
    const seps = Object.fromEntries(nb.rows.map((r) => [r.key, r.sep]));
    const p = prev.current;
    prev.current = { n, seps };
    if (!p || p.n === n || n < p.n) return;
    // the row this audit moved most
    let best: string | null = null;
    let d = 0.04;
    for (const r of nb.rows) {
      const dd = Math.abs(Math.abs(r.sep) - Math.abs(p.seps[r.key] ?? 0));
      if (dd > d) { d = dd; best = r.key; }
    }
    if (best) setPulse({ key: best, at: performance.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return (
    <div className="notebook panel" aria-label="What he knows about you">
      <div className="nb-head">
        <div className="nb-title">What he knows about you</div>
        <div className="nb-count"><b>{nb.watched}</b> {nb.watched === 1 ? 'safe' : 'safes'} watched{nb.remembered > 0 && <>, <b>{nb.remembered}</b> from earlier jobs</>}</div>
      </div>
      {nb.rows.map((r) => <Row key={r.key} r={r} pulse={pulse && pulse.key === r.key ? pulse.at : 0} />)}
    </div>
  );
}

/** End screen: what this job taught him (the faint bar is where he started the job). */
export function NotebookLearned({ before, after }: { before: BankerModel; after: BankerModel }): JSX.Element {
  const a = notebook(after);
  const b = notebook(before);
  const was = Object.fromEntries(b.rows.map((r) => [r.key, r]));
  const fresh = a.watched - b.watched;
  return (
    <div className="notebook learned panel" aria-label="What he learned this job">
      <div className="nb-head">
        <div className="nb-title">What he learned this job</div>
        <div className="nb-count"><b>{fresh}</b> new {fresh === 1 ? 'safe' : 'safes'} in his notebook{b.watched > 0 && <>, <b>{b.watched}</b> he already knew</>}</div>
      </div>
      {a.rows.map((r) => <Row key={r.key} r={r} was={was[r.key]} pulse={0} />)}
      {b.watched > 0 && <div className="nb-foot">Faint bar: what he knew when the job began.</div>}
    </div>
  );
}
