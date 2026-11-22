/**
 * Lineup: before he learns your calm, the player lines up in a mirrored camera preview with a gold face
 * oval and shoulder curve. The SDK's own validation hint is shown big, in plain words. Continue opens
 * only when the SDK reports no problem for about 2 s and chest samples are arriving steadily.
 * The session is already running here (Presage bills by the second), so the screen gives up after
 * LINEUP_CAP_MS and asks the Game to turn the camera off.
 */
import { useEffect, useRef, useState } from 'react';
import type { SignalSource, SourceStatus } from '../signals/types';
import { LineupGate, STALE_MS, wireGate, type GateRead } from '../signals/lineup';
import { V_OK, validationWords } from '../signals/status';
import { Btn } from './parts';

export const LINEUP_CAP_MS = 45_000;

export interface LineupProps {
  source: SignalSource;
  /** Set when the camera is off (timed out or the SDK failed): what to tell the player. */
  off: string | null;
  onReady: () => void;
  onBack: () => void;
  onTimeout: () => void;
  onRetry: () => void;
  onSim: () => void;
  /** back to the key screen (shown when Presage refused the key or it ran out of credits) */
  onKey?: () => void;
}

const TIP = 'Raise the laptop to eye level, sit back about an arm’s length, and keep the light in front of you.';

/** Wire a LineupGate to a source: chest arrivals and validation packets, timed on the wall clock. */
export function useLineupGate(source: SignalSource | null, now: () => number = () => performance.now()): { read: GateRead; status: SourceStatus | null } {
  const gate = useRef(new LineupGate());
  const [read, setRead] = useState<GateRead>({ ready: false, progress: 0, code: null, waiting: 'validation' });
  const [status, setStatus] = useState<SourceStatus | null>(source?.status() ?? null);
  useEffect(() => {
    if (!source) return;
    const g = gate.current;
    const unwire = wireGate(source, g, now);
    setStatus(source.status());
    const offS = source.onStatus(setStatus);
    const id = setInterval(() => setRead(g.check(now())), 100);
    return () => { unwire(); offS(); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  return { read, status };
}

export function Lineup({ source, off, onReady, onBack, onTimeout, onRetry, onSim, onKey }: LineupProps): JSX.Element {
  const { read, status } = useLineupGate(off ? null : source);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = off ? null : status?.stream ?? null;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => { /* autoplay of a muted preview never needs a gesture in Electron */ });
  }, [stream]);

  // credits: never sit in the lineup with the camera running for long
  useEffect(() => {
    if (off) return;
    const id = setTimeout(onTimeout, LINEUP_CAP_MS);
    return () => clearTimeout(id);
  }, [off, onTimeout]);

  // keys belong to this screen while it is up
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); onBack(); return; }
    if (off) {
      const keyTrouble = !!onKey && /key|credits/i.test(off);
      if (k === 'enter' && !keyTrouble) onRetry();
      else if (k === 'c' && keyTrouble) onKey!();
      else if (k === 's') onSim();
      return;
    }
    if ((k === 'enter' || k === ' ') && read.ready) { e.preventDefault(); onReady(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (off) {
    return (
      <div className="center" style={{ pointerEvents: 'auto' }}>
        <div className="eyebrow enter">Camera off</div>
        <div className="display enter" style={{ fontSize: 'var(--fs-xl)', margin: '12px 0 10px', ['--d' as string]: 1 }}>{off}</div>
        <div className="body measure enter" style={{ ['--d' as string]: 2 }}>{TIP}</div>
        <div className="actions enter" style={{ ['--d' as string]: 3 }}>
          {onKey && /key|credits/i.test(off)
            ? <Btn primary k="C" onClick={onKey}>Change your Presage key</Btn>
            : <Btn primary k="Enter" onClick={onRetry}>Try again</Btn>}
          <Btn k="S" onClick={onSim}>Try a sample run (no camera)</Btn>
          <Btn k="Esc" onClick={onBack}>Back to the jobs</Btn>
        </div>
      </div>
    );
  }

  const processing = status?.processing ?? 'starting';
  const v = status?.validation ?? null;
  let big: string;
  let small: string | undefined;
  if (processing === 'starting') { big = 'Turning the camera on.'; small = 'This takes a few seconds.'; }
  else if (read.ready) { big = 'You are lined up.'; small = 'The Fence can see your breathing. Stay like this.'; }
  else if (v && v.code !== V_OK && performance.now() - v.at < STALE_MS) { ({ big, small } = validationWords(v.code, v.hint)); }
  else if (read.waiting === 'validation') { big = 'Hold still.'; small = 'Checking the picture.'; }
  else { big = 'Hold still. Finding your breathing.'; small = 'Breathe as you normally do.'; }

  const gold = 'var(--cream, #f4e8d3)';
  const ok = read.ready;
  return (
    <div className="center" style={{ pointerEvents: 'auto', background: 'rgba(58,7,16,0.9)', justifyContent: 'center', gap: 0 }}>
      <style>{`
        @keyframes lineup-pulse { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
        .lineup-guide { animation: lineup-pulse 2.4s ease-in-out infinite; }
        .lineup-guide.ok { animation: none; opacity: 1; }
      `}</style>
      <div className="eyebrow enter">Line up</div>
      <div style={{
        position: 'relative', width: 'min(62vw, 96vh, 900px)', aspectRatio: '16 / 9', marginTop: 14,
        borderRadius: 4, overflow: 'hidden', background: '#2a050c',
        boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px ${ok ? gold : 'rgba(244,232,211,0.35)'}`,
        transition: 'box-shadow 0.4s',
      }}>
        <video ref={video} muted playsInline autoPlay aria-label="Your camera, mirrored"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', opacity: stream ? 1 : 0, transition: 'opacity 0.5s' }} />
        <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
          <defs>
            <mask id="lineup-hole">
              <rect width="160" height="90" fill="white" />
              <ellipse cx="80" cy="35" rx="13.5" ry="18" fill="black" />
            </mask>
          </defs>
          <rect width="160" height="90" fill="rgba(58,7,16,0.38)" mask="url(#lineup-hole)" />
          <g className={`lineup-guide${ok ? ' ok' : ''}`} fill="none" stroke={gold} strokeLinecap="round"
            strokeWidth={ok ? 0.9 : 0.6} strokeDasharray={ok ? undefined : '2.2 1.6'}
            style={{ filter: ok ? 'drop-shadow(0 0 1.6px rgba(244,232,211,0.9))' : undefined }}>
            <ellipse cx="80" cy="35" rx="13.5" ry="18" />
            <path d="M 34 90 C 38 74, 54 64.5, 80 63.5 C 106 64.5, 122 74, 126 90" />
          </g>
        </svg>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ height: '100%', width: `${Math.round(read.progress * 100)}%`, background: gold, transition: 'width 0.15s linear' }} />
        </div>
      </div>
      <div className="display shadowed" role="status" aria-live="polite" style={{ fontSize: 'var(--fs-xl)', marginTop: 22, lineHeight: 1.05 }}>{big}</div>
      <div className="body shadowed" style={{ marginTop: 8, minHeight: '1.6em' }}>{small ?? ''}</div>
      <div className="small measure" style={{ marginTop: 10 }}>{TIP}</div>
      <div className="actions" style={{ marginTop: 18 }}>
        <span style={{ opacity: ok ? 1 : 0.35, transition: 'opacity 0.3s' }} aria-disabled={!ok}>
          <Btn primary k="Enter" onClick={() => { if (read.ready) onReady(); }}>{ok ? 'Continue' : 'Waiting for a clear read'}</Btn>
        </span>
        <Btn k="Esc" onClick={onBack}>Back</Btn>
      </div>
    </div>
  );
}
