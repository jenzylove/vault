import { useEffect, useState, type ReactNode } from 'react';
import { VaultScene, type VaultSceneProps } from '../scene/VaultScene';
import { PEEK_MS, RULES, VALUE_TABLE, levelConfig, type Baseline, type GameState, type LevelNo, type ReplayMark } from '../engine';
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
  const W = 720, H = big ? 150 : 90;
  const n = pts.length;
  const poly = pts.map((v, i) => `${((i / Math.max(1, n - 1)) * W).toFixed(1)},${(H / 2 - v * (H / 2 - 8)).toFixed(1)}`).join(' ');
  const last = n ? pts[n - 1] as number : 0;
  return (
    <svg className={`breathline${small ? ' small' : ''}${big ? ' big' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Your breathing, live">
      <line className="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
      {n > 1 && <polyline points={poly} />}
      {big && n > 1 && <circle className="head" cx={W} cy={H / 2 - last * (H / 2 - 8)} r="5" />}
    </svg>
  );
}

/**
 * The catch replay: this peek's own breath trace, drawn big, with what the banker measured marked on it.
 * Scaled against the calm swing he learned, so a held breath looks as flat as it really was.
 */
export function ReplayTrace({ frames, baseline, marks }: { frames: SignalFrame[]; baseline: Baseline; marks: ReplayMark[] }): JSX.Element {
  const W = 900, H = 210, PADY = 26;
  const t0 = frames.length ? (frames[0] as SignalFrame).t : 0;
  const good = frames.filter((f) => f.conf >= 0.5 && f.stable && typeof f.chest === 'number');
  const span = Math.max(PEEK_MS, frames.length ? (frames[frames.length - 1] as SignalFrame).t - t0 : 0);
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
    <svg className="replaytrace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Your breathing during that peek">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} className="grid" x1={W * f} y1={0} x2={W * f} y2={H} />)}
      <line className="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
      {hold && (
        <g className="hold">
          <rect x={x(hold.start!)} y={4} width={Math.max(2, x(hold.end!) - x(hold.start!))} height={H - 8} />
          <line x1={x(hold.start!)} y1={4} x2={x(hold.start!)} y2={H - 4} />
          <line x1={x(hold.end!)} y1={4} x2={x(hold.end!)} y2={H - 4} />
          <text x={(x(hold.start!) + x(hold.end!)) / 2} y={20}>{hold.label}</text>
        </g>
      )}
      {blinks.map((b, i) => <line key={i} className="blink" x1={x(b)} y1={H - 16} x2={x(b)} y2={H - 4} />)}
      {ts.length > 1 && <polyline points={poly} />}
      <text className="axis" x={4} y={H - 4}>0</text>
      <text className="axis" x={W - 4} y={H - 4} textAnchor="end">{Math.round(span / 1000)} seconds</text>
    </svg>
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
export function Subtitle({ text, who = 'The banker' }: { text: string; who?: string }): JSX.Element {
  const words = text.split(' ');
  return (
    <div className="subtitle shadowed" key={text}>
      <span className="eyebrow who">{who}</span>
      {words.map((w, i) => (
        <span key={i} className="w" style={{ animationDelay: `${i * 170}ms` }}>{w} </span>
      ))}
    </div>
  );
}

export function Btn({ k, children, onClick, primary, big, danger }: { k?: string; children: ReactNode; onClick: () => void; primary?: boolean; big?: boolean; danger?: boolean }): JSX.Element {
  return (
    <button className={`btn${primary ? ' primary' : ''}${big ? ' big' : ''}${danger ? ' danger' : ''}`} onClick={onClick}>
      {children}{k && <span className="key">{k}</span>}
    </button>
  );
}

export const money = (n: number): string => Math.round(n).toLocaleString('en-US');
export const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const;

export function readsLine(level: LevelNo): string {
  const s = levelConfig(level).signals;
  const parts = [s.breath && 'your breath', s.blinks && 'your blinks', s.face && 'your face', s.pulseHeat && 'your pulse'].filter(Boolean) as string[];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Reads ${list}.`;
}

/** Goal (one line), pile and heat: always on screen during play. */
export function Hud({ game, daily }: { game: GameState; daily: boolean }): JSX.Element {
  const cfg = levelConfig(game.level);
  const caught = game.log.filter((o) => o.kind === 'trap' && (o.result === 'burned' || o.decision === 'unread')).length;
  const burned = game.log.filter((o) => o.kind !== 'trap' && o.result === 'burned').length;
  const heatPct = Math.round(game.heat * 100);
  const played = game.log.length;
  const boxNo = Math.min(RULES.boxesPerRun, played + (game.phase === 'peek' || game.phase === 'bankerRead' ? 1 : 0));
  const traps = cfg.maxTrapsCaught === 0 ? 'he catches no trap' : `he catches at most ${cfg.maxTrapsCaught} trap${cfg.maxTrapsCaught === 1 ? '' : 's'}`;
  return (
    <div className="hud shadowed">
      <div className="goal">
        <div className="eyebrow">{daily ? 'Daily vault  ·  ' : ''}Bank {ROMAN[game.level - 1]}  ·  The {cfg.rank}</div>
        <div className="goalline">
          Goal: bank <b className="num">{money(cfg.target)}</b> in {RULES.boxesPerRun} boxes, {traps}.
          <span className={`count${caught > cfg.maxTrapsCaught || burned > cfg.maxBurned ? ' over' : ''}`}>
            Box {Math.max(1, boxNo)} of {RULES.boxesPerRun}  ·  caught {caught}  ·  burned {burned}
          </span>
        </div>
      </div>
      <div className="purse">
        <div className={`pile num${game.pile >= cfg.target ? ' met' : ''}`} aria-label="Your pile">{money(game.pile)}</div>
        <div className="heat">
          <div className="row"><span>Heat</span><span className="num">{heatPct}</span></div>
          <div className="bar"><div className="fill" style={{ width: `${heatPct}%` }} /></div>
          <div className="small" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>Sell him {Math.ceil(RULES.bustAt / RULES.heatPerTrapBought)} traps and he throws you out</div>
        </div>
      </div>
    </div>
  );
}

/** What's still on the board, Deal or No Deal style: values you have seen are struck out. */
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
    <div className="values shadowed" aria-label="Values on the board">
      <div className="eyebrow" style={{ marginBottom: 6 }}>On the board</div>
      {VALUE_TABLE.small.map((v) => <div key={`s${v}`} className={`v num${gone('small', v) ? ' gone' : ''}`}>{money(v)}</div>)}
      <div className="gap" />
      {VALUE_TABLE.big.map((v) => <div key={`b${v}`} className={`v big num${gone('big', v) ? ' gone' : ''}`}>{money(v)}</div>)}
      <div className="gap" />
      {VALUE_TABLE.trap.map((v, i) => <div key={`t${i}`} className={`v trap${gone('trap', v) ? ' gone' : ''}`}>Trap</div>)}
    </div>
  );
}

/**
 * Live check: one random cue per game ("blink twice"), so a recorded video cannot stand in for the player.
 * Pure display; the flow counts blinks from the signal bus and decides pass or fail.
 */
export interface BlinkCueProps {
  /** blinks counted since the cue appeared */
  blinks: number;
  /** blinks wanted, default 2 */
  needed?: number;
  status: 'waiting' | 'passed' | 'failed';
  /** whole seconds left while waiting; hidden when undefined */
  secondsLeft?: number;
  /** shown as a Try again button when the check failed */
  onRetry?: () => void;
}

function Eye({ shut, idx }: { shut: boolean; idx: number }): JSX.Element {
  return (
    <svg className={`eye${shut ? ' shut' : ''}`} viewBox="0 0 64 36" aria-hidden="true" style={{ animationDelay: `${idx * 90}ms` }}>
      <path className="lid" d="M4 18 C 18 2, 46 2, 60 18 C 46 34, 18 34, 4 18 Z" />
      <circle className="iris" cx="32" cy="18" r="8" />
      <path className="closed" d="M4 18 C 18 30, 46 30, 60 18" />
    </svg>
  );
}

export function BlinkCue({ blinks, needed = 2, status, secondsLeft, onRetry }: BlinkCueProps): JSX.Element {
  const got = Math.min(needed, Math.max(0, Math.floor(blinks)));
  const prompt = status === 'passed' ? 'Thank you.' : status === 'failed' ? 'He missed that.' : 'Blink twice.';
  const line = status === 'passed'
    ? 'That was you, live. On with the game.'
    : status === 'failed'
      ? 'Face the camera in good light and blink twice, slowly.'
      : 'One quick check that he is watching you live, not a recording.';
  return (
    <div className={`blinkcue ${status}`} role="status" aria-live="polite">
      <div className="eyebrow">Live check</div>
      <div className="prompt shadowed">{prompt}</div>
      <div className="eyes" aria-label={`${got} of ${needed} blinks seen`}>
        {Array.from({ length: needed }, (_, i) => <Eye key={i} idx={i} shut={i < got || status === 'passed'} />)}
      </div>
      <div className="rulebar shadowed">
        {line}
        {status === 'waiting' && secondsLeft !== undefined && <span className="left"> {Math.max(0, Math.ceil(secondsLeft))} seconds left.</span>}
      </div>
      {status === 'failed' && onRetry && <div className="actions"><Btn primary k="Enter" onClick={onRetry}>Try again</Btn></div>}
    </div>
  );
}
