import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VaultScene, type VaultSceneProps } from '../scene/VaultScene';
import { MAX_STRIKES, PEEK_MS, VALUE_TABLE, type Baseline, type GameState, type Job, type ReplayMark } from '../engine';
import type { SignalFrame } from '../signals/types';
import type { SignalBus } from './signalBus';

/** Poll something off the signal bus at ~30 Hz without re-rendering the whole game. */
export function usePoll<T>(fn: () => T, deps: unknown[], ms = 33): T {
  const [v, setV] = useState<T>(fn);
  useEffect(() => {
    setV(fn());
    const id = setInterval(() => setV(fn()), ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/** The 3D room, fed live breath and heartbeat from the bus. */
export function LiveScene({ bus, ...rest }: Omit<VaultSceneProps, 'breath' | 'heartbeat'> & { bus: SignalBus | null }): JSX.Element {
  const sig = usePoll(() => ({ breath: bus ? bus.breath() : [], beat: bus ? bus.heartbeat() : 0 }), [bus]);
  return <VaultScene {...rest} breath={sig.breath} heartbeat={sig.beat} />;
}

export function BreathLine({ bus, small, big }: { bus: SignalBus | null; small?: boolean; big?: boolean }): JSX.Element {
  const pts = usePoll(() => (bus ? bus.breath() : []), [bus]);
  const W = 720, H = big ? 150 : small ? 70 : 90;
  const n = pts.length;
  const poly = pts.map((v, i) => `${((i / Math.max(1, n - 1)) * W).toFixed(1)},${(H / 2 - v * (H / 2 - 8)).toFixed(1)}`).join(' ');
  const last = n ? pts[n - 1] as number : 0;
  return (
    <svg className={`breathline${small ? ' small' : ''}${big ? ' big' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Your breathing, live">
      <line className="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
      {n > 1 && <polyline points={poly} />}
      {n > 1 && <circle className="head" cx={W - 4} cy={H / 2 - last * (H / 2 - 8)} r={big ? 6 : 8} />}
    </svg>
  );
}

/**
 * The catch replay: this look's own breath trace, drawn big, with what the Fence measured marked on it.
 * Scaled against the calm swing he learned, so a held breath looks as flat as it really was.
 */
export function ReplayTrace({ frames, baseline, marks, peekMs = PEEK_MS }: { frames: SignalFrame[]; baseline: Baseline; marks: ReplayMark[]; peekMs?: number }): JSX.Element {
  const W = 900, H = 200, PADY = 34;
  const t0 = frames.length ? (frames[0] as SignalFrame).t : 0;
  const good = frames.filter((f) => f.conf >= 0.5 && f.stable && typeof f.chest === 'number');
  const span = Math.max(peekMs, frames.length ? (frames[frames.length - 1] as SignalFrame).t - t0 : 0);
  const ts = good.map((f) => f.t - t0);
  const raw = good.map((f) => f.chest as number);
  // 300 ms centred average, the same smoothing the read uses
  const sm = raw.map((_, i) => {
    let sum = 0, k = 0;
    for (let j = i; j >= 0 && (ts[i] as number) - (ts[j] as number) <= 150; j--) { sum += raw[j] as number; k++; }
    for (let j = i + 1; j < raw.length && (ts[j] as number) - (ts[i] as number) <= 150; j++) { sum += raw[j] as number; k++; }
    return sum / Math.max(1, k);
  });
  const sorted = [...sm].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.03)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.97)] ?? 1;
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, baseline.windowAmp / 2, 1e-6) * 1.12;
  const x = (t: number): number => (t / span) * W;
  const y = (v: number): number => H / 2 - ((v - mid) / half) * (H / 2 - PADY);
  const poly = ts.map((t, i) => `${x(t).toFixed(1)},${y(sm[i] as number).toFixed(1)}`).join(' ');
  const hold = marks.find((m) => m.kind === 'catch' && m.start !== undefined && m.end !== undefined);
  const blinks = marks.find((m) => m.kind === 'blinks')?.ticks ?? [];
  return (
    <div className="replaytrace-wrap">
      <svg className="replaytrace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Your breathing during that look">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} className="grid" x1={W * f} y1={0} x2={W * f} y2={H} />)}
        <line className="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
        {hold && (
          <g className="hold">
            <rect x={x(hold.start!)} y={4} width={Math.max(2, x(hold.end!) - x(hold.start!))} height={H - 8} />
            <line x1={x(hold.start!)} y1={4} x2={x(hold.start!)} y2={H - 4} />
            <line x1={x(hold.end!)} y1={4} x2={x(hold.end!)} y2={H - 4} />
          </g>
        )}
        {blinks.map((b, i) => <line key={i} className="blink" x1={x(b)} y1={H - 18} x2={x(b)} y2={H - 4} />)}
        {ts.length > 1 && <polyline points={poly} />}
      </svg>
      {hold && (
        <div className="hold-tag" style={{ left: `${Math.min(80, Math.max(0, (x((hold.start! + hold.end!) / 2) / W) * 100 - 10))}%` }}>
          He caught you here
        </div>
      )}
      <div className="trace-axis"><span>You looked</span><span>{Math.round(span / 1000)} seconds later</span></div>
    </div>
  );
}

export function Ring({ progress, label }: { progress: number; label: string }): JSX.Element {
  const r = 44, c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 100 100">
      <circle className="track" cx="50" cy="50" r={r} />
      <circle className="prog" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      <text x="50" y="52">{label}</text>
    </svg>
  );
}

/** Words fade in one at a time, roughly with the voice. */
export function Subtitle({ text, who = 'The Fence' }: { text: string; who?: string }): JSX.Element {
  const words = text.split(' ');
  return (
    <div className="subtitle" key={text}>
      <span className="who">{who}</span>
      <span className="said">
        {words.map((w, i) => (
          <span key={i} className="w" style={{ animationDelay: `${i * 150}ms` }}>{w} </span>
        ))}
      </span>
    </div>
  );
}

export function Btn({ k, children, onClick, primary, big, ghost, disabled }: { k?: string; children: ReactNode; onClick: () => void; primary?: boolean; big?: boolean; ghost?: boolean; disabled?: boolean }): JSX.Element {
  return (
    <button className={`btn${primary ? ' primary' : ''}${big ? ' big' : ''}${ghost ? ' ghost' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="lbl">{children}</span>{k && <span className="key">{k}</span>}
    </button>
  );
}

export const money = (n: number): string => Math.round(n).toLocaleString('en-US');

/** A number that rolls up to its value. */
export function RollNum({ value, className }: { value: number; className?: string }): JSX.Element {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / 700);
      const e = 1 - (1 - p) ** 3;
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className={className}>{money(shown)}</span>;
}

/** Signals icons: which tells the Fence reads on a job. */
export function Reads({ list }: { list: string[] }): JSX.Element {
  return <div className="reads">{list.map((s) => <span key={s} className={`read ${s}`}>{s}</span>)}</div>;
}

export function caughtCount(game: GameState): number {
  // on the final bet he caught you if he called the dud a dud
  return game.log.filter((o) => o.kind === 'trap' && (o.final ? o.decision === 'walk' : o.result === 'burned' || o.decision === 'unread')).length;
}

/** Goal and progress: always on screen during a job. */
export function Hud({ game, job, daily }: { game: GameState; job: Job; daily: boolean }): JSX.Element {
  const r = game.rules;
  const caught = caughtCount(game);
  const played = game.log.length;
  const active = game.phase === 'peek' || game.phase === 'bankerRead' ? 1 : 0;
  const may = r.maxTrapsCaught === 0 ? 'He may catch no duds' : `He may catch ${r.maxTrapsCaught} dud${r.maxTrapsCaught === 1 ? '' : 's'}`;
  return (
    <div className="hud panel">
      <div className="hud-job">{daily ? 'Daily Heist' : job.name}</div>
      <div className="hud-goal">Take <b>{money(r.target)}</b> from {r.safes} safes. {may}.</div>
      <div className="pips" aria-label={`Safe ${Math.min(r.safes, played + active)} of ${r.safes}`}>
        {Array.from({ length: r.safes }, (_, i) => {
          const o = game.log[i];
          // the last safe, double or nothing: green if he called it wrong, red if he read you
          const cls = o ? (o.final ? ((o.decision === 'walk') === (o.kind === 'trap') ? 'caught' : 'kept')
            : o.kind === 'trap' ? (o.result === 'sold' ? 'dumped' : 'caught') : o.result === 'burned' ? 'lost' : 'kept') : i === played && active ? 'now' : '';
          return <span key={i} className={`pip ${cls}`} />;
        })}
        <span className={`caught${caught > r.maxTrapsCaught ? ' over' : ''}`}>Caught {caught} of {r.maxTrapsCaught}</span>
      </div>
    </div>
  );
}

/**
 * Take (this run), Stash (lifetime) and the two alarm lamps, bottom right where the coins land.
 * shownPile holds the take back while a result is still a secret (the last safe's call).
 */
export function Purse({ game, stash, shownPile, strikeAt }: {
  game: GameState; stash: number; shownPile?: number; strikeAt?: { n: number; at: number } | null;
}): JSX.Element {
  const pile = shownPile ?? game.pile;
  const fresh = strikeAt && performance.now() - strikeAt.at < 2600 ? strikeAt : null;
  return (
    <div className={`purse panel${fresh ? ' shake' : ''}`}>
      <div className="lab">Take</div>
      <RollNum value={pile} className={`take num${pile >= game.rules.target ? ' met' : ''}`} />
      <div className="stashline">Stash <b className="num">{money(stash)}</b></div>
      <div className="lamps-wrap" aria-label={`Strikes: ${game.strikes} of ${MAX_STRIKES}`}>
        <div className="lamps">
          <span className="lab">Alarm</span>
          {Array.from({ length: MAX_STRIKES }, (_, i) => (
            <span key={fresh && fresh.n === i + 1 ? `f${fresh.at}` : `l${i}`} className={`lamp${i < game.strikes ? ' on' : ''}${fresh && fresh.n === i + 1 ? ' flash' : ''}`} />
          ))}
        </div>
        <div className="lamps-rule">{MAX_STRIKES} strikes and the alarm goes off: you lose your take.</div>
      </div>
    </div>
  );
}

/** What is still in the vault: values you have seen are struck out. */
export function ValuesBoard({ game }: { game: GameState }): JSX.Element {
  const seen = game.boxes.filter((b) => b.state !== 'sealed');
  const count = (kind: string, value: number) => seen.filter((b) => b.kind === kind && b.value === value).length;
  const used = new Map<string, number>();
  const gone = (kind: string, value: number): boolean => {
    const k = `${kind}:${value}`;
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return n < count(kind, value);
  };
  return (
    <div className="values panel" aria-label="What is still in the vault">
      <div className="lab">Inside the 10 safes</div><div className="small" style={{ marginBottom: 4, color: "var(--velvet)" }}>7 hold loot, 3 are duds</div>
      {VALUE_TABLE.small.map((v) => <div key={`s${v}`} className={`v num${gone('small', v) ? ' gone' : ''}`}>{money(v)}</div>)}
      {VALUE_TABLE.big.map((v) => <div key={`b${v}`} className={`v big num${gone('big', v) ? ' gone' : ''}`}>{money(v)}</div>)}
      {VALUE_TABLE.trap.map((v, i) => <div key={`t${i}`} className={`v trap${gone('trap', v) ? ' gone' : ''}`}>Dud</div>)}
    </div>
  );
}

/** The first minute, always visible on the job screen. `on` lights the steps happening now. */
export function RuleStrip({ on = [] }: { on?: number[] }): JSX.Element {
  const steps = ['Crack a safe', 'Hide it', 'He reads you', 'Take his cash or keep it'];
  return (
    <div className="rulestrip">
      {steps.map((s, i) => <span key={s} className={`rs${on.includes(i) ? ' on' : ''}`}><i>{i + 1}</i>{s}</span>)}
    </div>
  );
}

/** A heart that beats with the pulse the bus hears. */
export function Heart({ bus, bpm, sim }: { bus: SignalBus | null; bpm: number | null; sim: boolean }): JSX.Element {
  const beat = usePoll(() => (bus ? bus.heartbeat() : 0), [bus]);
  return (
    <div className="heart">
      <svg viewBox="0 0 32 30" style={{ transform: `scale(${1 + 0.28 * beat})` }} aria-hidden="true">
        <path d="M16 28 C 6 20, 1 14, 1 8.5 C 1 4, 4.5 1, 8.5 1 C 12 1, 14.5 3, 16 6 C 17.5 3, 20 1, 23.5 1 C 27.5 1, 31 4, 31 8.5 C 31 14, 26 20, 16 28 Z" />
      </svg>
      <span className="num">{bpm === null ? '...' : bpm}</span><span className="unit">{sim ? 'bpm, simulated' : 'bpm'}</span>
    </div>
  );
}

/** What the Fence sees: your self view, your breath line and your pulse. */
export function BodyPanel({ bus, stream, sim, bpm }: { bus: SignalBus | null; stream: MediaStream | null; sim: boolean; bpm: number | null }): JSX.Element {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  return (
    <div className="body-panel panel">
      <div className="lab">What he sees</div>
      <div className="selfview">
        {stream ? <video ref={video} muted playsInline autoPlay aria-label="You, mirrored" />
          : (
            <div className="sample-face">
              <svg viewBox="0 0 80 60" aria-hidden="true"><ellipse cx="40" cy="24" rx="11" ry="14" /><path d="M 14 60 C 16 46, 28 40, 40 40 C 52 40, 64 46, 66 60" /></svg>
              <span>{sim ? 'Sample body, no camera' : 'Camera off'}</span>
            </div>
          )}
      </div>
      <div className="mini-breath"><span className="lab">Breath</span><BreathLine bus={bus} small /></div>
      <Heart bus={bus} bpm={bpm} sim={sim} />
    </div>
  );
}
