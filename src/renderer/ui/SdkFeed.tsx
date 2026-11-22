/**
 * The raw Presage feed, toggled with F: what the SDK is sending right now, before the game turns it into
 * tells. Numbers straight from the frames (breath traces, pulse, blinks, talking, expressions, confidence)
 * and the latest validation code, refreshed a few times a second. Nothing here is stored.
 */
import { useEffect, useRef, useState } from 'react';
import type { SignalFrame, SignalSource, ValidationInfo } from '../signals/types';

interface Snap {
  fps: number;
  chest: number[];
  pulse: number | null;
  conf: number;
  blinks10s: number;
  talking: boolean;
  expr: [string, number] | null;
}

const EMPTY: Snap = { fps: 0, chest: [], pulse: null, conf: 0, blinks10s: 0, talking: false, expr: null };

export function SdkFeed({ source, validation, sim }: { source: SignalSource | null; validation: ValidationInfo | null; sim: boolean }): JSX.Element | null {
  const frames = useRef<SignalFrame[]>([]);
  const arrivals = useRef<number[]>([]);
  const [snap, setSnap] = useState<Snap>(EMPTY);

  useEffect(() => {
    if (!source) return;
    frames.current = [];
    arrivals.current = [];
    const unsub = source.subscribe((f) => {
      frames.current.push(f);
      arrivals.current.push(performance.now());
      if (frames.current.length > 900) frames.current.splice(0, frames.current.length - 900);
      if (arrivals.current.length > 300) arrivals.current.splice(0, arrivals.current.length - 300);
    });
    const id = setInterval(() => {
      const now = performance.now();
      const fs = frames.current;
      const last = fs[fs.length - 1];
      if (!last) { setSnap(EMPTY); return; }
      const fps = arrivals.current.filter((a) => now - a < 1000).length;
      const recent = fs.filter((f) => last.t - f.t < 6000);
      const chest = recent.filter((f) => typeof f.chest === 'number').map((f) => f.chest as number);
      const pulse = [...fs].reverse().find((f) => typeof f.pulse === 'number')?.pulse ?? null;
      const blinks10s = fs.filter((f) => last.t - f.t < 10000 && f.blink === true).length;
      const talking = recent.slice(-15).some((f) => f.talking === true);
      const ex = [...fs].reverse().find((f) => f.expr)?.expr;
      let expr: [string, number] | null = null;
      if (ex) for (const [k, v] of Object.entries(ex)) if (typeof v === 'number' && (!expr || v > expr[1])) expr = [k, v];
      setSnap({ fps, chest, pulse, conf: last.conf, blinks10s, talking, expr });
    }, 150);
    return () => { clearInterval(id); unsub(); };
  }, [source]);

  const w = 220, h = 46;
  let path = '';
  if (snap.chest.length > 2) {
    const lo = Math.min(...snap.chest), hi = Math.max(...snap.chest);
    const span = hi - lo || 1;
    path = snap.chest.map((v, i) => `${i ? 'L' : 'M'}${((i / (snap.chest.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  }
  const row = (k: string, v: string) => <div className="sdkf-row"><span>{k}</span><b>{v}</b></div>;
  return (
    <div className="sdkf panel" aria-label="Raw Presage feed">
      <div className="sdkf-head">{sim ? 'Sample body feed (simulated)' : 'Presage SmartSpectra, live'}<span>F hides</span></div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sdkf-trace" aria-label="Upper breathing trace, last 6 seconds">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <div className="sdkf-cap">upper breathing trace, last 6 s</div>
      {row('frames a second', String(snap.fps))}
      {row('pulse', snap.pulse === null ? 'settling' : `${Math.round(snap.pulse)} bpm`)}
      {row('confidence', snap.conf.toFixed(2))}
      {row('blinks, last 10 s', String(snap.blinks10s))}
      {row('talking', snap.talking ? 'yes' : 'no')}
      {row('top expression', snap.expr ? `${snap.expr[0]} ${snap.expr[1].toFixed(2)}` : 'none yet')}
      {row('validation', validation ? (validation.code === 0 ? '0 ok' : `${validation.code} ${validation.hint}`.slice(0, 34)) : 'none yet')}
    </div>
  );
}
