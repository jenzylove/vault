import { useEffect, useState, type ReactNode } from 'react';
import { VaultScene, type VaultSceneProps } from '../scene/VaultScene';
import { RULES, VALUE_TABLE, levelConfig, type GameState, type LevelNo } from '../engine';
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

export function BreathLine({ bus, small }: { bus: SignalBus | null; small?: boolean }): JSX.Element {
  const pts = usePoll(() => (bus ? bus.breath() : []), [bus]);
  const W = 720, H = 90;
  const n = pts.length;
  const poly = pts.map((v, i) => `${((i / Math.max(1, n - 1)) * W).toFixed(1)},${(H / 2 - v * (H / 2 - 6)).toFixed(1)}`).join(' ');
  return (
    <svg className={`breathline${small ? ' small' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Your breathing, live">
      <line className="mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
      {n > 1 && <polyline points={poly} />}
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

/** Goal, pile and heat: always on screen during play. */
export function Hud({ game, daily }: { game: GameState; daily: boolean }): JSX.Element {
  const cfg = levelConfig(game.level);
  const caught = game.log.filter((o) => o.kind === 'trap' && (o.result === 'burned' || o.decision === 'unread')).length;
  const burned = game.log.filter((o) => o.kind !== 'trap' && o.result === 'burned').length;
  const heatPct = Math.round(game.heat * 100);
  return (
    <div className="hud shadowed">
      <div className="goal">
        <div className="eyebrow">{daily ? 'Daily vault  ·  ' : ''}Bank {ROMAN[game.level - 1]}  ·  The {cfg.rank}</div>
        <div className="bankline">Bank <span className="num">{money(cfg.target)}</span> and keep your tells quiet</div>
        <div className="terms">
          <span className={game.pile >= cfg.target ? 'met' : ''}>Pile <b className="num">{money(game.pile)}</b> of {money(cfg.target)}</span>
          <span className={caught > cfg.maxTrapsCaught ? 'over' : ''}>Traps he caught <b>{caught}</b> of {cfg.maxTrapsCaught} allowed</span>
          <span className={burned > cfg.maxBurned ? 'over' : ''}>Treasure he burned <b>{burned}</b> of {cfg.maxBurned} allowed</span>
        </div>
      </div>
      <div className="purse">
        <div className="pile num" aria-label="Your pile">{money(game.pile)}</div>
        <div className="heat">
          <div className="row"><span>Heat</span><span className="num">{heatPct}</span></div>
          <div className="bar"><div className="fill" style={{ width: `${heatPct}%` }} /></div>
          <div className="small" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>At {Math.round(RULES.bustAt * 100)} he throws you out</div>
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
