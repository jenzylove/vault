/**
 * The Vault game flow: an overlay over <VaultScene>, driven by the engine reducer.
 * Signals come only through the SignalSource the App hands in; nothing here knows live from simulated
 * except the on screen badge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LEVELS, MIN_QUALITY, BASELINE_MS, PEEK_MS, RULES,
  dailySeed, extractFeatures, learnBaseline, levelConfig, newGame, sayTell, step, tellSheet, tellTrend, trendSentence, unlockedLevel, updateHistory,
  type Baseline, type BoxKind, type GameAction, type GameState, type LevelNo, type PeekFeatures, type TellHistory, type TellSheet,
} from '../engine';
import type { SignalSource, SourceStatus } from '../signals/types';
import { FaceWatch, STALE_MS, type FaceProblem } from '../signals/lineup';
import { V_MANY_FACES, V_NO_FACE, V_OK, validationWords } from '../signals/status';
import { Lineup } from './Lineup';
import type { BankerState, SceneBox, SceneBoxKind, ScenePracticeBox } from '../scene/types';
import { SignalBus } from './signalBus';
import { isPeekAware } from './simSource';
import { speak, stopSpeaking, setMuted, isMuted } from './speech';
import { loadHistory, saveHistory, wipeHistory, loadKey, saveKey, forgetKey, pace } from './storage';
import { renderShareCard } from './shareCard';
import { loadFonts } from './fonts';
import { BreathLine, Btn, Hud, LiveScene, ROMAN, Ring, Subtitle, ValuesBoard, money, readsLine, usePoll } from './parts';
import './styles.css';

export type SourceChoice = { mode: 'live'; key: string } | { mode: 'simulated' };
export interface GameProps {
  createSource: (c: SourceChoice) => Promise<SignalSource>;
  /** A Presage key is already set on this computer (.env), so the key screen need not ask for one. */
  keyOnFile?: boolean;
}

type Screen = 'title' | 'ladder' | 'consent' | 'key' | 'lineup' | 'play';
type ReadStage = 'none' | 'speak' | 'after';
interface PracticeState { idx: number; stage: 'intro' | 'peek' | 'noted'; peeks: { kind: BoxKind; features: PeekFeatures }[] }
interface EndInfo { sheet: TellSheet; prev: TellHistory; next: TellHistory; unlockedBefore: LevelNo; unlockedNow: LevelNo; }

const today = (): string => new Date().toLocaleDateString('en-CA');
const kindName = (k: BoxKind, v?: number): string => (k === 'trap' ? 'Trap' : k === 'big' ? `Big treasure${v ? `, ${money(v)}` : ''}` : `Treasure${v ? `, ${money(v)}` : ''}`);
const secs = (ms: number): string => (ms / 1000).toFixed(1);

/** Credits: with the camera on and no input for this long outside a read, the camera turns off. */
const IDLE_MS = 60_000;
/** Credits: a face pause that lasts this long turns the camera off. */
const FACE_PAUSE_CAP_MS = 45_000;

export function Game({ createSource, keyOnFile = false }: GameProps): JSX.Element {
  const P = useMemo(pace, []);
  const [screen, setScreen] = useState<Screen>('title');
  const [history, setHistory] = useState<TellHistory>(loadHistory);
  const unlocked = unlockedLevel(history);
  const [sel, setSel] = useState<number>(() => unlockedLevel(loadHistory()) - 1); // 0..4 banks, 5 = daily
  const [daily, setDaily] = useState(false);
  const [game, setGame] = useState<GameState>(() => newGame(1, 1));
  const [source, setSource] = useState<SignalSource | null>(null);
  const [bus, setBus] = useState<SignalBus | null>(null);
  const [consented, setConsented] = useState(false);
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<string>(loadKey);
  const [calmFailed, setCalmFailed] = useState(false);
  const [calmTry, setCalmTry] = useState(0);
  const [reusedCalm, setReusedCalm] = useState(false);
  const [practice, setPractice] = useState<PracticeState>({ idx: 0, stage: 'intro', peeks: [] });
  const [readStage, setReadStage] = useState<ReadStage>('none');
  const [revealN, setRevealN] = useState(0);
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [boardSeen, setBoardSeen] = useState(0);
  const [lineupOff, setLineupOff] = useState<string | null>(null);
  const [pauseWhy, setPauseWhy] = useState<string | null>(null);
  const [srcStatus, setSrcStatus] = useState<SourceStatus | null>(null);
  const [facePause, setFacePause] = useState<FaceProblem>(null);
  const lineupFor = useRef<'new' | 'resume'>('new');
  const faceWatch = useRef(new FaceWatch());
  const lastInput = useRef(performance.now());
  const lastBaseline = useRef<Baseline | null>(null);
  const recRef = useRef<{ progress: () => number } | null>(null);
  const speechRef = useRef<{ cancel: () => void } | null>(null);
  const gameNo = useRef(0);
  const endedFor = useRef(-1);

  useEffect(() => { void loadFonts(); }, []);

  const dispatch = useCallback((a: GameAction) => setGame((s) => step(s, a)), []);
  const cfg = levelConfig(game.level);

  // ---------- starting and stopping ----------
  const enterPlay = useCallback(() => {
    setPaused(false);
    setPauseWhy(null);
    setScreen('play');
    setGame((s) => {
      let g = step(s, { type: 'begin' });
      if (lastBaseline.current) g = step(g, { type: 'baselineDone', baseline: lastBaseline.current });
      return g;
    });
    setReusedCalm(!!lastBaseline.current);
  }, []);

  // The SDK session starts here, right before the lineup, and nowhere else.
  const beginPlay = useCallback(async (src: SignalSource, b: SignalBus) => {
    lastInput.current = performance.now();
    faceWatch.current.reset();
    setFacePause(null);
    if (src.kind === 'live') { lineupFor.current = 'new'; setLineupOff(null); setScreen('lineup'); }
    try {
      b.attach();
      await src.start();
    } catch (e) {
      void src.stop();
      const msg = (e as Error)?.message ?? 'unknown error';
      if (src.kind === 'live') { setLineupOff(msg); return; }
      setErr(`The camera did not start: ${msg}. Check the key, or play with a simulated body.`);
      setScreen('key');
      return;
    }
    if (src.kind !== 'live') enterPlay();
  }, [enterPlay]);

  const startGame = useCallback((level: LevelNo, isDaily: boolean) => {
    const seed = isDaily ? dailySeed(today()) : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    gameNo.current++;
    setGame(newGame(seed, level));
    setDaily(isDaily);
    setPractice({ idx: 0, stage: 'intro', peeks: [] });
    setReadStage('none');
    setRevealN(0);
    setEnd(null);
    setCardUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setCalmFailed(false);
    setBoardSeen(0);
    setErr(null);
    if (!consented) { setScreen('consent'); return; }
    if (!source || !bus) { setScreen('key'); return; }
    void beginPlay(source, bus);
  }, [consented, source, bus, beginPlay]);

  const choose = useCallback(async (c: SourceChoice) => {
    setErr(null);
    if (c.mode === 'live') {
      if (!c.key.trim() && !keyOnFile) { setErr('Paste your Presage key first.'); return; }
      if (c.key.trim()) saveKey(c.key);
    }
    let src: SignalSource;
    void source?.stop(); // never two sessions
    try { src = await createSource(c); } catch (e) {
      setErr(`That source is not available: ${(e as Error)?.message ?? 'unknown error'}.`);
      return;
    }
    const b = new SignalBus(src);
    setSource(src);
    setBus(b);
    lastBaseline.current = null; // a new body needs a new calm
    await beginPlay(src, b);
  }, [createSource, beginPlay, keyOnFile, source]);

  const stopCamera = useCallback(() => {
    stopSpeaking();
    void source?.stop();
  }, [source]);

  const toLadder = useCallback(() => {
    stopCamera();
    bus?.clear();
    setPaused(false);
    setScreen('ladder');
  }, [stopCamera, bus]);

  const pause = useCallback((why: string | null = null) => {
    if (screen !== 'play' || paused) return;
    stopCamera();
    setPauseWhy(why);
    setFacePause(null);
    setPaused(true);
  }, [screen, paused, stopCamera]);

  const resume = useCallback(async () => {
    if (!source || !bus) return;
    setErr(null);
    lastInput.current = performance.now();
    faceWatch.current.reset();
    setFacePause(null);
    if (source.kind === 'live') {
      // back through the lineup: the camera restarts and the read must be clear before play goes on
      lineupFor.current = 'resume';
      setLineupOff(null);
      setScreen('lineup');
      try { await source.start(); } catch (e) { void source.stop(); setLineupOff((e as Error)?.message ?? 'The camera did not start.'); }
      return;
    }
    try { await source.start(); setPaused(false); setPauseWhy(null); } catch (e) { setErr(`The camera did not start: ${(e as Error)?.message ?? ''}`); }
  }, [source, bus]);

  // ---------- lineup ----------
  const lineupReady = useCallback(() => {
    if (lineupFor.current === 'resume') { setPaused(false); setPauseWhy(null); setScreen('play'); return; }
    enterPlay();
  }, [enterPlay]);
  const lineupBack = useCallback(() => {
    stopCamera();
    bus?.clear();
    setPaused(false);
    setPauseWhy(null);
    setLineupOff(null);
    setScreen('ladder');
  }, [stopCamera, bus]);
  const lineupTimeout = useCallback(() => {
    stopCamera();
    setLineupOff('He turned the camera off to save time.');
  }, [stopCamera]);
  const lineupRetry = useCallback(() => {
    if (!source || !bus) return;
    if (lineupFor.current === 'resume') { void resume(); return; }
    void beginPlay(source, bus);
  }, [source, bus, resume, beginPlay]);
  const lineupSim = useCallback(() => {
    stopCamera();
    setLineupOff(null);
    void choose({ mode: 'simulated' });
  }, [stopCamera, choose]);

  // ---------- source status: errors, face pause, credits ----------
  useEffect(() => {
    if (!source) { setSrcStatus(null); return; }
    setSrcStatus(source.status());
    let lastV = source.status().validation;
    return source.onStatus((st) => {
      setSrcStatus(st);
      if (st.validation && st.validation !== lastV) { lastV = st.validation; faceWatch.current.validation(st.validation.code, st.validation.at); }
    });
  }, [source]);

  // an SDK error has already ended the session (the source stops itself); tell the player
  const errSeen = useRef<unknown>(null);
  useEffect(() => {
    const e = srcStatus?.error ?? null;
    if (!e || e === errSeen.current) return;
    errSeen.current = e;
    stopSpeaking();
    if (screen === 'lineup') setLineupOff(e.say);
    else if (screen === 'play' && game.phase !== 'over') { setErr(e.say); setPauseWhy(null); setFacePause(null); setPaused(true); }
  }, [srcStatus, screen, game.phase]);

  // stop the session the moment the read is over: results, leaving, closing the window
  useEffect(() => {
    if (screen === 'play' && (game.phase === 'reveal' || game.phase === 'over')) source?.stop().catch(() => {});
  }, [screen, game.phase, source]);
  const srcRef = useRef<SignalSource | null>(null);
  srcRef.current = source;
  useEffect(() => {
    const off = () => { void srcRef.current?.stop(); };
    window.addEventListener('pagehide', off);
    window.addEventListener('beforeunload', off);
    return () => { window.removeEventListener('pagehide', off); window.removeEventListener('beforeunload', off); off(); };
  }, []);

  // ---------- face pause and idle guard (live only) ----------
  const live = source?.kind === 'live';
  const reading = screen === 'play' && !paused && (
    (game.phase === 'baseline' && !calmFailed)
    || (game.phase === 'practice' && practice.stage === 'peek')
    || game.phase === 'peek');
  // A read pauses while the SDK reports no face (1) or more than one face (2), and goes on when it clears.
  useEffect(() => {
    if (!live || !reading) { setFacePause(null); return; }
    let since: number | null = null;
    const id = setInterval(() => {
      const now = performance.now();
      const p = faceWatch.current.check(now);
      setFacePause(p);
      if (p === null) { since = null; return; }
      since ??= now;
      if (now - since > FACE_PAUSE_CAP_MS) pause('Nobody was in view, so he turned the camera off.');
    }, 200);
    return () => clearInterval(id);
  }, [live, reading, pause]);
  const halted = paused || facePause !== null;

  // Credits: the camera turns off when nobody touches anything for a minute outside a read.
  useEffect(() => {
    const touch = () => { lastInput.current = performance.now(); };
    window.addEventListener('keydown', touch);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('pointermove', touch);
    return () => { window.removeEventListener('keydown', touch); window.removeEventListener('pointerdown', touch); window.removeEventListener('pointermove', touch); };
  }, []);
  useEffect(() => {
    if (!live || screen !== 'play' || paused || game.phase === 'reveal' || game.phase === 'over') return;
    const id = setInterval(() => {
      if (reading || readStage === 'speak') { lastInput.current = performance.now(); return; }
      if (performance.now() - lastInput.current > IDLE_MS) pause('You were away, so he turned the camera off.');
    }, 2000);
    const hide = () => { if (document.hidden) pause('The window was hidden, so he turned the camera off.'); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', hide); };
  }, [live, screen, paused, game.phase, reading, readStage, pause]);

  // ---------- timed windows (signal time) ----------
  // learn your calm
  useEffect(() => {
    if (screen !== 'play' || halted || !bus || game.phase !== 'baseline' || calmFailed) return;
    const rec = bus.record(BASELINE_MS);
    recRef.current = rec;
    let live = true;
    void rec.promise.then((frames) => {
      if (!live || !frames.length) return;
      const b = learnBaseline(frames);
      if (b.quality < 0.6) { setCalmFailed(true); return; }
      lastBaseline.current = b;
      dispatch({ type: 'baselineDone', baseline: b });
    });
    return () => { live = false; rec.cancel(); recRef.current = null; };
  }, [screen, halted, bus, game.phase, calmFailed, calmTry, dispatch]);

  // practice peeks
  const practiceKind: BoxKind | null = game.practice[practice.idx]?.kind ?? null;
  useEffect(() => {
    if (screen !== 'play' || halted || !bus || !source || game.phase !== 'practice' || practice.stage !== 'peek' || !practiceKind || !game.baseline) return;
    if (isPeekAware(source)) source.onPeek(practiceKind);
    const rec = bus.record(PEEK_MS);
    recRef.current = rec;
    let live = true;
    const baseline = game.baseline;
    void rec.promise.then((frames) => {
      if (!live || !frames.length) return;
      const features = extractFeatures(frames, baseline);
      setPractice((p) => ({ ...p, stage: 'noted', peeks: [...p.peeks, { kind: practiceKind, features }] }));
    });
    return () => { live = false; rec.cancel(); recRef.current = null; };
  }, [screen, halted, bus, source, game.phase, game.baseline, practice.stage, practice.idx, practiceKind]);

  // board peeks
  const activeBox = game.activeBoxId === null ? null : game.boxes.find((b) => b.id === game.activeBoxId) ?? null;
  useEffect(() => {
    if (screen !== 'play' || halted || !bus || !source || game.phase !== 'peek' || !activeBox || !game.baseline) return;
    if (isPeekAware(source)) source.onPeek(activeBox.kind);
    const rec = bus.record(PEEK_MS);
    recRef.current = rec;
    let live = true;
    const baseline = game.baseline;
    void rec.promise.then((frames) => {
      if (!live || !frames.length) return;
      dispatch({ type: 'peekDone', features: extractFeatures(frames, baseline) });
      setReadStage('speak');
    });
    return () => { live = false; rec.cancel(); recRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, halted, bus, source, game.phase, activeBox?.id, game.baseline, dispatch]);

  // the banker speaks his read
  useEffect(() => {
    if (readStage !== 'speak' || !game.read || paused) return;
    const s = speak(game.read.reason, P > 1 ? 2 : 1);
    speechRef.current = s;
    let live = true;
    void s.done.then(() => { if (live) setReadStage('after'); });
    return () => { live = false; s.cancel(); speechRef.current = null; };
  }, [readStage, game.read, paused, P]);

  // reveal every box still hidden, one at a time
  const hidden = useMemo(() => game.boxes.filter((b) => b.state === 'burned' || b.state === 'sealed').map((b) => b.id), [game.boxes]);
  useEffect(() => {
    if (screen !== 'play' || game.phase !== 'reveal' || readStage === 'speak') return;
    if (revealN >= hidden.length) return;
    const id = setTimeout(() => setRevealN((n) => n + 1), (revealN === 0 ? 900 : 650) / P);
    return () => clearTimeout(id);
  }, [screen, game.phase, readStage, revealN, hidden.length, P]);

  // game over: tell sheet, history, unlocks, share card (once per game)
  useEffect(() => {
    if (game.phase !== 'over' || endedFor.current === gameNo.current) return;
    endedFor.current = gameNo.current;
    const sheet = tellSheet(game);
    const prev = history;
    const next = updateHistory(prev, sheet, new Date().toISOString());
    saveHistory(next);
    setHistory(next);
    setEnd({ sheet, prev, next, unlockedBefore: unlockedLevel(prev), unlockedNow: unlockedLevel(next) });
    bus?.clear(); // the session's signal numbers are not kept past the game
    const sc = game.score;
    if (sc) {
      void renderShareCard({ pile: sc.pile, bankNo: game.level, rank: sc.rank, bankerCorrect: sc.bankerCorrect, bankerCalls: sc.bankerCalls, daily: daily ? today() : null, won: sc.won })
        .then((blob) => setCardUrl(URL.createObjectURL(blob))).catch(() => setCardUrl(null));
    }
  }, [game, history, daily, bus]);

  // ---------- actions ----------
  const pick = useCallback((id: number) => {
    if (screen !== 'play' || paused || game.phase !== 'board') return;
    setBoardSeen((n) => n + 1);
    dispatch({ type: 'choose', boxId: id });
  }, [screen, paused, game.phase, dispatch]);

  const sellOrOpen = useCallback((t: 'sell' | 'open') => {
    if (game.phase !== 'bankerRead' || readStage !== 'after') return;
    dispatch({ type: t });
    setReadStage('none');
  }, [game.phase, readStage, dispatch]);

  const next = useCallback(() => {
    if (game.phase === 'audit' && readStage !== 'speak') { setReadStage('none'); dispatch({ type: 'next' }); }
  }, [game.phase, readStage, dispatch]);

  const leave = useCallback(() => {
    if ((game.phase === 'audit' && readStage !== 'speak') || game.phase === 'board') { setReadStage('none'); dispatch({ type: 'leave' }); }
  }, [game.phase, readStage, dispatch]);

  const finishReveal = useCallback(() => {
    if (game.phase === 'reveal' && revealN >= hidden.length) { stopCamera(); dispatch({ type: 'reveal' }); }
  }, [game.phase, revealN, hidden.length, dispatch, stopCamera]);

  const practiceNext = useCallback(() => {
    if (game.phase !== 'practice') return;
    if (practice.stage === 'intro') { setPractice((p) => ({ ...p, stage: 'peek' })); return; }
    if (practice.stage !== 'noted') return;
    if (practice.idx + 1 < game.practice.length) setPractice((p) => ({ ...p, idx: p.idx + 1, stage: 'intro' }));
    else dispatch({ type: 'practiceDone', peeks: practice.peeks });
  }, [game.phase, game.practice.length, practice, dispatch]);

  const saveCard = useCallback(() => {
    if (!cardUrl) return;
    const a = document.createElement('a');
    a.href = cardUrl;
    a.download = `the-vault-${today()}.png`;
    a.click();
  }, [cardUrl]);

  const toggleMute = useCallback(() => { const m = !isMuted(); setMuted(m); setMutedState(m); }, []);

  // ---------- keyboard ----------
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'm') { toggleMute(); return; }
    if (screen === 'lineup') return; // the lineup screen owns its keys
    if (screen === 'play' && paused) {
      if (k === 'enter' || k === ' ') void resume();
      if (k === 'q') toLadder();
      return;
    }
    switch (screen) {
      case 'title':
        if (k === 'enter' || k === ' ') setScreen('ladder');
        return;
      case 'ladder': {
        if (k === 'arrowdown') setSel((s) => Math.min(5, s + 1));
        else if (k === 'arrowup') setSel((s) => Math.max(0, s - 1));
        else if (k === 'd') startGame(unlocked, true);
        else if (k === 'enter' || k === ' ') { if (sel === 5) startGame(unlocked, true); else if (sel + 1 <= unlocked) startGame((sel + 1) as LevelNo, false); }
        else if (k === 'escape' || k === 'backspace') setScreen('title');
        else if (/^[1-5]$/.test(k) && Number(k) <= unlocked) startGame(Number(k) as LevelNo, false);
        return;
      }
      case 'consent':
        if (k === 'enter') { setConsented(true); setScreen(source ? 'play' : 'key'); if (source && bus) void beginPlay(source, bus); }
        else if (k === 'escape' || k === 'backspace') setScreen('ladder');
        return;
      case 'key':
        if (k === 's') void choose({ mode: 'simulated' });
        else if (k === 'enter' && (keyDraft.trim() || keyOnFile)) void choose({ mode: 'live', key: keyDraft });
        else if (k === 'escape') setScreen('ladder');
        return;
      case 'play':
        break;
    }
    if (k === 'escape') { e.preventDefault(); if (game.phase !== 'over') pause(); return; }
    if (facePause) return;
    if (calmFailed && game.phase === 'baseline' && k === 'enter') { setCalmFailed(false); setCalmTry((n) => n + 1); return; }
    if (game.phase === 'practice' && (k === 'enter' || k === ' ')) { e.preventDefault(); practiceNext(); return; }
    if (readStage === 'speak' && (k === ' ' || k === 'enter')) { e.preventDefault(); speechRef.current?.cancel(); return; }
    if (game.phase === 'board') {
      if (/^[0-9]$/.test(k)) { const idx = k === '0' ? 9 : Number(k) - 1; const b = game.boxes[idx]; if (b && b.state === 'sealed') pick(b.id); return; }
      if (k === 'l') leave();
      return;
    }
    if (game.phase === 'bankerRead') { if (k === 's') sellOrOpen('sell'); if (k === 'o') sellOrOpen('open'); return; }
    if (game.phase === 'audit') { if (k === 'enter' || k === ' ') { e.preventDefault(); next(); } if (k === 'l') leave(); return; }
    if (game.phase === 'reveal' && (k === 'enter' || k === ' ')) { finishReveal(); return; }
    if (game.phase === 'over') {
      if (k === 'enter') startGame(game.level, false);
      else if (k === 'n' && end && game.level < end.unlockedNow) startGame((game.level + 1) as LevelNo, false);
      else if (k === 'b') toLadder();
      else if (k === 'c') saveCard();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---------- scene props ----------
  const inPractice = screen === 'play' && (game.phase === 'baseline' || game.phase === 'practice');
  const holdId = readStage === 'speak' && game.lastOutcome?.decision === 'walk' ? game.lastOutcome.boxId : null;
  const revealed = new Set(game.phase === 'over' ? hidden : hidden.slice(0, game.phase === 'reveal' ? revealN : 0));
  const sceneBoxes: SceneBox[] = inPractice
    ? game.boxes.map((b): SceneBox => ({ id: b.id, state: 'sealed' }))
    : game.boxes.map((b): SceneBox => {
      const open = (k: BoxKind): SceneBox => ({ id: b.id, kind: k, state: k === 'trap' ? 'opened-trap' : 'opened-treasure' });
      if (b.id === holdId) return { id: b.id, state: 'sealed' };
      if (revealed.has(b.id)) return b.state === 'burned' ? { id: b.id, kind: b.kind, state: 'burned-revealed' } : open(b.kind);
      switch (b.state) {
        case 'sealed': return { id: b.id, state: 'sealed' };
        case 'peeked': return game.phase === 'peek' && b.id === game.activeBoxId ? { id: b.id, state: 'peeking' } : { id: b.id, state: 'sealed' };
        case 'sold': return { id: b.id, state: 'sold' };
        case 'opened': return open(b.kind);
        case 'burned': return { id: b.id, state: 'burned' };
      }
    });
  const scenePractice: ScenePracticeBox[] = game.practice.map((p, i) => ({
    kind: p.kind,
    state: game.phase === 'practice' && i === practice.idx && practice.stage === 'peek' ? 'peeking' : 'sealed',
  }));
  const peekContents: SceneBoxKind | null = inPractice
    ? null
    : game.phase === 'peek' && activeBox ? activeBox.kind : null;
  const sceneActive: number | null = inPractice
    ? null
    : game.phase === 'peek' || game.phase === 'bankerRead' ? game.activeBoxId
      : readStage !== 'none' && game.lastOutcome ? game.lastOutcome.boxId : null;
  const bankerState: BankerState = screen !== 'play' ? 'idle'
    : readStage === 'speak' ? 'speaking'
      : game.phase === 'peek' || game.phase === 'baseline' || (game.phase === 'practice' && practice.stage === 'peek') ? 'reading'
        : game.phase === 'bankerRead' ? 'offering'
          : game.phase === 'audit' && game.lastOutcome?.decision === 'walk' && readStage === 'after' ? 'walking'
            : 'idle';
  const onBoxClick = useCallback((id: number) => pick(id), [pick]);

  const menu = screen !== 'play' || game.phase === 'over';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050403' }}>
      <LiveScene
        bus={screen === 'play' && !paused ? bus : null}
        boxes={sceneBoxes}
        activeBoxId={sceneActive}
        peekContents={peekContents}
        practice={inPractice ? scenePractice : undefined}
        bankerState={bankerState}
        heat={screen === 'play' ? game.heat : 0}
        onBoxClick={screen === 'play' && game.phase === 'board' && !paused ? onBoxClick : undefined}
        quality="high"
        lite={live}
      />
      <div className="vui" data-screen={screen} data-phase={game.phase} data-stage={readStage} data-practice={`${practice.idx}:${practice.stage}`} data-paused={paused ? '1' : '0'}>
        {menu ? <div className="scrim-full" style={game.phase === 'over' && screen === 'play' ? { background: 'radial-gradient(ellipse at 30% 40%, rgba(12,9,6,0.78), rgba(5,4,3,0.95) 70%)' } : undefined} /> : <><div className="scrim-top" /><div className="scrim-bottom" /></>}

        {screen === 'title' && <TitleScreen onGo={() => setScreen('ladder')} />}
        {screen === 'ladder' && (
          <LadderScreen sel={sel} setSel={setSel} unlocked={unlocked} history={history}
            onPlay={(lv) => startGame(lv, false)} onDaily={() => startGame(unlocked, true)}
            onWipe={() => { wipeHistory(); setHistory(loadHistory()); setSel(0); }} />
        )}
        {screen === 'consent' && (
          <ConsentScreen onAgree={() => { setConsented(true); if (source && bus) void beginPlay(source, bus); else setScreen('key'); }} onBack={() => setScreen('ladder')} />
        )}
        {screen === 'key' && (
          <KeyScreen draft={keyDraft} setDraft={setKeyDraft} err={err} keyOnFile={keyOnFile}
            onLive={() => void choose({ mode: 'live', key: keyDraft })} onSim={() => void choose({ mode: 'simulated' })}
            onForget={() => { forgetKey(); setKeyDraft(''); }} />
        )}

        {screen === 'lineup' && source && (
          <Lineup source={source} off={lineupOff} onReady={lineupReady} onBack={lineupBack}
            onTimeout={lineupTimeout} onRetry={lineupRetry} onSim={lineupSim} />
        )}

        {screen === 'play' && game.phase !== 'over' && (
          <>
            {game.phase !== 'baseline' && game.phase !== 'practice' && <Hud game={game} daily={daily} />}
            {(game.phase === 'board' || game.phase === 'peek' || game.phase === 'bankerRead' || game.phase === 'audit') && <ValuesBoard game={game} />}
            <div className="stage">
              {game.phase === 'baseline' && (
                calmFailed ? (
                  <>
                    <div className="eyebrow enter">Learn your calm</div>
                    <div className="prompt shadowed">He could not see you clearly.</div>
                    <div className="rulebar shadowed">Sit back in good light and face the camera. Then try again.</div>
                    <div className="actions"><Btn primary k="Enter" onClick={() => { setCalmFailed(false); setCalmTry((n) => n + 1); }}>Try again</Btn></div>
                  </>
                ) : (
                  <CalmStage bus={bus} recRef={recRef} />
                )
              )}
              {game.phase === 'practice' && practiceKind && (
                <PracticeStage idx={practice.idx} total={game.practice.length} kind={practiceKind} stage={practice.stage}
                  last={practice.peeks[practice.peeks.length - 1]?.features ?? null} recRef={recRef} bus={bus} reusedCalm={reusedCalm} onNext={practiceNext} />
              )}
              {game.phase === 'board' && (
                <>
                  <div className="prompt shadowed">Pick a box.</div>
                  <div className="rulebar shadowed">
                    {boardSeen === 0
                      ? 'Only you see inside. Then he reads you: he makes an offer, or he walks and the box burns.'
                      : 'Look safe at traps so he buys them. Stay quiet at treasure so he does not burn it.'}
                  </div>
                  <div className="actions">
                    <span className="small">Click a box, or press 1 to 0 from left to right</span>
                    {game.log.length > 0 && <Btn k="L" onClick={leave}>Leave the vault with {money(game.pile)}</Btn>}
                  </div>
                </>
              )}
              {game.phase === 'peek' && activeBox && <PeekStage kind={activeBox.kind} value={activeBox.value} recRef={recRef} />}
              {readStage === 'speak' && game.read && <Subtitle text={game.read.reason} />}
              {game.phase === 'bankerRead' && readStage === 'after' && game.read && activeBox && (
                <OfferStage offer={game.read.offer ?? 0} blind={game.read.decision === 'unread'} reason={game.read.reason}
                  saw={kindName(activeBox.kind, activeBox.value)} onSell={() => sellOrOpen('sell')} onOpen={() => sellOrOpen('open')} />
              )}
              {game.phase === 'audit' && readStage !== 'speak' && game.lastOutcome && (
                <AuditStage game={game} onNext={next} onLeave={leave} />
              )}
              {game.phase === 'reveal' && readStage !== 'speak' && (
                <RevealStage game={game} hidden={hidden} revealN={revealN} onDone={finishReveal} />
              )}
            </div>
            <Badge bus={paused ? null : bus} kind={source?.kind ?? null} muted={muted} />
            {!halted && (game.phase === 'baseline' || game.phase === 'practice' || game.phase === 'peek') && <SignalWarn bus={bus} live={source?.kind === 'live'} status={srcStatus} />}
          </>
        )}

        {screen === 'play' && game.phase === 'over' && game.score && end && (
          <EndScreen game={game} end={end} cardUrl={cardUrl} daily={daily}
            onAgain={() => startGame(game.level, false)}
            onNextBank={game.level < end.unlockedNow ? () => startGame((game.level + 1) as LevelNo, false) : null}
            onLadder={toLadder} onSave={saveCard} />
        )}

        {screen === 'play' && paused && (
          <div className="pause">
            <div className="eyebrow">Camera off</div>
            <div className="display" style={{ fontSize: 'var(--fs-xl)', marginTop: 14 }}>{pauseWhy ?? 'Nothing is being read.'}</div>
            <div className="body measure" style={{ marginTop: 14 }}>The camera is off and the game is paused. Any peek in progress starts over when you come back.</div>
            {err && <div className="err">{err}</div>}
            <div className="actions">
              <Btn primary k="Enter" onClick={() => void resume()}>Turn the camera back on</Btn>
              <Btn k="Q" onClick={toLadder}>Back to the banks</Btn>
            </div>
          </div>
        )}

        {screen === 'play' && !paused && facePause && (
          <div className="pause" role="alertdialog" aria-live="assertive" style={{ background: 'rgba(4,3,2,0.72)' }}>
            <div className="eyebrow">Paused</div>
            <div className="display" style={{ fontSize: 'var(--fs-xl)', marginTop: 14 }}>
              {facePause === 'many' ? 'More than one face in view.' : 'He cannot see your face.'}
            </div>
            <div className="body measure" style={{ marginTop: 14 }}>
              {facePause === 'many'
                ? 'He reads one player at a time. When only you are in view, the round goes on by itself.'
                : 'Come back in front of the camera. The round goes on by itself when he sees you.'}
            </div>
            <div className="small" style={{ marginTop: 14 }}>This read starts over when it resumes. Esc turns the camera off.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ======================= screens =======================

function TitleScreen({ onGo }: { onGo: () => void }): JSX.Element {
  return (
    <div className="center">
      <div className="eyebrow enter" style={{ ['--d' as string]: 0 }}>A game read by your breath</div>
      <div className="title-word" style={{ marginTop: 18 }}>The Vault</div>
      <div className="rule enter" style={{ ['--d' as string]: 4 }} />
      <div className="tagline measure">
        <span style={{ animationDelay: '0.7s' }}>You&rsquo;ve seen what&rsquo;s in the box. The banker hasn&rsquo;t.</span>
        <span style={{ animationDelay: '1.3s' }}>Your face can lie. <em className="brass">Your breath can&rsquo;t.</em></span>
      </div>
      <div className="actions enter" style={{ ['--d' as string]: 16 }}>
        <Btn primary big k="Enter" onClick={onGo}>Enter the vault</Btn>
      </div>
    </div>
  );
}

function LadderScreen({ sel, setSel, unlocked, history, onPlay, onDaily, onWipe }: {
  sel: number; setSel: (n: number) => void; unlocked: LevelNo; history: TellHistory;
  onPlay: (l: LevelNo) => void; onDaily: () => void; onWipe: () => void;
}): JSX.Element {
  const best = (lv: number) => history.games.filter((g) => g.level === lv).reduce((m, g) => Math.max(m, g.pile), -1);
  const beaten = (lv: number) => history.games.some((g) => g.level === lv && g.won);
  const d = new Date();
  return (
    <div className="center">
      <div className="ladder">
        <div>
          <div className="eyebrow enter">The banks</div>
          <div className="display enter" style={{ fontSize: 'var(--fs-xl)', margin: '10px 0 22px', ['--d' as string]: 1 }}>Five bankers. Each reads more of you.</div>
          {LEVELS.map((L, i) => {
            const locked = L.level > unlocked;
            const b = best(L.level);
            return (
              <div key={L.level} className={`bank enter${sel === i ? ' sel' : ''}${locked ? ' locked' : ''}`} style={{ ['--d' as string]: 2 + i }}
                onMouseEnter={() => setSel(i)} onClick={() => !locked && onPlay(L.level)}>
                <div className="roman">{ROMAN[i]}</div>
                <div>
                  <div className="name">The {L.rank}{beaten(L.level) ? <span className="brass" style={{ fontSize: 'var(--fs-s)', marginLeft: 12 }}>beaten</span> : null}</div>
                  <div className="reads">{locked ? `Beat bank ${ROMAN[i - 1]} to open this vault.` : readsLine(L.level)}</div>
                </div>
                <div className="terms">
                  Bank {money(L.target)}<br />
                  He catches {L.maxTrapsCaught === 0 ? 'no' : `at most ${L.maxTrapsCaught}`} trap{L.maxTrapsCaught === 1 ? '' : 's'}
                  {b >= 0 && <><br /><span className="brass">Best {money(b)}</span></>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="daily enter" style={{ ['--d' as string]: 7 }}>
          <div className="eyebrow">Today&rsquo;s vault</div>
          <div className="display" style={{ fontSize: 'var(--fs-l)', margin: '10px 0' }}>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</div>
          <div className="body">The same ten boxes for everyone today, against the highest banker you have opened. Share how often he read you.</div>
          <div className={`actions${sel === 5 ? ' sel' : ''}`} style={{ justifyContent: 'flex-start' }} onMouseEnter={() => setSel(5)}>
            <Btn primary={sel === 5} k="D" onClick={onDaily}>Play today&rsquo;s vault</Btn>
          </div>
          <div className="rule" style={{ margin: '28px 0' }} />
          <div className="small">Arrows to choose, Enter to play.</div>
          <div className="small" style={{ marginTop: 10 }}>
            Your results stay on this computer. {history.games.length > 0 && <button className="btn" style={{ padding: '4px 0', fontSize: 'var(--fs-xs)' }} onClick={onWipe}>Wipe my history</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsentScreen({ onAgree, onBack }: { onAgree: () => void; onBack: () => void }): JSX.Element {
  const items: [string, JSX.Element][] = [
    ['i', <><b>Your camera reads your breath, blinks, face and pulse</b> while you play. It turns on only after you agree.</>],
    ['ii', <><b>Nothing is stored.</b> Frames are processed on this computer and never saved. Only your results and tell summaries stay here, and you can wipe them.</>],
    ['iii', <><b>These are tells, not lies.</b> A tell is how your body reacts to what you see. This is a game, not a health or stress reading.</>],
    ['iv', <><b>Esc turns the camera off</b> at any moment and pauses the game.</>],
  ];
  return (
    <div className="center">
      <div className="measure" style={{ textAlign: 'left' }}>
        <div className="eyebrow enter">Before the camera turns on</div>
        <div className="display enter" style={{ fontSize: 'var(--fs-xl)', marginTop: 12, ['--d' as string]: 1 }}>The banker watches you, not your screen.</div>
        <ul className="consent-list">
          {items.map(([n, t], i) => <li key={n} className="enter" style={{ ['--d' as string]: 2 + i }}><span className="n">{n}</span><span>{t}</span></li>)}
        </ul>
        <div className="actions enter" style={{ justifyContent: 'flex-start', ['--d' as string]: 7 }}>
          <Btn primary k="Enter" onClick={onAgree}>I agree, turn it on</Btn>
          <Btn k="Esc" onClick={onBack}>Not now</Btn>
        </div>
      </div>
    </div>
  );
}

function KeyScreen({ draft, setDraft, err, keyOnFile, onLive, onSim, onForget }: {
  draft: string; setDraft: (s: string) => void; err: string | null; keyOnFile: boolean; onLive: () => void; onSim: () => void; onForget: () => void;
}): JSX.Element {
  return (
    <div className="center">
      <div className="eyebrow enter">Presage key</div>
      <div className="display enter" style={{ fontSize: 'var(--fs-xl)', margin: '12px 0 8px', ['--d' as string]: 1 }}>{keyOnFile ? 'Your Presage key is ready.' : 'Paste your Presage key.'}</div>
      <div className="body measure enter" style={{ ['--d' as string]: 2 }}>{keyOnFile
        ? 'A key is set up on this computer. Press Enter to use your camera, or paste a different key.'
        : 'It lets SmartSpectra read your breathing from the webcam. It stays on this computer.'}</div>
      <form className="enter" style={{ marginTop: 30, ['--d' as string]: 3 }} onSubmit={(e) => { e.preventDefault(); onLive(); }}>
        <input className="field" type="password" spellCheck={false} autoComplete="off" placeholder={keyOnFile ? 'key on this computer' : 'your key'}
          value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Presage API key" />
      </form>
      {err && <div className="err">{err}</div>}
      <div className="actions enter" style={{ ['--d' as string]: 4 }}>
        <Btn primary k="Enter" onClick={onLive}>Use my camera</Btn>
        <Btn k="S" onClick={onSim}>Play with a simulated body</Btn>
      </div>
      <div className="small enter" style={{ marginTop: 18, ['--d' as string]: 5 }}>
        No key? The simulated body plays the whole game with made up signals, clearly marked on screen.
        {draft && <> <button className="btn" style={{ padding: '2px 0', fontSize: 'var(--fs-xs)' }} onClick={onForget}>Forget my key</button></>}
      </div>
    </div>
  );
}

function CalmStage({ bus, recRef }: { bus: SignalBus | null; recRef: React.MutableRefObject<{ progress: () => number } | null> }): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  const left = Math.max(0, Math.ceil((BASELINE_MS / 1000) * (1 - p)));
  return (
    <>
      <div className="eyebrow enter">Step one  ·  Learn your calm</div>
      <div className="prompt shadowed" style={{ marginTop: 10 }}>Sit still. Breathe as you normally do.</div>
      <div style={{ margin: '22px 0 6px', width: '100%' }}><BreathLine bus={bus} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Ring progress={p} label={String(left)} />
        <div className="rulebar shadowed" style={{ marginTop: 0, textAlign: 'left', maxWidth: 440 }}>That line is your breathing. He spends 30 seconds learning what calm looks like on you.</div>
      </div>
    </>
  );
}

function PracticeStage({ idx, total, kind, stage, last, recRef, bus, reusedCalm, onNext }: {
  idx: number; total: number; kind: BoxKind; stage: PracticeState['stage']; last: PeekFeatures | null;
  recRef: React.MutableRefObject<{ progress: () => number } | null>; bus: SignalBus | null; reusedCalm: boolean; onNext: () => void;
}): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  const what = kind === 'trap' ? 'a trap' : kind === 'big' ? 'a big treasure' : 'a small treasure';
  if (stage === 'intro') {
    return (
      <>
        <div className="eyebrow enter">Practice {idx + 1} of {total}  ·  Labelled</div>
        <div className="prompt shadowed" style={{ marginTop: 10 }}>He knows this one holds {what}.</div>
        <div className="rulebar shadowed">
          {idx === 0 && reusedCalm ? 'He remembers your calm from last game. ' : ''}
          He watches how your body reacts to a box he already knows. That is how he learns your tells.
        </div>
        <div className="actions"><Btn primary k="Space" onClick={onNext}>Look inside</Btn></div>
      </>
    );
  }
  if (stage === 'peek') {
    return (
      <>
        <div className="peekrow">
          <Ring progress={p} label={String(Math.max(0, Math.ceil((PEEK_MS / 1000) * (1 - p))))} />
          <div style={{ textAlign: 'left' }}>
            <div className={`contents ${kind} shadowed`}>{kindName(kind)}</div>
            <div className="rulebar shadowed" style={{ marginTop: 4 }}>Only you can see inside. Keep breathing. He is watching.</div>
          </div>
        </div>
        <div style={{ marginTop: 6, width: '100%', opacity: 0.8 }}><BreathLine bus={bus} small /></div>
      </>
    );
  }
  let note = 'Your breath stayed even.';
  if (last) {
    if (last.quality < MIN_QUALITY) note = 'He lost you on that one. Sit back in the light.';
    else if (last.breathCatchMs > 0) note = `Your breath stopped for ${secs(last.breathCatchMs)} seconds.`;
    else if (last.shallowing > 0.2) note = `Your breathing went ${sayTell('shallow', last.shallowing * 100)}.`;
    else if (Math.abs(last.rateChange) > 0.2) note = `Your breathing ${last.rateChange > 0 ? 'sped up' : 'slowed'}.`;
  }
  return (
    <>
      <div className="eyebrow enter">Practice {idx + 1} of {total}  ·  Noted</div>
      <div className="prompt shadowed" style={{ marginTop: 10 }}>{note}</div>
      <div className="rulebar shadowed">{idx + 1 < total ? 'He wrote that down. One more.' : 'He has seen you at a trap and at treasure. Now the real boxes.'}</div>
      <div className="actions"><Btn primary k="Space" onClick={onNext}>{idx + 1 < total ? 'Next practice box' : 'To the board'}</Btn></div>
    </>
  );
}

function PeekStage({ kind, value, recRef }: { kind: BoxKind; value: number; recRef: React.MutableRefObject<{ progress: () => number } | null> }): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  return (
    <div className="peekrow">
      <Ring progress={p} label={String(Math.max(0, Math.ceil((PEEK_MS / 1000) * (1 - p))))} />
      <div style={{ textAlign: 'left' }}>
        <div className="eyebrow">Only you can see this</div>
        <div className={`contents ${kind} shadowed`} style={{ marginTop: 6 }}>{kindName(kind, value)}</div>
        <div className="rulebar shadowed" style={{ marginTop: 4 }}>Keep breathing. He is reading you.</div>
      </div>
    </div>
  );
}

function OfferStage({ offer, blind, reason, saw, onSell, onOpen }: { offer: number; blind: boolean; reason: string; saw: string; onSell: () => void; onOpen: () => void }): JSX.Element {
  return (
    <>
      <div className="small shadowed" style={{ marginBottom: 10 }}>&ldquo;{reason}&rdquo;</div>
      <div className="offer">
        <div className="side">
          <Btn primary big k="S" onClick={onSell}>Sell</Btn>
          <div className="choice-note shadowed">Take his price. The box is his.</div>
        </div>
        <div className="side">
          <div className="eyebrow">{blind ? 'Blind offer' : 'His offer'}</div>
          <div className="price num">{money(offer)}</div>
          <div className="small shadowed">You saw: {saw}</div>
        </div>
        <div className="side">
          <Btn primary big k="O" onClick={onOpen}>Open</Btn>
          <div className="choice-note shadowed">Keep the box. You get what is inside.</div>
        </div>
      </div>
    </>
  );
}

function AuditStage({ game, onNext, onLeave }: { game: GameState; onNext: () => void; onLeave: () => void }): JSX.Element {
  const o = game.lastOutcome!;
  const trap = o.kind === 'trap';
  let stamp: JSX.Element;
  let line: string;
  let rule: string;
  if (o.result === 'burned') {
    stamp = <span className="stamp">He walked</span>;
    line = trap ? 'The box burned. It held a trap, so you lost nothing.' : `The box burned. It held ${money(o.value)}, and now it is gone.`;
    rule = 'He walks when he reads a trap on you. Burned boxes are opened at the end.';
  } else if (o.result === 'sold' && trap) {
    stamp = <span className="stamp good">Heist</span>;
    line = `You sold him a trap for ${money(o.offer ?? 0)}. His audit found it, and it paid you ${money(Math.round((o.offer ?? 0) * RULES.heistBonus))} more.`;
    rule = `Every trap he finds makes him warier: heat rose ${Math.round(o.heatAdded * 100)} points. He walks sooner and pays less.`;
  } else if (o.result === 'sold') {
    stamp = <span className="stamp brassy">Sold</span>;
    line = (o.offer ?? 0) >= o.value ? `Sold for ${money(o.offer ?? 0)}. It held ${money(o.value)}. Good trade.` : `Sold for ${money(o.offer ?? 0)}. It held ${money(o.value)}.`;
    rule = 'He audits every box he buys and learns from what he finds.';
  } else if (trap) {
    stamp = <span className="stamp">Trap</span>;
    line = 'You opened a trap. Nothing added.';
    rule = 'A trap is worth nothing to you. Sell it to him if he will buy.';
  } else {
    stamp = <span className="stamp good">Opened</span>;
    line = `${money(o.value)} added to your pile.`;
    rule = 'He saw what was inside, and he learns from it.';
  }
  const anyLeft = game.boxes.some((b) => b.state === 'sealed');
  return (
    <>
      {stamp}
      <div className="prompt shadowed" style={{ fontSize: 'var(--fs-l)', marginTop: 16 }}>{line}</div>
      <div className="rulebar shadowed">{rule}</div>
      <div className="actions">
        <Btn primary k="Enter" onClick={onNext}>{anyLeft ? 'Next box' : 'Open the rest'}</Btn>
        {anyLeft && <Btn k="L" onClick={onLeave}>Leave the vault with {money(game.pile)}</Btn>}
      </div>
    </>
  );
}

function RevealStage({ game, hidden, revealN, onDone }: { game: GameState; hidden: number[]; revealN: number; onDone: () => void }): JSX.Element {
  const shown = hidden.slice(0, revealN);
  const done = revealN >= hidden.length;
  const head = game.busted ? 'Full heat. He threw you out with nothing.' : game.left ? `You left the vault with ${money(game.pile)}.` : 'Every box has been played.';
  return (
    <>
      {game.busted ? <span className="stamp">Thrown out</span> : <span className="stamp brassy">{game.left ? 'You left' : 'Audit'}</span>}
      <div className="prompt shadowed" style={{ fontSize: 'var(--fs-l)', marginTop: 16 }}>{head}</div>
      <div className="rulebar shadowed" style={{ minHeight: '3em' }}>
        {shown.length === 0 ? 'Now he opens every box he never saw.' : shown.map((id) => {
          const b = game.boxes.find((x) => x.id === id)!;
          const verdict = b.state === 'burned' ? (b.kind === 'trap' ? 'He walked from it. Right call.' : 'He walked from it. Wrong call.') : 'Unplayed.';
          return <div key={id}>Box {id + 1}: {kindName(b.kind, b.value).toLowerCase()}. {verdict}</div>;
        })}
      </div>
      {done && <div className="actions"><Btn primary k="Enter" onClick={onDone}>See your tells</Btn></div>}
    </>
  );
}

function EndScreen({ game, end, cardUrl, daily, onAgain, onNextBank, onLadder, onSave }: {
  game: GameState; end: EndInfo; cardUrl: string | null; daily: boolean;
  onAgain: () => void; onNextBank: (() => void) | null; onLadder: () => void; onSave: () => void;
}): JSX.Element {
  const sc = game.score!;
  const { sheet } = end;
  const key = sheet.biggest?.key ?? sheet.tells[0]?.key ?? 'breath';
  const trend = tellTrend(end.next, key).slice(-6);
  const tvals = trend.map((t) => t.trap);
  const maxV = Math.max(1e-6, ...tvals.map((v) => Math.abs(v)));
  const pts = tvals.map((v, i) => `${(tvals.length === 1 ? 65 : 6 + (i / (tvals.length - 1)) * 118).toFixed(1)},${(30 - (Math.abs(v) / maxV) * 24).toFixed(1)}`);
  const newlyUnlocked = end.unlockedNow > end.unlockedBefore ? levelConfig(end.unlockedNow) : null;
  const result = sc.busted ? 'Thrown out at full heat.' : sc.won ? `You beat the ${sc.rank}.` : `The ${sc.rank} kept the upper hand.`;
  return (
    <div className="end">
      <div className="left">
        <div className="eyebrow enter">{daily ? 'Daily vault  ·  ' : ''}Bank {ROMAN[game.level - 1]}  ·  {result}</div>
        <div className="pile-big num enter" style={{ ['--d' as string]: 1 }}>{money(sc.pile)}</div>
        <div className="body enter" style={{ ['--d' as string]: 2 }}>
          {sheet.readLine} Chance alone would get about {Math.round(sc.chanceAccuracy * sc.bankerCalls)}. {sc.trapsSold > 0 && `You sold him ${sc.trapsSold} trap${sc.trapsSold > 1 ? 's' : ''}.`} {sc.treasuresBurned > 0 && `He burned ${sc.treasuresBurned} of your treasures.`}
          {!sc.won && !sc.busted && ` To beat him: bank ${money(sc.target)}, let him catch at most ${sc.maxTrapsCaught} trap${sc.maxTrapsCaught === 1 ? '' : 's'}.`}
        </div>
        <div className="rule enter" style={{ margin: '8px 0', ['--d' as string]: 3 }} />
        <div className="eyebrow enter" style={{ ['--d' as string]: 3 }}>Your tell sheet</div>
        <div className="headline enter" style={{ ['--d' as string]: 4 }}>{sheet.biggest ? `${sheet.biggest.label} gave you away.` : 'Nothing gave you away this time.'}</div>
        <div className="enter" style={{ ['--d' as string]: 5 }}>
          {sheet.tells.slice(0, 4).map((t, i) => (
            <div key={t.key} className={`tell${i === 0 && sheet.biggest ? ' top' : ''}`}>
              <div>
                <div className="lab">{t.label}</div>
                <div className="meter"><i style={{ width: `${Math.min(100, (t.strength / 2.5) * 100)}%`, opacity: t.strength >= 0.8 ? 1 : 0.4 }} /></div>
              </div>
              <div className="sen">{t.nTrap && t.nTreasure ? t.sentence : 'Not enough boxes of both kinds to compare.'}</div>
            </div>
          ))}
        </div>
        <div className="trend enter" style={{ ['--d' as string]: 6 }}>
          <svg viewBox="0 0 130 36">{pts.length > 1 && <polyline points={pts.join(' ')} />}{pts.map((p, i) => { const [x, y] = p.split(','); return <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 3 : 2} />; })}</svg>
          <span>
            {tvals.length > 1
              ? trendSentence(key, tvals)
              : 'Play again to watch this tell shrink.'}
          </span>
        </div>
        {newlyUnlocked && <div className="unlock enter" style={{ ['--d' as string]: 7 }}>Bank {ROMAN[newlyUnlocked.level - 1]} is open: the {newlyUnlocked.rank} reads more.</div>}
        <div className="actions enter" style={{ justifyContent: 'flex-start', marginTop: 8, ['--d' as string]: 8 }}>
          {onNextBank ? <Btn primary k="N" onClick={onNextBank}>Next bank</Btn> : null}
          <Btn primary={!onNextBank} k="Enter" onClick={onAgain}>Play again</Btn>
          <Btn k="B" onClick={onLadder}>The banks</Btn>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 18, justifyItems: 'center' }}>
        {cardUrl ? <img className="card-preview" src={cardUrl} alt="Your share card" /> : <div className="small">Drawing your card</div>}
        {cardUrl && <Btn k="C" onClick={onSave}>Save the card</Btn>}
      </div>
    </div>
  );
}

function Badge({ bus, kind, muted }: { bus: SignalBus | null; kind: SignalSource['kind'] | null; muted: boolean }): JSX.Element {
  const q = usePoll(() => bus?.quality() ?? null, [bus], 250);
  const sim = kind === 'simulated';
  return (
    <>
      <div className={`badge shadowed${sim ? ' sim' : ''}`}>
        {bus && <span className="dot" />}
        {sim ? <span>Simulated body</span> : kind === 'replay' ? <span>Replay</span> : <span>{bus ? 'Camera on' : 'Camera off'}</span>}
        <span className="sep">·</span>
        <span>{sim ? 'no camera, made up signals' : 'Esc turns it off'}</span>
        {q !== null && !sim && <><span className="sep">·</span><span className={`q${q < 0.5 ? ' low' : ''}`}>{q < 0.5 ? 'weak read' : 'clear read'}</span></>}
      </div>
      <div className="corner shadowed"><span>M {muted ? 'voice off' : 'voice on'}</span>{sim && <span>Esc pause</span>}</div>
    </>
  );
}

function SignalWarn({ bus, live, status }: { bus: SignalBus | null; live: boolean; status: SourceStatus | null }): JSX.Element | null {
  const s = usePoll(() => {
    if (!bus) return null;
    const v = live ? status?.validation : null;
    // face codes have their own pause overlay; any other SDK hint shows while the SDK keeps repeating it
    if (v && v.code !== V_OK && v.code !== V_NO_FACE && v.code !== V_MANY_FACES && performance.now() - v.at < STALE_MS) return validationWords(v.code, v.hint).big;
    const stale = performance.now() - bus.lastFrameAt > 3000;
    if (stale) return live ? 'Waiting for the camera.' : null;
    const q = bus.quality();
    if (q !== null && q < 0.5) return 'I lost you. Sit back in the light and face me.';
    if (bus.talking()) return 'Quiet while you peek. Talking hides your breath.';
    return null;
  }, [bus, live, status], 300);
  return s ? <div className="warn shadowed">{s}</div> : null;
}
