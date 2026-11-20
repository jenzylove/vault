// DEV ONLY: scene preview with mock props cycling through every state. Not the game.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VaultScene } from './VaultScene';
import type { BankerState, SceneBox, SceneBoxKind, ScenePracticeBox, VaultSceneProps } from './types';
import { sceneFx } from './fx';

const KINDS: SceneBoxKind[] = ['small', 'big', 'small', 'trap', 'small', 'big', 'trap', 'small', 'trap', 'small'];
const fresh = (): SceneBox[] => KINDS.map((k, i) => ({ id: i + 1, state: 'sealed', kind: k }));

type Step = { label: string; banker: BankerState; active: number | null; heat: number; boxes: (b: SceneBox[]) => SceneBox[]; practice?: ScenePracticeBox[] };
const PR = (a: ScenePracticeBox['state'], b: ScenePracticeBox['state']): ScenePracticeBox[] => [{ kind: 'trap', state: a }, { kind: 'small', state: b }];
const set = (b: SceneBox[], id: number, state: SceneBox['state']) => b.map((x) => (x.id === id ? { ...x, state } : x));

const SCRIPT: Step[] = [
  { label: 'practice tray, both sealed', banker: 'idle', active: null, heat: 0, boxes: () => fresh(), practice: PR('sealed', 'sealed') },
  { label: 'practice I peek (trap)', banker: 'reading', active: null, heat: 0, boxes: (b) => b, practice: PR('peeking', 'sealed') },
  { label: 'practice II peek (treasure)', banker: 'reading', active: null, heat: 0, boxes: (b) => b, practice: PR('sealed', 'peeking') },
  { label: 'idle, all sealed', banker: 'idle', active: null, heat: 0, boxes: (b) => b },
  { label: 'peek box 2 (big), banker reading', banker: 'reading', active: 2, heat: 0.05, boxes: (b) => set(b, 2, 'peeking') },
  { label: 'banker speaking', banker: 'speaking', active: 2, heat: 0.05, boxes: (b) => b },
  { label: 'banker offering a chit', banker: 'offering', active: 2, heat: 0.05, boxes: (b) => b },
  { label: 'box 2 opened: treasure', banker: 'idle', active: 2, heat: 0.1, boxes: (b) => set(b, 2, 'opened-treasure') },
  { label: 'peek box 4 (trap), reading', banker: 'reading', active: 4, heat: 0.2, boxes: (b) => set(b, 4, 'peeking') },
  { label: 'player sells box 4 (trap)', banker: 'speaking', active: 4, heat: 0.3, boxes: (b) => set(b, 4, 'sold') },
  { label: 'peek box 6 (big), reading', banker: 'reading', active: 6, heat: 0.4, boxes: (b) => set(b, 6, 'peeking') },
  { label: 'banker walks: box 6 burned', banker: 'walking', active: 6, heat: 0.5, boxes: (b) => set(b, 6, 'burned') },
  { label: 'peek box 7 (trap)', banker: 'reading', active: 7, heat: 0.6, boxes: (b) => set(b, 7, 'peeking') },
  { label: 'box 7 opened: trap snaps shut', banker: 'idle', active: 7, heat: 0.8, boxes: (b) => set(b, 7, 'opened-trap') },
  { label: 'box 1 opened: small treasure', banker: 'idle', active: 1, heat: 1, boxes: (b) => set(b, 1, 'opened-treasure') },
  { label: 'reveal: burned box 6 opened (big)', banker: 'idle', active: null, heat: 1, boxes: (b) => set(b, 6, 'burned-revealed') },
];

export default function ScenePreview() {
  const [stepIdx, setStepIdx] = useState(0);
  const [auto, setAuto] = useState(true);
  const [boxes, setBoxes] = useState<SceneBox[]>(fresh);
  const [banker, setBanker] = useState<BankerState>('idle');
  const [active, setActive] = useState<number | null>(null);
  const [heat, setHeat] = useState(0);
  const [practice, setPractice] = useState<ScenePracticeBox[] | undefined>(SCRIPT[0].practice);
  const [quality, setQuality] = useState<VaultSceneProps['quality']>('high');
  const [breath, setBreath] = useState<number[]>([]);
  const [beatEnv, setBeatEnv] = useState(0);
  const [fps, setFps] = useState(0);
  const [alert, setAlert] = useState(0);
  const [catchPulse, setCatchPulse] = useState<number | undefined>(undefined);
  const [lite, setLite] = useState(false);
  const [hud, setHud] = useState(true);
  const catchNow = useCallback(() => setCatchPulse(performance.now()), []);
  const sim = useRef({ t: 0, phase: 0, hold: 0, nextBeat: 0, beat: 0, buf: [] as number[] });
  const boxesRef = useRef(boxes); boxesRef.current = boxes;
  const stepRef = useRef(stepIdx); stepRef.current = stepIdx;

  const applyStep = useCallback((i: number) => {
    const s = SCRIPT[i % SCRIPT.length];
    setStepIdx(i % SCRIPT.length);
    setBoxes((b) => s.boxes(i % SCRIPT.length === 0 ? fresh() : b));
    setBanker(s.banker); setActive(s.active); setHeat(s.heat); setPractice(s.practice);
  }, []);

  // auto cycle
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => applyStep(stepRef.current + 1), 4200);
    return () => clearInterval(id);
  }, [auto, applyStep]);

  // simulated breath + heartbeat at 30 Hz (labelled mock)
  useEffect(() => {
    const id = setInterval(() => {
      const s = sim.current; const dt = 1 / 30; s.t += dt;
      const peekingTrap = boxesRef.current.some((b) => b.state === 'peeking' && b.kind === 'trap');
      if (peekingTrap && s.hold <= 0 && Math.random() < 0.01) { s.hold = 1.4; setCatchPulse(performance.now()); } // a breath catch
      if (s.hold > 0) s.hold -= dt; else s.phase += dt * Math.PI * 2 * 0.24;
      const v = Math.sin(s.phase) * 0.8 + Math.sin(s.phase * 2.3) * 0.08 + (Math.random() - 0.5) * 0.03;
      s.buf.push(v); if (s.buf.length > 300) s.buf.shift();
      if (s.t >= s.nextBeat) { s.beat = 1; s.nextBeat = s.t + 60 / (70 + heatRef.current * 30); }
      s.beat *= Math.exp(-dt * 9);
      setBreath(s.buf.slice()); setBeatEnv(s.beat);
    }, 1000 / 30);
    const f = setInterval(() => setFps(sceneFx.fps), 500);
    return () => { clearInterval(id); clearInterval(f); };
  }, []);
  const heatRef = useRef(heat); heatRef.current = heat;

  // keyboard
  useEffect(() => {
    const kindOf = (id: number | null) => (id == null ? null : boxesRef.current.find((b) => b.id === id)?.kind ?? null);
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (/^[0-9]$/.test(k)) { setAuto(false); setActive(k === '0' ? 10 : Number(k)); return; }
      const a = active;
      const act = (state: SceneBox['state']) => { if (a != null) { setAuto(false); setBoxes((b) => set(b, a, state)); } };
      switch (k) {
        case ' ': setAuto((x) => !x); break;
        case 'n': setAuto(false); applyStep(stepIdx + 1); break;
        case 'p': act('peeking'); setBanker('reading'); break;
        case 'o': act(kindOf(a) === 'trap' ? 'opened-trap' : 'opened-treasure'); break;
        case 's': act('sold'); break;
        case 'b': act('burned'); setBanker('walking'); break;
        case 'c': act('sealed'); break;
        case 'k': if (a != null) setBoxes((b) => b.map((x) => (x.id === a ? { ...x, kind: x.kind === 'small' ? 'big' : x.kind === 'big' ? 'trap' : 'small' } : x))); break;
        case 'r': setAuto(false); setBoxes(fresh()); setActive(null); setBanker('idle'); setHeat(0); break;
        case 'i': setBanker('idle'); break;
        case 'e': setBanker('reading'); break;
        case 't': setBanker('speaking'); break;
        case 'w': setBanker('walking'); break;
        case 'f': setBanker('offering'); break;
        case 'h': setHeat((h) => Math.min(1, h + 0.1)); break;
        case 'j': setHeat((h) => Math.max(0, h - 0.1)); break;
        case 'q': setQuality((q) => (q === 'high' ? 'medium' : 'high')); break;
        case 'a': setAlert((x) => Math.min(1, +(x + 0.25).toFixed(2))); break;
        case 'z': setAlert((x) => Math.max(0, +(x - 0.25).toFixed(2))); break;
        case 'x': catchNow(); break;
        case 'l': setLite((x) => !x); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stepIdx, applyStep, catchNow]);

  const onBoxClick = useCallback((id: number) => {
    setAuto(false); setActive(id);
    setBoxes((b) => set(b, id, 'peeking')); setBanker('reading');
  }, []);

  const peek = useMemo(() => (active == null ? null : boxes.find((b) => b.id === active && b.state === 'peeking')?.kind ?? null), [active, boxes]);

  // expose a hook for the screenshot script
  useEffect(() => {
    (window as unknown as { __vaultPreview: unknown }).__vaultPreview = { applyStep, steps: SCRIPT.length, labels: SCRIPT.map((x) => x.label), setAuto, setQuality, setAlert, catchNow, setLite, setHud, setBanker };
  }, [applyStep, catchNow]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050403' }}>
      <VaultScene boxes={boxes} activeBoxId={active} peekContents={peek} bankerState={banker} breath={breath} heartbeat={beatEnv} heat={heat} onBoxClick={onBoxClick} quality={quality} practice={practice} alert={alert} catchPulse={catchPulse} lite={lite} />
      {hud && (
      <div style={{ position: 'absolute', left: 12, top: 10, font: '12px/1.45 ui-monospace, Consolas, monospace', color: '#d8cdb4', background: 'rgba(0,0,0,0.55)', padding: '8px 10px', borderRadius: 4, pointerEvents: 'none', maxWidth: 360 }}>
        <div style={{ color: '#ffb36b', fontWeight: 700, letterSpacing: 1 }}>SCENE PREVIEW (mock props, dev only)</div>
        <div>{fps.toFixed(0)} fps · {quality}{lite ? ' lite' : ''} · heat {heat.toFixed(1)} · alert {alert.toFixed(2)} · banker {banker} · active {active ?? '-'}</div>
        <div>step {stepIdx + 1}/{SCRIPT.length}: {SCRIPT[stepIdx].label} {auto ? '(auto)' : '(paused)'}</div>
        <div style={{ opacity: 0.75, marginTop: 4 }}>space auto · n next · 1-0 select · click box peek · p peek · o open · s sell · b burn · c seal · k kind · i/e/t/w/f banker · h/j heat · a/z alert · x catch · l lite · q quality · r reset</div>
      </div>
      )}
    </div>
  );
}

/** Mount the preview into an element (dev screenshots load this module straight from the dev server). */
export function mountPreview(el: HTMLElement): () => void {
  const root = createRoot(el);
  root.render(<ScenePreview />);
  return () => root.unmount();
}
