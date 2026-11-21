/**
 * The Vault game flow: an overlay over <VaultScene>, driven by the engine reducer.
 * Signals come only through the SignalSource the App hands in; nothing here knows live from simulated
 * except the on screen badge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LEVELS, MIN_QUALITY, BASELINE_MS, PEEK_MS, RULES,
  bankerView, dailySeed, extractFeatures, hideTrend, learnBaseline, levelConfig, liveRead, memoryLine, newGame, replayVerdict, restingAlert, runLeft,
  sayTell, shareTellLine, step, tellLine, tellSheet, unlockedLevel, updateHistory,
  type Baseline, type BoxKind, type GameAction, type GameState, type HideTrend, type LevelNo, type PeekFeatures, type ReplayVerdict, type TellHistory, type TellSheet,
} from '../engine';
import type { SignalFrame, SignalSource, SourceStatus } from '../signals/types';
import { useHeartbeat } from './heartbeat';
import { FaceWatch, STALE_MS, type FaceProblem } from '../signals/lineup';
import { V_MANY_FACES, V_NO_FACE, V_OK, validationWords } from '../signals/status';
import { Lineup } from './Lineup';
import type { BankerState, SceneBox, SceneBoxKind, ScenePracticeBox } from '../scene/types';
import { SignalBus } from './signalBus';
import { isPeekAware } from './simSource';
import { speak, stopSpeaking, setMuted, isMuted } from './speech';
import { loadHistory, saveHistory, wipeHistory, loadKey, saveKey, forgetKey, pace, loadHowSeen, saveHowSeen } from './storage';
import { renderShareCard } from './shareCard';
import { loadFonts } from './fonts';
import { BreathLine, Btn, Hud, LiveScene, ReplayTrace, ROMAN, Ring, Subtitle, ValuesBoard, money, readsLine, usePoll } from './parts';
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
interface EndInfo { sheet: TellSheet; prev: TellHistory; next: TellHistory; unlockedBefore: LevelNo; unlockedNow: LevelNo; trend: HideTrend; tell: string; }
/** The last peek's own frames, kept in memory only until its replay is shown. */
interface PeekTape { frames: SignalFrame[]; baseline: Baseline; logIndex: number }

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
  const [wantPractice, setWantPractice] = useState<boolean>(() => !loadHowSeen());
  const [liveAlert, setLiveAlert] = useState(0);
  const [catchPulse, setCatchPulse] = useState<number | undefined>(undefined);
  const [liveCaught, setLiveCaught] = useState(false);
  const [replayedN, setReplayedN] = useState(0);
  const [memLine, setMemLine] = useState<string | null>(null);
  const [openSaid, setOpenSaid] = useState(false);
  const tape = useRef<PeekTape | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
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
    setReplayedN(0);
    setLiveAlert(0);
    setLiveCaught(false);
    setOpenSaid(false);
    tape.current = null;
    setWantPractice(!loadHowSeen());
    setMemLine(memoryLine(loadHistory()));
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

  // First minute: consent goes straight to the camera when a key is already on this computer.
  const afterConsent = useCallback(() => {
    setConsented(true);
    if (source && bus) { void beginPlay(source, bus); return; }
    if (keyOnFile) { void choose({ mode: 'live', key: '' }); return; }
    setScreen('key');
  }, [source, bus, beginPlay, keyOnFile, choose]);

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
  // a replay is owed for every settled box until it has been shown
  const replayOwed = screen === 'play' && game.log.length > replayedN && (game.phase === 'audit' || game.phase === 'reveal') && readStage !== 'speak';
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
      if (reading || readStage === 'speak' || replayOwed) { lastInput.current = performance.now(); return; }
      if (performance.now() - lastInput.current > IDLE_MS) pause('You were away, so he turned the camera off.');
    }, 2000);
    const hide = () => { if (document.hidden) pause('The window was hidden, so he turned the camera off.'); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', hide); };
  }, [live, screen, paused, game.phase, reading, readStage, replayOwed, pause]);

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

  // practice is optional: skipped straight to the board unless the player asked for it
  useEffect(() => {
    if (screen === 'play' && game.phase === 'practice' && !wantPractice) dispatch({ type: 'practiceDone', peeks: practice.peeks });
  }, [screen, game.phase, wantPractice, practice.peeks, dispatch]);

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
    // the live read: he watches the breath as it happens, and a hold he would count is a catch now
    const buf: SignalFrame[] = [];
    const unsub = source.subscribe((f) => { buf.push(f); });
    let caught = false;
    setLiveCaught(false);
    setLiveAlert(restingAlert(gameRef.current.model, bankerView(gameRef.current)));
    const tick = setInterval(() => {
      const g = gameRef.current;
      const r = liveRead(buf, baseline, g.model, bankerView(g));
      setLiveAlert(r.alert);
      if (r.catchSpan && !caught) {
        caught = true;
        const at = performance.now();
        setCatchPulse(at);
        setLiveCaught(true);
        window.dispatchEvent(new CustomEvent('vault:catch', { detail: { at, ms: r.catchSpan.ms } }));
      }
    }, 150);
    void rec.promise.then((frames) => {
      if (!live || !frames.length) return;
      const nxt = step(gameRef.current, { type: 'peekDone', features: extractFeatures(frames, baseline) });
      tape.current = { frames, baseline, logIndex: nxt.log.length - (nxt.phase === 'bankerRead' ? 0 : 1) };
      setGame(nxt);
      // a walk goes straight to the replay (its line is the reason); an offer is spoken first
      setReadStage(nxt.phase === 'bankerRead' ? 'speak' : 'none');
    });
    return () => { live = false; rec.cancel(); recRef.current = null; unsub(); clearInterval(tick); };
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
    if (screen !== 'play' || game.phase !== 'reveal' || readStage === 'speak' || replayOwed) return;
    if (revealN >= hidden.length) return;
    const id = setTimeout(() => setRevealN((n) => n + 1), (revealN === 0 ? 700 : 380) / P);
    return () => clearTimeout(id);
  }, [screen, game.phase, readStage, replayOwed, revealN, hidden.length, P]);

  // game over: tell sheet, history, unlocks, share card (once per game)
  useEffect(() => {
    if (game.phase !== 'over' || endedFor.current === gameNo.current) return;
    endedFor.current = gameNo.current;
    const sheet = tellSheet(game);
    const prev = history;
    const next = updateHistory(prev, sheet, new Date().toISOString());
    saveHistory(next);
    saveHowSeen();
    setHistory(next);
    const trend = hideTrend(prev.games, sheet);
    const tell = sheet.biggest ? tellLine(sheet.biggest.key, sheet.biggest.effect) : 'I could not find your tell this time.';
    setEnd({ sheet, prev, next, unlockedBefore: unlockedLevel(prev), unlockedNow: unlockedLevel(next), trend, tell });
    bus?.clear(); // the session's signal numbers are not kept past the game
    tape.current = null;
    const sc = game.score;
    if (sc) {
      void renderShareCard({
        pile: sc.pile, bankNo: game.level, rank: sc.rank, bankerCorrect: sc.bankerCorrect, bankerCalls: sc.bankerCalls,
        daily: daily ? today() : null, won: sc.won, line: shareTellLine(sheet.biggest?.key ?? null),
      }).then((blob) => setCardUrl(URL.createObjectURL(blob))).catch(() => setCardUrl(null));
    }
  }, [game, history, daily, bus]);

  // he names your tell out loud at the end of the run
  useEffect(() => {
    if (!end || screen !== 'play' || game.phase !== 'over') return;
    const s = speak(end.tell, P > 1 ? 2 : 1);
    return () => s.cancel();
  }, [end, screen, game.phase, P]);

  // he opens the next run with what he remembers, once, when the board first shows
  useEffect(() => {
    if (screen !== 'play' || game.phase !== 'board' || openSaid || !memLine || paused) return;
    setOpenSaid(true);
    speak(memLine, P > 1 ? 2 : 1);
  }, [screen, game.phase, openSaid, memLine, paused, P]);

  // the catch replay after every settled box
  const replay: { verdict: ReplayVerdict; tape: PeekTape | null } | null = useMemo(() => {
    if (!replayOwed || !game.lastOutcome || !game.read) return null;
    const o = game.lastOutcome;
    const t = tape.current && tape.current.logIndex === game.log.length - 1 ? tape.current : null;
    return { verdict: replayVerdict(o.features, game.read, o.kind, game.level), tape: t };
  }, [replayOwed, game.lastOutcome, game.read, game.log.length, game.level]);
  const finishReplay = useCallback(() => {
    if (!replayOwed) return;
    stopSpeaking();
    setReplayedN(game.log.length);
    if (game.phase === 'audit') { setReadStage('none'); dispatch({ type: 'next' }); }
  }, [replayOwed, game.log.length, game.phase, dispatch]);
  useEffect(() => {
    if (!replay || paused) return;
    const t0 = performance.now();
    const s = speak(replay.verdict.line, P > 1 ? 2 : 1);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void s.done.then(() => {
      if (!live) return;
      const wait = Math.max(700, 3000 / P - (performance.now() - t0));
      timer = setTimeout(() => { if (live) finishReplay(); }, wait);
    });
    return () => { live = false; s.cancel(); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, paused, P]);

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


  const leave = useCallback(() => {
    if ((game.phase === 'audit' && readStage !== 'speak') || game.phase === 'board') { stopSpeaking(); setReplayedN(game.log.length); setReadStage('none'); dispatch({ type: 'leave' }); }
  }, [game.phase, game.log.length, readStage, dispatch]);

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

  const skipPractice = useCallback(() => {
    if (game.phase !== 'practice') return;
    saveHowSeen();
    setWantPractice(false);
  }, [game.phase]);

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
        if (k === 'enter' || k === ' ') { if (history.games.length === 0) startGame(1, false); else setScreen('ladder'); }
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
        if (k === 'enter') afterConsent();
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
    if (game.phase === 'baseline' && k === 'h') { setWantPractice((w) => !w); return; }
    if (game.phase === 'practice' && k === 'k') { skipPractice(); return; }
    if (game.phase === 'practice' && (k === 'enter' || k === ' ')) { e.preventDefault(); practiceNext(); return; }
    if (readStage === 'speak' && (k === ' ' || k === 'enter')) { e.preventDefault(); speechRef.current?.cancel(); return; }
    if (game.phase === 'board') {
      if (/^[0-9]$/.test(k)) { const idx = k === '0' ? 9 : Number(k) - 1; const b = game.boxes[idx]; if (b && b.state === 'sealed') pick(b.id); return; }
      if (k === 'l') leave();
      return;
    }
    if (game.phase === 'bankerRead') { if (k === 's') sellOrOpen('sell'); if (k === 'o') sellOrOpen('open'); return; }
    if (replayOwed) { if (k === 'enter' || k === ' ') { e.preventDefault(); finishReplay(); } else if (k === 'l' && game.phase === 'audit' && runLeft(game) > 0) leave(); return; }
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
      : (readStage !== 'none' || replay) && game.lastOutcome ? game.lastOutcome.boxId : null;
  const bankerState: BankerState = screen !== 'play' ? 'idle'
    : replay ? (replay.verdict.caught ? 'walking' : 'speaking')
      : readStage === 'speak' ? 'speaking'
      : game.phase === 'peek' || game.phase === 'baseline' || (game.phase === 'practice' && practice.stage === 'peek') ? 'reading'
        : game.phase === 'bankerRead' ? 'offering'
          : game.phase === 'audit' && game.lastOutcome?.decision === 'walk' && readStage === 'after' ? 'walking'
            : 'idle';
  const onBoxClick = useCallback((id: number) => pick(id), [pick]);

  // how suspicious he is right now (0..1), for the scene and the heartbeat
  const alert = screen !== 'play' || paused || game.phase === 'over' ? 0
    : game.phase === 'peek' ? liveAlert
      : replay ? (replay.verdict.caught ? 0.95 : 0.12)
        : game.phase === 'bankerRead' && game.read ? Math.max(game.read.pTrap, game.read.decision === 'unread' ? 0.5 : 0)
          : game.phase === 'board' ? restingAlert(game.model, bankerView(game))
            : 0.08;
  const bpmRaw = usePoll(() => bus?.pulse() ?? null, [bus], 1000);
  const bpm = bpmRaw === null ? null : Math.round(bpmRaw);
  useHeartbeat({ bpm, level: alert, muted, enabled: screen === 'play' && !paused && game.phase !== 'over' && game.phase !== 'reveal' });

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
        alert={alert}
        catchPulse={catchPulse}
        onBoxClick={screen === 'play' && game.phase === 'board' && !paused ? onBoxClick : undefined}
        quality="high"
        lite={live}
      />
      <div className="vui" data-screen={screen} data-phase={game.phase} data-stage={readStage} data-practice={`${practice.idx}:${practice.stage}`} data-paused={paused ? '1' : '0'}>
        {menu ? <div className="scrim-full" style={game.phase === 'over' && screen === 'play' ? { background: 'radial-gradient(ellipse at 30% 40%, rgba(12,9,6,0.78), rgba(5,4,3,0.95) 70%)' } : undefined} /> : <><div className="scrim-top" /><div className="scrim-bottom" /></>}

        {screen === 'title' && <TitleScreen onGo={() => (history.games.length === 0 ? startGame(1, false) : setScreen('ladder'))} />}
        {screen === 'ladder' && (
          <LadderScreen sel={sel} setSel={setSel} unlocked={unlocked} history={history}
            onPlay={(lv) => startGame(lv, false)} onDaily={() => startGame(unlocked, true)}
            onWipe={() => { wipeHistory(); setHistory(loadHistory()); setSel(0); }} />
        )}
        {screen === 'consent' && (
          <ConsentScreen onAgree={afterConsent} onBack={() => setScreen('ladder')} />
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
            <Hud game={game} daily={daily} />
            {(game.phase === 'board' || game.phase === 'bankerRead') && <ValuesBoard game={game} />}
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
                  <CalmStage bus={bus} recRef={recRef} wantPractice={wantPractice} howSeen={loadHowSeen()} onToggle={() => setWantPractice((w) => !w)} />
                )
              )}
              {game.phase === 'practice' && practiceKind && (
                <PracticeStage idx={practice.idx} total={game.practice.length} kind={practiceKind} stage={practice.stage}
                  last={practice.peeks[practice.peeks.length - 1]?.features ?? null} recRef={recRef} bus={bus} reusedCalm={reusedCalm} onNext={practiceNext} onSkip={skipPractice} />
              )}
              {game.phase === 'board' && (
                <>
                  {game.log.length === 0 && memLine
                    ? <Subtitle text={memLine} />
                    : <div className="prompt shadowed">Pick a box. {runLeft(game)} left this run.</div>}
                  <div className="rulebar shadowed">
                    {boardSeen === 0
                      ? 'Only you see inside. He reads your breath: he makes an offer, or he walks and the box burns.'
                      : 'Look safe at traps so he buys them. Stay quiet at treasure so he does not burn it.'}
                  </div>
                  <div className="actions">
                    <span className="small">Click a box, or press 1 to 0 from left to right</span>
                    {game.log.length > 0 && <Btn k="L" onClick={leave}>Leave the vault with {money(game.pile)}</Btn>}
                  </div>
                </>
              )}
              {game.phase === 'peek' && activeBox && <PeekStage kind={activeBox.kind} value={activeBox.value} recRef={recRef} bus={bus} caught={liveCaught} />}
              {readStage === 'speak' && game.read && <Subtitle text={game.read.reason} />}
              {game.phase === 'bankerRead' && readStage === 'after' && game.read && activeBox && (
                <OfferStage offer={game.read.offer ?? 0} blind={game.read.decision === 'unread'} reason={game.read.reason}
                  saw={kindName(activeBox.kind, activeBox.value)} onSell={() => sellOrOpen('sell')} onOpen={() => sellOrOpen('open')} />
              )}
              {replay && game.lastOutcome && (
                <ReplayStage game={game} verdict={replay.verdict} tape={replay.tape} onNext={finishReplay}
                  onLeave={game.phase === 'audit' && runLeft(game) > 0 ? leave : null} />
              )}
              {game.phase === 'reveal' && readStage !== 'speak' && !replay && (
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((midnight.getTime() - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const left = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return (
    <div className="center">
      <div className="ladder">
        <div>
          <div className="eyebrow enter">The banks</div>
          <div className="display enter" style={{ fontSize: 'var(--fs-xl)', margin: '10px 0 10px', ['--d' as string]: 1 }}>Five bankers. Each reads more of you.</div>
          <div className="howto enter" style={{ ['--d' as string]: 1 }}>
            <div><span className="n">1</span>Peek in a box. Treasure or trap.</div>
            <div><span className="n">2</span>He reads your body, then buys it or walks.</div>
            <div><span className="n">3</span>Sell him traps. Keep your treasure. Reach his target to win.</div>
          </div>
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
                  <div><span>Target</span><b>{money(L.target)}</b></div>
                  <div><span>Traps he can catch</span><b>{L.maxTrapsCaught === 0 ? 'None' : L.maxTrapsCaught}</b></div>
                  {b >= 0 && <div className="brass"><span>Your best</span><b>{money(b)}</b></div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="daily enter" style={{ ['--d' as string]: 7 }}>
          <div className="eyebrow">Today&rsquo;s vault</div>
          <div className="small" style={{ marginTop: 12 }}>Closes in</div>
          <div className="display countdown" style={{ fontSize: 'var(--fs-xl)', margin: '2px 0 12px' }}>{left}</div>
          <div className="body">Ten boxes, the same for every player, until the clock runs out. Then a new vault opens.</div>
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

function CalmStage({ bus, recRef, wantPractice, howSeen, onToggle }: {
  bus: SignalBus | null; recRef: React.MutableRefObject<{ progress: () => number } | null>; wantPractice: boolean; howSeen: boolean; onToggle: () => void;
}): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  const left = Math.max(0, Math.ceil((BASELINE_MS / 1000) * (1 - p)));
  return (
    <>
      <div className="eyebrow enter">Learn your calm</div>
      <div className="prompt shadowed" style={{ marginTop: 10 }}>Breathe normally. He is learning you.</div>
      <div className="bigbreath"><BreathLine bus={bus} big /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Ring progress={p} label={String(left)} />
        <div className="rulebar shadowed" style={{ marginTop: 0, textAlign: 'left', maxWidth: 440 }}>
          That line is your breathing. {BASELINE_MS / 1000} seconds, then the boxes.
        </div>
      </div>
      <div className="actions" style={{ marginTop: 10 }}>
        <Btn k="H" onClick={onToggle}>
          {wantPractice ? (howSeen ? 'Practice on: two labelled boxes first' : 'Skip the two practice boxes') : 'How it works: two practice boxes first'}
        </Btn>
      </div>
    </>
  );
}

function PracticeStage({ idx, total, kind, stage, last, recRef, bus, reusedCalm, onNext, onSkip }: {
  idx: number; total: number; kind: BoxKind; stage: PracticeState['stage']; last: PeekFeatures | null;
  recRef: React.MutableRefObject<{ progress: () => number } | null>; bus: SignalBus | null; reusedCalm: boolean; onNext: () => void; onSkip: () => void;
}): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  const what = kind === 'trap' ? 'a trap' : kind === 'big' ? 'a big treasure' : 'a small treasure';
  if (stage === 'intro') {
    return (
      <>
        <div className="eyebrow enter">How it works  ·  Practice {idx + 1} of {total}</div>
        <div className="prompt shadowed" style={{ marginTop: 10 }}>He knows this one holds {what}.</div>
        <div className="rulebar shadowed">
          {idx === 0 && reusedCalm ? 'He remembers your calm from last game. ' : ''}
          Look inside and he watches how your breath reacts to a box he already knows.
        </div>
        <div className="actions">
          <Btn primary k="Space" onClick={onNext}>Look inside</Btn>
          <Btn k="K" onClick={onSkip}>Skip to the boxes</Btn>
        </div>
      </>
    );
  }
  if (stage === 'peek') {
    return (
      <>
        <div className={`contents ${kind} shadowed`}>{kindName(kind)}</div>
        <div className="bigbreath"><BreathLine bus={bus} big /></div>
        <div className="peekrow">
          <Ring progress={p} label={String(Math.max(0, Math.ceil((PEEK_MS / 1000) * (1 - p))))} />
          <div className="rulebar shadowed" style={{ marginTop: 0, textAlign: 'left' }}>Only you can see inside. Keep breathing. He is watching.</div>
        </div>
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
      <div className="eyebrow enter">How it works  ·  Noted</div>
      <div className="prompt shadowed" style={{ marginTop: 10 }}>{note}</div>
      <div className="rulebar shadowed">{idx + 1 < total ? 'He wrote that down. One more.' : 'He has seen you at a trap and at treasure. Now the real boxes.'}</div>
      <div className="actions"><Btn primary k="Space" onClick={onNext}>{idx + 1 < total ? 'Next practice box' : 'To the boxes'}</Btn></div>
    </>
  );
}

function PeekStage({ kind, value, recRef, bus, caught }: {
  kind: BoxKind; value: number; recRef: React.MutableRefObject<{ progress: () => number } | null>; bus: SignalBus | null; caught: boolean;
}): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  return (
    <>
      <div className="eyebrow">Only you can see this</div>
      <div className={`contents ${kind} shadowed`} style={{ marginTop: 4 }}>{kindName(kind, value)}</div>
      <div className={`bigbreath${caught ? ' caught' : ''}`}>
        <BreathLine bus={bus} big />
        {caught && <div className="sawit">He saw that.</div>}
      </div>
      <div className="peekrow">
        <Ring progress={p} label={String(Math.max(0, Math.ceil((PEEK_MS / 1000) * (1 - p))))} />
        <div className="rulebar shadowed" style={{ marginTop: 0, textAlign: 'left' }}>Keep breathing. He is reading that line.</div>
      </div>
    </>
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

/** What the box did to your pile, in one line, with a stamp. */
function outcomeCopy(game: GameState): { stamp: JSX.Element; line: string } {
  const o = game.lastOutcome!;
  const trap = o.kind === 'trap';
  if (o.result === 'burned') {
    return { stamp: <span className="stamp">He walked</span>, line: trap ? 'It was a trap. You lost nothing.' : `It held ${money(o.value)}. He burned it.` };
  }
  if (o.result === 'sold' && trap) {
    const heist = o.decision === 'offer';
    return {
      stamp: <span className="stamp good">{heist ? 'Heist' : 'Sold'}</span>,
      line: heist ? `You sold him a trap for ${money(o.offer ?? 0)} and it paid ${money(Math.round((o.offer ?? 0) * RULES.heistBonus))} more.` : `You sold him a trap blind for ${money(o.offer ?? 0)}.`,
    };
  }
  if (o.result === 'sold') return { stamp: <span className="stamp brassy">Sold</span>, line: `Sold for ${money(o.offer ?? 0)}. It held ${money(o.value)}.` };
  if (trap) return { stamp: <span className="stamp">Trap</span>, line: 'You opened a trap. Nothing added.' };
  return { stamp: <span className="stamp good">Opened</span>, line: `${money(o.value)} added to your pile.` };
}

function ReplayStage({ game, verdict, tape, onNext, onLeave }: {
  game: GameState; verdict: ReplayVerdict; tape: { frames: SignalFrame[]; baseline: Baseline } | null; onNext: () => void; onLeave: (() => void) | null;
}): JSX.Element {
  const { stamp, line } = outcomeCopy(game);
  const left = runLeft(game);
  return (
    <div className={`replay${verdict.caught ? ' caught' : ' missed'}`} key={game.log.length}>
      <div className="replay-head">
        {stamp}
        <span className="replay-out shadowed">{line}</span>
      </div>
      <div className="replay-panel">
        <div className="eyebrow">{verdict.caught ? 'Where he caught you' : 'What he saw'}</div>
        {tape ? <ReplayTrace frames={tape.frames} baseline={tape.baseline} marks={verdict.marks} /> : <div className="small">No trace for this box.</div>}
        <div className="replay-chips">
          {verdict.marks.length === 0 ? <span className="chip calm">Nothing moved</span> : verdict.marks.map((m, i) => <span key={i} className={`chip ${m.kind}`}>{m.label}</span>)}
        </div>
      </div>
      <Subtitle text={verdict.line} />
      <div className="actions" style={{ marginTop: 6 }}>
        <Btn k="Enter" onClick={onNext}>{left > 0 ? `Next box  ·  ${left} left` : game.phase === 'reveal' ? 'Go on' : 'Open the rest'}</Btn>
        {onLeave && <Btn k="L" onClick={onLeave}>Leave with {money(game.pile)}</Btn>}
      </div>
    </div>
  );
}

function RevealStage({ game, hidden, revealN, onDone }: { game: GameState; hidden: number[]; revealN: number; onDone: () => void }): JSX.Element {
  const shown = hidden.slice(0, revealN);
  const done = revealN >= hidden.length;
  const head = game.busted ? 'Full heat. He threw you out with nothing.' : game.left ? `You left the vault with ${money(game.pile)}.` : `Run over. You banked ${money(game.pile)}.`;
  const burned = shown.map((id) => game.boxes.find((x) => x.id === id)!).filter((b) => b.state === 'burned');
  return (
    <>
      {game.busted ? <span className="stamp">Thrown out</span> : <span className="stamp brassy">{game.left ? 'You left' : 'Audit'}</span>}
      <div className="prompt shadowed" style={{ fontSize: 'var(--fs-l)', marginTop: 16 }}>{head}</div>
      <div className="rulebar shadowed" style={{ minHeight: '3em' }}>
        {shown.length === 0 ? 'Now every box you did not open is revealed.' : burned.length === 0 ? 'The boxes you did not play are open.' : burned.map((b) => (
          <div key={b.id}>Box {b.id + 1}: {kindName(b.kind, b.value).toLowerCase()}. {b.kind === 'trap' ? 'He walked from it. Right call.' : 'He walked from it. Wrong call.'}</div>
        ))}
      </div>
      {done && <div className="actions"><Btn primary k="Enter" onClick={onDone}>See your tell</Btn></div>}
    </>
  );
}

function EndScreen({ game, end, cardUrl, daily, onAgain, onNextBank, onLadder, onSave }: {
  game: GameState; end: EndInfo; cardUrl: string | null; daily: boolean;
  onAgain: () => void; onNextBank: (() => void) | null; onLadder: () => void; onSave: () => void;
}): JSX.Element {
  const sc = game.score!;
  const { sheet, trend } = end;
  const newlyUnlocked = end.unlockedNow > end.unlockedBefore ? levelConfig(end.unlockedNow) : null;
  const result = sc.busted ? 'Thrown out at full heat.' : sc.won ? `You beat the ${sc.rank}.` : `The ${sc.rank} kept the upper hand.`;
  const cur = levelConfig(game.level);
  const above = game.level < LEVELS.length ? levelConfig((game.level + 1) as LevelNo) : null;
  const beatIt = `bank ${money(cur.target)} and let him catch ${cur.maxTrapsCaught === 0 ? 'no traps' : `at most ${cur.maxTrapsCaught} trap${cur.maxTrapsCaught === 1 ? '' : 's'}`}`;
  const unlockLine = newlyUnlocked
    ? `Unlocked: Bank ${ROMAN[newlyUnlocked.level - 1]}, the ${newlyUnlocked.rank}. ${readsLine(newlyUnlocked.level)}`
    : !above ? (sc.won ? 'You beat every bank. Now beat your own tell.' : `The last bank. To beat him: ${beatIt}.`)
      : end.unlockedNow > game.level ? `Bank ${ROMAN[above.level - 1]} is open: the ${above.rank}. ${readsLine(above.level)}`
        : `Next unlock: Bank ${ROMAN[above.level - 1]}, the ${above.rank}. To open it: ${beatIt}.`;
  return (
    <div className="end">
      <div className="left">
        <div className="eyebrow enter">{daily ? 'Daily vault  ·  ' : ''}Bank {ROMAN[game.level - 1]}  ·  {result}</div>
        <div className="pile-big num enter" style={{ ['--d' as string]: 1 }}>{money(sc.pile)}</div>
        <div className="body enter" style={{ ['--d' as string]: 2 }}>
          {sheet.readLine} {sc.trapsSold > 0 && `You sold him ${sc.trapsSold} trap${sc.trapsSold > 1 ? 's' : ''}.`} {sc.treasuresBurned > 0 && `He burned ${sc.treasuresBurned} of your treasures.`}
        </div>
        <div className="rule enter" style={{ margin: '8px 0', ['--d' as string]: 3 }} />
        <div className="eyebrow enter" style={{ ['--d' as string]: 3 }}>Your tell</div>
        <div className="headline enter" style={{ ['--d' as string]: 4 }}>&ldquo;{end.tell}&rdquo;</div>
        {sheet.biggest && <div className="small enter" style={{ ['--d' as string]: 4 }}>{sheet.biggest.sentence}</div>}
        <div className={`trendline ${trend.trend} enter`} style={{ ['--d' as string]: 5 }}>
          <span className="eyebrow">{trend.trend === 'better' ? 'Hidden better' : trend.trend === 'worse' ? 'Showing more' : trend.trend === 'same' ? 'No change' : trend.trend === 'first' ? 'Next run' : 'Last time'}</span>
          <span>{trend.line}</span>
        </div>
        <div className={`unlock enter${newlyUnlocked ? '' : ' next'}`} style={{ ['--d' as string]: 6 }}>{unlockLine}</div>
        <div className="actions enter" style={{ justifyContent: 'flex-start', marginTop: 8, ['--d' as string]: 7 }}>
          {onNextBank ? <Btn primary k="N" onClick={onNextBank}>Next bank</Btn> : null}
          <Btn primary={!onNextBank} k="Enter" onClick={onAgain}>Run it again</Btn>
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
