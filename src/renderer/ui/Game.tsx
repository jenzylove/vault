/**
 * The Vault game flow: a heist overlay over <VaultScene>, driven by the engine reducer.
 * Signals come only through the SignalSource the App hands in; nothing here knows live from simulated
 * except the on screen labels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  JOBS, MIN_QUALITY, BASELINE_MS, PEEK_LEAD_MS, OFFER_WINDOW_MS, MAX_STRIKES, offerAt,
  bankRun, bankerView, linePick, dailySeed, extractFeatures, heistPay, hideTrend, isUnlocked, jobById, learnBaseline, liveRead, memoryLine, newGame,
  newlyUnlocked, nextLocked, readsList, replayVerdict, restingAlert, runLeft, sayTell, shareTellLine, step, tellLine, tellSheet, unlockProgress, updateHistory,
  type Baseline, type BoxKind, type GameAction, type GameState, type HideTrend, type Job, type JobId, type PeekFeatures, type ReplayVerdict, type Stash,
  type TellHistory, type TellSheet, type FinalCall, type BoxOutcome,
} from '../engine';
import type { SignalFrame, SignalSource, SourceStatus } from '../signals/types';
import { useHeartbeat } from './heartbeat';
import { FaceWatch, GapWatch, STALE_MS, type FaceProblem } from '../signals/lineup';
import { V_OK, V_NO_FACE, V_MANY_FACES, validationWords } from '../signals/status';
import { Lineup } from './Lineup';
import type { BankerState, SceneBox, SceneBoxKind, ScenePracticeBox } from '../scene/types';
import { SignalBus } from './signalBus';
import { isPeekAware } from './simSource';
import { speak, stopSpeaking, setMuted, isMuted } from './speech';
import {
  loadHistory, saveHistory, wipeHistory, loadKey, saveKey, forgetKey, pace, loadHowSeen, saveHowSeen,
  loadStash, saveStash, firstJobOffered, markFirstJobOffered,
} from './storage';
import { renderShareCard } from './shareCard';
import { loadFonts } from './fonts';
import { alarm, coins, dialClicks, doorClunk, doorCreak, drumRoll, dudSting, hit, lootChime, offerTick } from './sfx';
import { useMusic } from './music';
import {
  BodyPanel, BreathLine, Btn, Hud, LiveScene, Purse, Reads, ReplayTrace, Ring, RuleStrip, Subtitle, ValuesBoard, caughtCount, money, usePoll,
} from './parts';
import './styles.css';

export type SourceChoice = { mode: 'live'; key: string } | { mode: 'simulated' };
export interface GameProps {
  createSource: (c: SourceChoice) => Promise<SignalSource>;
  /** A Presage key is already set on this computer (.env), so the key screen need not ask for one. */
  keyOnFile?: boolean;
}

type Screen = 'title' | 'jobs' | 'consent' | 'key' | 'lineup' | 'play';
interface PracticeState { idx: number; stage: 'intro' | 'peek' | 'noted'; peeks: { kind: BoxKind; features: PeekFeatures }[] }
interface EndInfo {
  sheet: TellSheet; trend: HideTrend; tell: string;
  stashBefore: Stash; stashAfter: Stash; banked: number; opened: Job[];
}
/** The last look's own frames, kept in memory only until its replay is shown. */
interface PeekTape { frames: SignalFrame[]; baseline: Baseline; logIndex: number }

const today = (): string => new Date().toLocaleDateString('en-CA');
/** What is inside, in heist words. */
const kindName = (k: BoxKind, v?: number): string => (k === 'trap' ? 'Empty safe' : k === 'big' ? `Gold bars${v ? `, ${money(v)}` : ''}` : `Cash${v ? `, ${money(v)}` : ''}`);
const secs = (ms: number): string => (ms / 1000).toFixed(1);

/** Credits: with the camera on and no input for this long outside a read, the camera turns off. */
const IDLE_MS = 60_000;
/** Credits: a face pause that lasts this long turns the camera off. */
const FACE_PAUSE_CAP_MS = 45_000;

function useCountdown(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((midnight.getTime() - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function Game({ createSource, keyOnFile = false }: GameProps): JSX.Element {
  const P = useMemo(pace, []);
  const [screen, setScreen] = useState<Screen>('title');
  const [history, setHistory] = useState<TellHistory>(loadHistory);
  const [stash, setStash] = useState<Stash>(loadStash);
  const [sel, setSel] = useState(0);
  const [jobId, setJobId] = useState<JobId>('first');
  const job = jobById(jobId);
  const daily = job.daily;
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
  const [revealN, setRevealN] = useState(0);
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [lineupOff, setLineupOff] = useState<string | null>(null);
  const [pauseWhy, setPauseWhy] = useState<string | null>(null);
  const [srcStatus, setSrcStatus] = useState<SourceStatus | null>(null);
  const [facePause, setFacePause] = useState<FaceProblem>(null);
  const [gapLost, setGapLost] = useState(false);
  const [wantPractice, setWantPractice] = useState<boolean>(() => !loadHowSeen());
  const [liveAlert, setLiveAlert] = useState(0);
  const [catchPulse, setCatchPulse] = useState<number | undefined>(undefined);
  const [payout, setPayout] = useState<{ at: number; amount: number } | undefined>(undefined);
  const [bustedAt, setBustedAt] = useState<number | undefined>(undefined);
  const [liveCaught, setLiveCaught] = useState(false);
  const [replayedN, setReplayedN] = useState(0);
  const [memLine, setMemLine] = useState<string | null>(null);
  const [openSaid, setOpenSaid] = useState(false);
  const [firstReport, setFirstReport] = useState(false);
  /** The crack: which look's door is open and its contents landed (nothing shows before). */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** The ticking offer: ms gone of OFFER_WINDOW_MS (game time), and whether it ran out. */
  const [offerMs, setOfferMs] = useState(0);
  const offerMsRef = useRef(0);
  const [tooSlow, setTooSlow] = useState(false);
  /** He kept watching while the offer was up and caught your breath: the deal is off. */
  const [flinched, setFlinched] = useState(false);
  /** The latest strike: which one and when, so its lamp flashes. */
  const [strikeAt, setStrikeAt] = useState<{ n: number; at: number } | null>(null);
  /** The last safe's call: 0 he thinks, 1 he calls it, 2 the truth and your take. */
  const [finalStage, setFinalStage] = useState(0);
  const finalPaid = useRef(false);
  const tape = useRef<PeekTape | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const lineupFor = useRef<'new' | 'resume'>('new');
  const faceWatch = useRef(new FaceWatch());
  const gapWatch = useRef(new GapWatch());
  const lastInput = useRef(performance.now());
  const lastBaseline = useRef<Baseline | null>(null);
  const recRef = useRef<{ progress: () => number } | null>(null);
  const speechRef = useRef<{ cancel: () => void } | null>(null);
  const gameNo = useRef(0);
  const endedFor = useRef(-1);

  useEffect(() => { void loadFonts(); }, []);

  const dispatch = useCallback((a: GameAction) => setGame((s) => step(s, a)), []);

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
    gapWatch.current.reset();
    setFacePause(null);
    setGapLost(false);
    if (src.kind === 'live') { lineupFor.current = 'new'; setLineupOff(null); setScreen('lineup'); }
    try {
      b.attach();
      await src.start();
    } catch (e) {
      void src.stop();
      const msg = (e as Error)?.message ?? 'unknown error';
      if (src.kind === 'live') { setLineupOff(msg); return; }
      setErr(`The camera did not start: ${msg}. Check the key, or try a sample run.`);
      setScreen('key');
      return;
    }
    if (src.kind !== 'live') enterPlay();
  }, [enterPlay]);

  const startGame = useCallback((id: JobId, with_?: { src: SignalSource; b: SignalBus }) => {
    const j = jobById(id);
    const seed = j.daily ? dailySeed(today()) : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    gameNo.current++;
    setJobId(id);
    setGame(newGame(seed, j.level, j.rules));
    // a calm learned at another look length is not comparable
    if (lastBaseline.current && (lastBaseline.current.peekMs ?? 0) !== j.peekMs) lastBaseline.current = null;
    setPractice({ idx: 0, stage: 'intro', peeks: [] });
    setStrikeAt(null);
    setFinalStage(0);
    finalPaid.current = false;
    setRevealN(0);
    setEnd(null);
    setFirstReport(false);
    setCardUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setCalmFailed(false);
    setErr(null);
    setReplayedN(0);
    setLiveAlert(0);
    setLiveCaught(false);
    setOpenSaid(false);
    tape.current = null;
    setWantPractice(!loadHowSeen());
    setMemLine(memoryLine(loadHistory()));
    const src = with_?.src ?? source;
    const b = with_?.b ?? bus;
    if (src && b && src.kind !== 'live') { void beginPlay(src, b); return; }
    if (!consented) { setScreen('consent'); return; }
    if (!src || !b) { setScreen('key'); return; }
    void beginPlay(src, b);
  }, [consented, source, bus, beginPlay]);

  const makeSource = useCallback(async (c: SourceChoice): Promise<{ src: SignalSource; b: SignalBus } | null> => {
    setErr(null);
    if (c.mode === 'live') {
      if (!c.key.trim() && !keyOnFile) { setErr('Paste your Presage key first.'); return null; }
      if (c.key.trim()) saveKey(c.key);
    }
    void source?.stop(); // never two sessions
    let src: SignalSource;
    try { src = await createSource(c); } catch (e) {
      setErr(`That source is not available: ${(e as Error)?.message ?? 'unknown error'}.`);
      return null;
    }
    const b = new SignalBus(src);
    setSource(src);
    setBus(b);
    lastBaseline.current = null; // a new body needs a new calm
    return { src, b };
  }, [createSource, keyOnFile, source]);

  const choose = useCallback(async (c: SourceChoice) => {
    const made = await makeSource(c);
    if (made) await beginPlay(made.src, made.b);
  }, [makeSource, beginPlay]);

  /** Title screen: first time players land straight on First Job, once. */
  const fromTitle = useCallback((with_?: { src: SignalSource; b: SignalBus }) => {
    if (!firstJobOffered() && history.games.length === 0) { markFirstJobOffered(); startGame('first', with_); return; }
    setScreen('jobs');
  }, [history.games.length, startGame]);

  const sampleRun = useCallback(async () => {
    const made = await makeSource({ mode: 'simulated' });
    if (made) fromTitle(made);
  }, [makeSource, fromTitle]);

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

  const toJobs = useCallback(() => {
    stopCamera();
    bus?.clear();
    setPaused(false);
    setScreen('jobs');
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
    gapWatch.current.reset();
    setFacePause(null);
    setGapLost(false);
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
    setScreen('jobs');
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

  // ---------- face pause, signal gaps and idle guard (live only) ----------
  const statusRef = useRef<SourceStatus | null>(null);
  statusRef.current = srcStatus;
  const live = source?.kind === 'live';
  // a replay is owed for every settled safe until it has been shown
  const replayOwed = screen === 'play' && game.log.length > replayedN && (game.phase === 'audit' || game.phase === 'reveal');
  const reading = screen === 'play' && !paused && (
    (game.phase === 'baseline' && !calmFailed)
    || (game.phase === 'practice' && practice.stage === 'peek')
    || game.phase === 'peek');
  // Gaps under 5 s are ignored entirely; past that the read pauses calmly and goes on by itself.
  useEffect(() => {
    if (!live || screen !== 'play' || paused || game.phase === 'over' || game.phase === 'reveal') {
      setFacePause(null); setGapLost(false); gapWatch.current.reset(); return;
    }
    let since: number | null = null;
    const id = setInterval(() => {
      const now = performance.now();
      const p = faceWatch.current.check(now);
      const v = statusRef.current?.validation;
      const sdkProblem = !!v && v.code !== V_OK && v.code !== V_NO_FACE && v.code !== V_MANY_FACES && now - v.at < STALE_MS;
      const q = bus?.quality() ?? null;
      const bad = !bus || now - bus.lastFrameAt > 1500 || (q !== null && q < 0.5) || sdkProblem;
      const g = gapWatch.current.update(bad, now);
      setFacePause(p);
      setGapLost(g);
      if (p === null && !g) { since = null; return; }
      since ??= now;
      if (now - since > FACE_PAUSE_CAP_MS) pause('Nobody was in view, so he turned the camera off.');
    }, 250);
    return () => clearInterval(id);
  }, [live, screen, paused, game.phase, bus, pause]);
  const lost = facePause !== null || gapLost;
  const halted = paused || (lost && reading);

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
      if (reading || replayOwed || game.phase === 'bankerRead' || game.phase === 'finalCall') { lastInput.current = performance.now(); return; }
      if (performance.now() - lastInput.current > IDLE_MS) pause('You were away, so he turned the camera off.');
    }, 2000);
    const hide = () => { if (document.hidden) pause('The window was hidden, so he turned the camera off.'); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', hide); };
  }, [live, screen, paused, game.phase, reading, replayOwed, pause]);

  // ---------- timed windows (signal time) ----------
  // learn your calm
  useEffect(() => {
    if (screen !== 'play' || halted || !bus || game.phase !== 'baseline' || calmFailed) return;
    const rec = bus.record(BASELINE_MS);
    recRef.current = rec;
    let on = true;
    const peekMs = job.peekMs;
    void rec.promise.then((frames) => {
      if (!on || !frames.length) return;
      const b = learnBaseline(frames, peekMs);
      if (b.quality < 0.6) { setCalmFailed(true); return; }
      lastBaseline.current = b;
      dispatch({ type: 'baselineDone', baseline: b });
    });
    return () => { on = false; rec.cancel(); recRef.current = null; };
  }, [screen, halted, bus, game.phase, calmFailed, calmTry, dispatch, job.peekMs]);

  // practice is optional: skipped straight to the safes unless the player asked for it
  useEffect(() => {
    if (screen === 'play' && game.phase === 'practice' && !wantPractice) dispatch({ type: 'practiceDone', peeks: practice.peeks });
  }, [screen, game.phase, wantPractice, practice.peeks, dispatch]);

  // practice looks
  const practiceKind: BoxKind | null = game.practice[practice.idx]?.kind ?? null;
  const activeBox = game.activeBoxId === null ? null : game.boxes.find((b) => b.id === game.activeBoxId) ?? null;
  // the crack: dial clicks, lever, the door creaks open (scene/Safe.tsx keeps the same clock), then the contents land
  const leadKey = screen !== 'play' ? null
    : game.phase === 'peek' && activeBox ? `b${gameNo.current}:${activeBox.id}`
      : game.phase === 'practice' && practice.stage === 'peek' && practiceKind ? `p${gameNo.current}:${practice.idx}` : null;
  const leadDone = leadKey !== null && openKey === leadKey;
  const leadKind: BoxKind | null = game.phase === 'peek' ? activeBox?.kind ?? null : practiceKind;
  useEffect(() => {
    if (!leadKey || openKey === leadKey || !leadKind) return;
    dialClicks(8, 820, 500);
    doorClunk(1380);
    doorCreak(1460, 560);
    const kind = leadKind;
    const id = setTimeout(() => {
      setOpenKey(leadKey);
      if (kind === 'trap') dudSting(); else lootChime(kind === 'big');
    }, PEEK_LEAD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadKey]);
  useEffect(() => {
    if (screen !== 'play' || halted || !bus || !source || game.phase !== 'practice' || practice.stage !== 'peek' || !practiceKind || !game.baseline || !leadDone) return;
    if (isPeekAware(source)) source.onPeek(practiceKind);
    const rec = bus.record(job.peekMs);
    recRef.current = rec;
    let on = true;
    const baseline = game.baseline;
    void rec.promise.then((frames) => {
      if (!on || !frames.length) return;
      const features = extractFeatures(frames, baseline);
      setPractice((p) => ({ ...p, stage: 'noted', peeks: [...p.peeks, { kind: practiceKind, features }] }));
    });
    return () => { on = false; rec.cancel(); recRef.current = null; };
  }, [screen, halted, bus, source, game.phase, game.baseline, practice.stage, practice.idx, practiceKind, job.peekMs, leadDone]);

  // the look: starts the moment the contents land
  useEffect(() => {
    if (screen !== 'play' || halted || !bus || !source || game.phase !== 'peek' || !activeBox || !game.baseline || !leadDone) return;
    if (isPeekAware(source)) source.onPeek(activeBox.kind, linePick(gameRef.current));
    const rec = bus.record(job.peekMs);
    recRef.current = rec;
    let on = true;
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
      if (!on || !frames.length) return;
      const nxt = step(gameRef.current, { type: 'peekDone', features: extractFeatures(frames, baseline) });
      tape.current = { frames, baseline, logIndex: nxt.log.length - (nxt.phase === 'bankerRead' ? 0 : 1) };
      // a pass goes straight to the replay (its line is the reason); an offer shows at once, ticking
      setGame(nxt);
    });
    return () => { on = false; rec.cancel(); recRef.current = null; unsub(); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, halted, bus, source, game.phase, activeBox?.id, game.baseline, dispatch, job.peekMs, leadDone]);

  // the Fence speaks his read (on The Ghost he keeps his reasons)
  const spoken = game.read ? (job.hints ? game.read.reason : `I'll give you ${game.read.offer ?? 0}.`) : '';
  // he says it out loud while the offer is already on screen and ticking: the player can choose at once
  useEffect(() => {
    if (game.phase !== 'bankerRead' || !game.read || paused) return;
    const s = speak(spoken, P > 1 ? 2 : 1);
    speechRef.current = s;
    return () => { s.cancel(); speechRef.current = null; };
  }, [game.phase, game.read, paused, P, spoken]);

  // the ticking offer: his price falls every second; let it run out and you keep what is inside
  const offerKey = game.phase === 'bankerRead' ? `${gameNo.current}:${game.log.length}` : null;
  useEffect(() => { offerMsRef.current = 0; setOfferMs(0); setTooSlow(false); setFlinched(false); }, [offerKey]);
  // he keeps reading you while you decide: a breath hold during the offer and he pulls it
  useEffect(() => {
    if (!offerKey || paused || tooSlow || !source || !game.baseline) return;
    const baseline = game.baseline;
    const buf: SignalFrame[] = [];
    const unsub = source.subscribe((f) => { buf.push(f); });
    const t0 = performance.now();
    const id = setInterval(() => {
      // a short grace: a breath already held as the look ended is not a flinch at his offer
      if (performance.now() - t0 < 800) { buf.length = 0; return; }
      const g = gameRef.current;
      const r = liveRead(buf, baseline, g.model, bankerView(g));
      if (r.catchSpan) { setCatchPulse(performance.now()); setFlinched(true); setTooSlow(true); }
    }, 150);
    return () => { clearInterval(id); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey, paused, tooSlow, source, game.baseline]);
  useEffect(() => {
    if (!offerKey || paused || tooSlow) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const was = offerMsRef.current;
      const acc = Math.min(OFFER_WINDOW_MS, was + (now - last) * P);
      last = now;
      offerMsRef.current = acc;
      setOfferMs(acc);
      if (acc >= OFFER_WINDOW_MS) { setTooSlow(true); return; }
      if (Math.floor(acc / 1000) > Math.floor(was / 1000)) offerTick(OFFER_WINDOW_MS - acc <= 2000);
    }, 40);
    return () => clearInterval(id);
  }, [offerKey, paused, tooSlow, P]);
  useEffect(() => {
    if (!tooSlow || game.phase !== 'bankerRead') return;
    speechRef.current?.cancel();
    const s = speak(flinched ? 'You flinched. The deal is off.' : 'Too slow.', P > 1 ? 2 : 1);
    hit();
    const id = setTimeout(() => dispatch({ type: 'expire' }), 1200 / P);
    return () => { clearTimeout(id); s.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooSlow]);

  // the last safe: he thinks, he calls it, then the truth and your take
  const finalKey = game.phase === 'finalCall' && game.finalCall ? `${gameNo.current}` : null;
  useEffect(() => {
    setFinalStage(0);
    if (!finalKey || !game.finalCall) return;
    const fc: FinalCall = game.finalCall;
    stopSpeaking();
    drumRoll(1500);
    let s: { cancel: () => void } | null = null;
    const t1 = setTimeout(() => {
      setFinalStage(1);
      hit();
      s = speak(fc.line ?? (fc.call === 'dud' ? 'Empty.' : fc.call === 'loot' ? 'Full.' : 'No bet.'), P > 1 ? 2 : 1);
    }, 1500 / P);
    const t2 = setTimeout(() => {
      setFinalStage(2);
      const now = performance.now();
      if (fc.call === 'none') { /* no read, no bet: the take stays */ }
      else if (fc.right) { setBustedAt(now); alarm(); }
      else { finalPaid.current = true; setPayout({ at: now, amount: fc.after - fc.before }); coins(fc.after - fc.before); }
    }, 3600 / P);
    return () => { clearTimeout(t1); clearTimeout(t2); s?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalKey]);

  // payouts and busts: sounds and the scene's coin burst and alarm
  // strikes: the lamp flashes with the alarm sting; the second one sets the whole room off
  const seen = useRef({ no: -1, pile: 0, log: 0, busted: false, strikes: 0 });
  useEffect(() => {
    const m = seen.current;
    const snap = { no: gameNo.current, pile: game.pile, log: game.log.length, busted: game.busted, strikes: game.strikes };
    if (m.no !== gameNo.current) { seen.current = snap; return; }
    const now = performance.now();
    if (game.pile > m.pile) {
      // the last safe's doubling already paid out on screen when he was wrong
      if (finalPaid.current) finalPaid.current = false;
      else { const amount = game.pile - m.pile; setPayout({ at: now, amount }); coins(amount); }
    }
    const struck = game.strikes > m.strikes;
    if (struck) { setStrikeAt({ n: game.strikes, at: now }); alarm(); }
    if (game.log.length > m.log) {
      const o = game.log[game.log.length - 1];
      // he saw the dud on you and passed: his lamp flares, no alarm (the alarm is for strikes)
      if (o && o.kind === 'trap' && o.result === 'burned' && !o.strike) setCatchPulse(now);
    }
    if (game.busted && !m.busted) { setBustedAt(now); if (!struck) alarm(); }
    seen.current = snap;
  }, [game.pile, game.log, game.busted, game.strikes]);

  // open every safe still shut, one at a time
  const hidden = useMemo(() => game.boxes.filter((b) => b.state === 'burned' || b.state === 'sealed').map((b) => b.id), [game.boxes]);
  useEffect(() => {
    if (screen !== 'play' || game.phase !== 'reveal' || replayOwed) return;
    if (revealN >= hidden.length) return;
    const id = setTimeout(() => setRevealN((n) => n + 1), (revealN === 0 ? 700 : 380) / P);
    return () => clearTimeout(id);
  }, [screen, game.phase, replayOwed, revealN, hidden.length, P]);

  // job over: tell sheet, history, stash, unlocks, share card (once per job)
  useEffect(() => {
    if (game.phase !== 'over' || endedFor.current === gameNo.current) return;
    endedFor.current = gameNo.current;
    const sheet = tellSheet(game);
    const prev = history;
    const next = updateHistory(prev, sheet, new Date().toISOString());
    saveHistory(next);
    saveHowSeen();
    setHistory(next);
    const sc = game.score;
    const stashBefore = loadStash();
    const stashAfter = sc ? bankRun(stashBefore, jobId, sc) : stashBefore;
    saveStash(stashAfter);
    setStash(stashAfter);
    const trend = hideTrend(prev.games, sheet);
    const tell = sheet.biggest ? tellLine(sheet.biggest.key, sheet.biggest.effect) : 'I could not find your tell this time.';
    setEnd({ sheet, trend, tell, stashBefore, stashAfter, banked: stashAfter.total - stashBefore.total, opened: newlyUnlocked(stashBefore, stashAfter) });
    bus?.clear(); // the session's signal numbers are not kept past the job
    tape.current = null;
    if (sc) {
      void renderShareCard({
        pile: sc.pile, job: job.name, clean: sc.won, busted: sc.busted, bankerCorrect: sc.bankerCorrect, bankerCalls: sc.bankerCalls,
        daily: daily ? today() : null, line: shareTellLine(sheet.biggest?.key ?? null),
      }).then((blob) => setCardUrl(URL.createObjectURL(blob))).catch(() => setCardUrl(null));
    }
  }, [game, history, daily, bus, jobId, job.name]);

  // he names your tell out loud at the end of the job
  useEffect(() => {
    if (!end || screen !== 'play' || game.phase !== 'over') return;
    const s = speak(end.tell, P > 1 ? 2 : 1);
    return () => s.cancel();
  }, [end, screen, game.phase, P]);

  // he opens the next job with what he remembers, once, when the safes first show
  useEffect(() => {
    if (screen !== 'play' || game.phase !== 'board' || openSaid || !memLine || paused) return;
    setOpenSaid(true);
    speak(memLine, P > 1 ? 2 : 1);
  }, [screen, game.phase, openSaid, memLine, paused, P]);

  // the catch replay after every settled safe
  const replay: { verdict: ReplayVerdict; tape: PeekTape | null } | null = useMemo(() => {
    if (!replayOwed || !game.lastOutcome || !game.read) return null;
    const o = game.lastOutcome;
    const t = tape.current && tape.current.logIndex === game.log.length - 1 ? tape.current : null;
    return { verdict: replayVerdict(o.features, game.read, o.kind, game.level, { result: o.result, strike: o.strike, strikes: o.strikes }), tape: t };
  }, [replayOwed, game.lastOutcome, game.read, game.log.length, game.level]);
  const finishReplay = useCallback(() => {
    if (!replayOwed) return;
    stopSpeaking();
    setReplayedN(game.log.length);
    if (game.phase === 'audit') dispatch({ type: 'next' });
  }, [replayOwed, game.log.length, game.phase, dispatch]);
  useEffect(() => {
    if (!replay || paused) return;
    const t0 = performance.now();
    const s = speak(replay.verdict.line, P > 1 ? 2 : 1);
    let on = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void s.done.then(() => {
      if (!on) return;
      const wait = Math.max(700, 3500 / P - (performance.now() - t0));
      timer = setTimeout(() => { if (on) finishReplay(); }, wait);
    });
    return () => { on = false; s.cancel(); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, paused, P]);

  // ---------- actions ----------
  const pick = useCallback((id: number) => {
    if (screen !== 'play' || paused || game.phase !== 'board') return;
    dispatch({ type: 'choose', boxId: id });
  }, [screen, paused, game.phase, dispatch]);

  const takeOrKeep = useCallback((t: 'sell' | 'open') => {
    if (game.phase !== 'bankerRead' || tooSlow) return;
    // his price holds for the whole window; the clock and his eyes are the pressure
    dispatch(t === 'sell' ? { type: 'sell', elapsedMs: 0 } : { type: 'open' });
  }, [game.phase, tooSlow, dispatch]);

  const leave = useCallback(() => {
    if (game.phase === 'audit' || game.phase === 'finalChoice' || (game.phase === 'board' && !game.finalBet)) {
      stopSpeaking(); setReplayedN(game.log.length); dispatch({ type: 'leave' });
    }
  }, [game.phase, game.finalBet, game.log.length, dispatch]);

  const bet = useCallback(() => { if (game.phase === 'finalChoice') dispatch({ type: 'finalBet' }); }, [game.phase, dispatch]);

  // his call is in: on to the end of the job (the call screen was this safe's replay)
  const finishFinal = useCallback(() => {
    if (game.phase !== 'finalCall' || finalStage < 2) return;
    stopSpeaking();
    setReplayedN(game.log.length);
    dispatch({ type: 'next' });
  }, [game.phase, finalStage, game.log.length, dispatch]);

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
  const wipe = useCallback(() => { wipeHistory(); setHistory(loadHistory()); setStash(loadStash()); setSel(0); }, []);
  const playJob = useCallback((j: Job) => { if (isUnlocked(j, stash)) startGame(j.id); }, [stash, startGame]);

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
      if (k === 'q') toJobs();
      return;
    }
    switch (screen) {
      case 'title':
        if (k === 'enter' || k === ' ') fromTitle();
        else if (k === 's') void sampleRun();
        return;
      case 'jobs': {
        const cols = window.innerWidth <= 1100 ? 2 : 4;
        if (k === 'arrowright') setSel((s) => Math.min(JOBS.length - 1, s + 1));
        else if (k === 'arrowleft') setSel((s) => Math.max(0, s - 1));
        else if (k === 'arrowdown') setSel((s) => Math.min(JOBS.length - 1, s + cols));
        else if (k === 'arrowup') setSel((s) => Math.max(0, s - cols));
        else if (k === 'enter' || k === ' ') { const j = JOBS[sel]; if (j) playJob(j); }
        else if (k === 'd') playJob(jobById('daily'));
        else if (k === 'escape' || k === 'backspace') setScreen('title');
        else if (/^[1-7]$/.test(k)) { const j = JOBS[Number(k) - 1]; if (j) playJob(j); }
        return;
      }
      case 'consent':
        if (k === 'enter') afterConsent();
        else if (k === 'escape' || k === 'backspace') setScreen('jobs');
        return;
      case 'key':
        if (k === 's') void choose({ mode: 'simulated' });
        else if (k === 'enter' && (keyDraft.trim() || keyOnFile)) void choose({ mode: 'live', key: keyDraft });
        else if (k === 'escape') setScreen('jobs');
        return;
      case 'play':
        break;
    }
    if (k === 'escape') { e.preventDefault(); if (game.phase !== 'over') pause(); return; }
    if (lost && reading) return;
    if (calmFailed && game.phase === 'baseline' && k === 'enter') { setCalmFailed(false); setCalmTry((n) => n + 1); return; }
    if (game.phase === 'baseline' && k === 'h') { setWantPractice((w) => !w); return; }
    if (game.phase === 'practice' && k === 'k') { skipPractice(); return; }
    if (game.phase === 'practice' && (k === 'enter' || k === ' ')) { e.preventDefault(); practiceNext(); return; }
    if (game.phase === 'board') {
      if (/^[0-9]$/.test(k)) { const idx = k === '0' ? 9 : Number(k) - 1; const b = game.boxes[idx]; if (b && b.state === 'sealed') pick(b.id); return; }
      if (k === 'l') leave();
      return;
    }
    if (game.phase === 'bankerRead') { if (k === 't') takeOrKeep('sell'); if (k === 'k') takeOrKeep('open'); return; }
    if (game.phase === 'finalChoice') { if (k === 'l') leave(); if (k === 'd') bet(); return; }
    if (game.phase === 'finalCall') { if (k === 'enter' || k === ' ') { e.preventDefault(); finishFinal(); } return; }
    if (replayOwed) { if (k === 'enter' || k === ' ') { e.preventDefault(); finishReplay(); } else if (k === 'l' && game.phase === 'audit' && runLeft(game) > 0) leave(); return; }
    if (game.phase === 'reveal' && (k === 'enter' || k === ' ')) { finishReveal(); return; }
    if (game.phase === 'over') {
      if (jobId === 'first' && !firstReport) {
        if (k === 'enter') startGame('heist');
        else if (k === 'r') setFirstReport(true);
        else if (k === 'b') toJobs();
        return;
      }
      if (k === 'enter') startGame(jobId);
      else if (k === 'b') toJobs();
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
  const revealed = new Set(game.phase === 'over' ? hidden : hidden.slice(0, game.phase === 'reveal' ? revealN : 0));
  const sceneBoxes: SceneBox[] = inPractice
    ? game.boxes.map((b): SceneBox => ({ id: b.id, state: 'sealed' }))
    : game.boxes.map((b): SceneBox => {
      const open = (k: BoxKind): SceneBox => ({ id: b.id, kind: k, state: k === 'trap' ? 'opened-trap' : 'opened-treasure' });
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
  const peekContents: SceneBoxKind | null = inPractice ? null : game.phase === 'peek' && activeBox ? activeBox.kind : null;
  const sceneActive: number | null = inPractice
    ? null
    : game.phase === 'peek' || game.phase === 'bankerRead' ? game.activeBoxId
      : (replay || game.phase === 'finalCall') && game.lastOutcome ? game.lastOutcome.boxId : null;
  const fc = game.phase === 'finalCall' ? game.finalCall : null;
  const bankerState: BankerState = screen !== 'play' ? 'idle'
    : fc ? (finalStage === 0 ? 'reading' : finalStage === 1 ? 'speaking' : fc.right ? 'offering' : 'walking')
      : replay ? (replay.verdict.caught ? 'walking' : 'speaking')
        : game.phase === 'peek' || game.phase === 'baseline' || (game.phase === 'practice' && practice.stage === 'peek') ? 'reading'
          : game.phase === 'bankerRead' ? (tooSlow ? 'walking' : 'offering')
            : 'idle';
  const onBoxClick = useCallback((id: number) => pick(id), [pick]);

  // how suspicious he is right now (0..1), for the scene and the heartbeat
  const alertLevel = screen !== 'play' || paused || game.phase === 'over' ? 0
    : fc ? (finalStage < 2 ? 0.6 : fc.right ? 0.95 : 0.1)
    : game.phase === 'peek' ? liveAlert
      : replay ? (replay.verdict.caught ? 0.95 : 0.12)
        : game.phase === 'bankerRead' && game.read ? Math.max(game.read.pTrap, game.read.decision === 'unread' ? 0.5 : 0)
          : game.phase === 'board' ? restingAlert(game.model, bankerView(game))
            : 0.08;
  const bpmRaw = usePoll(() => bus?.pulse() ?? null, [bus], 1000);
  const bpm = bpmRaw === null ? null : Math.round(bpmRaw);
  useHeartbeat({ bpm, level: alertLevel, muted, enabled: screen === 'play' && !paused && game.phase !== 'over' && game.phase !== 'reveal' });

  const menu = screen !== 'play' || game.phase === 'over';
  const sim = source?.kind === 'simulated';
  // the steps strip: crack (and the crack itself), hide it while he reads you, then take his cash or keep it
  const ruleOn: number[] = game.phase === 'board' ? [0]
    : game.phase === 'peek' ? (leadDone ? [1, 2] : [0])
      : game.phase === 'bankerRead' || replay ? [3] : [];
  const statusChip: 'finding' | 'reading' | 'ready' = lost ? 'finding' : reading ? 'reading' : 'ready';
  const dbl = game.finalBet && (game.phase === 'board' || game.phase === 'peek' || game.phase === 'finalCall');
  // what is on screen right now, for tests and screenshots
  const sub = game.phase === 'peek' ? (leadDone ? 'look' : 'lead')
    : game.phase === 'bankerRead' ? (tooSlow ? 'tooslow' : 'offer')
      : game.phase === 'finalCall' ? `call${finalStage}`
        : replay ? 'replay' : game.phase;
  // music: the heist score follows the screen and stings the moments (ui/music.ts)
  const lastLog = game.log[game.log.length - 1];
  useMusic({
    screen, phase: game.phase, stage: sub, practice: practice.stage, paused, pace: P, gameNo: gameNo.current,
    logLen: game.log.length, last: lastLog ? { result: lastLog.result, strike: lastLog.strike, expired: lastLog.expired, final: lastLog.final } : null,
    strikes: game.strikes, busted: game.busted, finalStage, finalRight: fc && fc.call !== 'none' ? fc.right : null,
  });
  const shownPile = fc ? (finalStage >= 2 ? fc.after : fc.before) : undefined;
  const findingHint = (() => {
    if (!lost) return null;
    if (facePause === 'many') return 'Only one face in view, please.';
    if (facePause === 'none') return 'Look at the camera. The job goes on by itself.';
    const v = srcStatus?.validation;
    if (v && v.code !== V_OK && performance.now() - v.at < STALE_MS) return validationWords(v.code, v.hint).big;
    return 'Sit back in the light. The job goes on by itself.';
  })();

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#3a0710' }}>
      <LiveScene
        bus={screen === 'play' && !paused ? bus : null}
        boxes={sceneBoxes}
        activeBoxId={sceneActive}
        peekContents={peekContents}
        practice={inPractice ? scenePractice : undefined}
        bankerState={bankerState}
        heat={screen === 'play' ? game.heat : 0}
        alert={alertLevel}
        catchPulse={job.hints ? catchPulse : undefined}
        payout={payout}
        busted={bustedAt}
        onBoxClick={screen === 'play' && game.phase === 'board' && !paused ? onBoxClick : undefined}
        quality="high"
        lite={live}
      />
      <div className="vui" data-screen={screen} data-phase={game.phase} data-stage={sub} data-strikes={game.strikes} data-job={jobId} data-practice={`${practice.idx}:${practice.stage}`} data-paused={paused ? '1' : '0'}>
        {menu ? <div className="scrim-full" /> : <><div className="scrim-top" /><div className="scrim-bottom" /></>}

        {screen === 'title' && <TitleScreen onGo={() => fromTitle()} onSample={() => void sampleRun()} err={err} />}
        {screen === 'jobs' && (
          <JobsScreen sel={sel} setSel={setSel} stash={stash} sim={sim} onPlay={playJob} onWipe={wipe} canWipe={history.games.length > 0 || stash.total > 0} />
        )}
        {screen === 'consent' && <ConsentScreen onAgree={afterConsent} onBack={() => setScreen('jobs')} />}
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
            <Hud game={game} job={job} daily={daily} />
            <Purse game={game} stash={stash.total} shownPile={shownPile} strikeAt={strikeAt} />
            <BodyPanel bus={paused ? null : bus} stream={paused ? null : srcStatus?.stream ?? null} sim={sim} bpm={bpm} />
            {(game.phase === 'board' || game.phase === 'bankerRead') && <ValuesBoard game={game} />}
            <div className="topright">
              <span className={`chip-status ${statusChip}`}><span className="dot" />{statusChip === 'finding' ? 'Finding you' : statusChip === 'reading' ? 'Reading you' : 'Ready'}</span>
              {sim && <span className="chip-soft sim">Sample run: simulated body</span>}
              {!sim && <span className="chip-soft">Esc turns the camera off</span>}
              <button className="chip-soft" onClick={toggleMute} style={{ border: 0, cursor: 'pointer', font: 'inherit' }}>M sound {muted ? 'off' : 'on'}</button>
            </div>
            {dbl && !(lost && reading) && (
              <div className="dbl-banner"><b>Double or nothing</b><span>Fool him on this safe and {money(fc ? fc.before : game.pile)} becomes {money((fc ? fc.before : game.pile) * 2)}</span></div>
            )}
            {!dbl && job.hints && ruleOn.length > 0 && !(lost && reading) && <div className="rs-top"><RuleStrip on={ruleOn} /></div>}
            <div className="stage">
              {/* rule strip lives at the top now, so it never covers the safe */}
              {lost && reading ? (
                <div className="finding">
                  <div className="calm-line">Finding you…</div>
                  {findingHint && <div className="small shadowed">{findingHint} This look starts over when he sees you.</div>}
                </div>
              ) : (
                <>
                  {game.phase === 'baseline' && (
                    calmFailed ? (
                      <>
                        <div className="prompt">He could not see you clearly.</div>
                        <div className="line">Sit back in good light and face the camera. Then try again.</div>
                        <div className="actions"><Btn primary k="Enter" onClick={() => { setCalmFailed(false); setCalmTry((n) => n + 1); }}>Try again</Btn></div>
                      </>
                    ) : (
                      <CalmStage bus={bus} recRef={recRef} wantPractice={wantPractice} howSeen={loadHowSeen()} onToggle={() => setWantPractice((w) => !w)} />
                    )
                  )}
                  {game.phase === 'practice' && practiceKind && (
                    <PracticeStage idx={practice.idx} total={game.practice.length} kind={practiceKind} stage={practice.stage} peekMs={job.peekMs} open={leadDone}
                      last={practice.peeks[practice.peeks.length - 1]?.features ?? null} recRef={recRef} bus={bus} reusedCalm={reusedCalm} onNext={practiceNext} onSkip={skipPractice} />
                  )}
                  {game.phase === 'board' && (
                    game.finalBet ? (
                      <>
                        <div className="prompt big">Click any safe for the last one</div>
                        <div className="line">He gets one call: full or empty. Look nervous if it is full, stay calm if it is empty.</div>
                      </>
                    ) : (
                      <>
                        <div className="prompt big">Click any safe to crack it</div>
                        <div className="line">{runLeft(game)} safe{runLeft(game) === 1 ? '' : 's'} to go this job.</div>
                        {game.log.length === 0 && memLine && <div className="line" style={{ opacity: 0.85, fontStyle: 'italic' }}>The Fence: &ldquo;{memLine}&rdquo;</div>}
                        {game.log.length > 0 && game.pile > 0 && <div className="actions"><Btn ghost k="L" onClick={leave}>Walk out with {money(game.pile)}</Btn></div>}
                      </>
                    )
                  )}
                  {game.phase === 'peek' && activeBox && !leadDone && <Cracking />}
                  {game.phase === 'peek' && activeBox && leadDone && (
                    <PeekStage kind={activeBox.kind} value={activeBox.value} recRef={recRef} caught={liveCaught && job.hints} peekMs={job.peekMs}
                      alert={job.hints ? liveAlert : null} final={game.finalBet} take={game.pile} />
                  )}
                  {game.phase === 'bankerRead' && game.read && activeBox && (
                    <OfferStage offer={game.read.offer ?? 0} elapsed={offerMs} tooSlow={tooSlow} flinched={flinched} blind={game.read.decision === 'unread'} quote={spoken}
                      kind={activeBox.kind} value={activeBox.value} strikes={game.strikes}
                      onTake={() => takeOrKeep('sell')} onKeep={() => takeOrKeep('open')} />
                  )}
                  {fc && game.lastOutcome && (
                    <FinalCallStage fc={fc} stage={finalStage} kind={game.lastOutcome.kind} value={game.lastOutcome.value} onNext={finishFinal} />
                  )}
                  {replay && game.lastOutcome && (
                    <ReplayStage game={game} verdict={replay.verdict} tape={replay.tape} peekMs={job.peekMs} onNext={finishReplay}
                      onLeave={game.phase === 'audit' && runLeft(game) > 0 ? leave : null} />
                  )}
                  {game.phase === 'reveal' && !replay && (
                    <RevealStage game={game} hidden={hidden} revealN={revealN} onDone={finishReveal} />
                  )}
                </>
              )}
            </div>
            {game.phase === 'finalChoice' && !(lost && reading) && <FinalChoice take={game.pile} onWalk={leave} onBet={bet} />}
          </>
        )}

        {screen === 'play' && game.phase === 'over' && game.score && end && (
          jobId === 'first' && !firstReport
            ? <FirstJobReveal game={game} end={end} onHeist={() => startGame('heist')} onReport={() => setFirstReport(true)} onJobs={toJobs} />
            : <EndScreen game={game} job={job} end={end} cardUrl={cardUrl}
                onAgain={() => startGame(jobId)} onJobs={toJobs} onSave={saveCard} />
        )}

        {screen === 'play' && paused && (
          <div className="pause">
            <div className="eyebrow">Camera off</div>
            <div className="display" style={{ fontSize: 'var(--fs-xl)', marginTop: 14 }}>{pauseWhy ?? 'Job paused.'}</div>
            <div className="body measure" style={{ marginTop: 14 }}>The camera is off and nothing is being read. Any look in progress starts over when you come back.</div>
            {err && <div className="err">{err}</div>}
            <div className="actions">
              <Btn primary k="Enter" onClick={() => void resume()}>Turn the camera back on</Btn>
              <Btn ghost k="Q" onClick={toJobs}>Back to the jobs</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ======================= screens =======================

function TitleScreen({ onGo, onSample, err }: { onGo: () => void; onSample: () => void; err: string | null }): JSX.Element {
  return (
    <div className="center">
      <div className="eyebrow enter">A heist read by your breath</div>
      <div className="title-word">The Vault</div>
      <div className="title-sub enter" style={{ ['--d' as string]: 3 }}>Crack the safes. Fool the Fence.</div>
      <div className="tagline enter" style={{ ['--d' as string]: 5 }}>
        The Fence buys stolen goods, and he wants your safes. Only you see inside each one. He watches your breath, blinks, face and pulse on camera,
        then names a price on a five second clock. Take his cash or keep what is inside, and never let him find two empty safes.
      </div>
      <div className="actions enter" style={{ ['--d' as string]: 8 }}>
        <Btn primary big k="Enter" onClick={onGo}>Start the job</Btn>
        <Btn ghost k="S" onClick={onSample}>Try a sample run (no camera)</Btn>
      </div>
      <div className="sim-note enter" style={{ ['--d' as string]: 9 }}>The sample run plays a simulated body with made up signals, clearly labelled on screen.</div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function JobsScreen({ sel, setSel, stash, sim, onPlay, onWipe, canWipe }: {
  sel: number; setSel: (n: number) => void; stash: Stash; sim: boolean; onPlay: (j: Job) => void; onWipe: () => void; canWipe: boolean;
}): JSX.Element {
  const left = useCountdown();
  const next = nextLocked(stash);
  return (
    <div className="jobs">
      <div className="jobs-head">
        <div>
          <div className="eyebrow enter">Pick a job</div>
          <div className="display enter" style={{ ['--d' as string]: 1 }}>Seven jobs. The Fence reads more of you on each.</div>
          <div className="small enter" style={{ marginTop: 8, ['--d' as string]: 2 }}>The Fence buys stolen goods. He pays for your safes without seeing inside, so he reads you instead.</div>
          <div className="enter" style={{ marginTop: 10, ['--d' as string]: 2 }}><RuleStrip /></div>
        </div>
        <div className="stash-big enter" style={{ ['--d' as string]: 2 }}>
          <div className="eyebrow">Your stash</div>
          <div className="num">{money(stash.total)}</div>
          <div className="small">{next ? `${money(next.price - stash.total)} more opens ${next.name}` : 'Every job is open.'}</div>
        </div>
      </div>
      <div className="jobs-grid">
        {JOBS.map((j, i) => {
          const locked = !isUnlocked(j, stash);
          const best = stash.best[j.id];
          return (
            <button key={j.id} className={`card${sel === i ? ' sel' : ''}${locked ? ' locked' : ''}${j.daily ? ' daily' : ''}`} style={{ ['--d' as string]: 3 + i }}
              onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => onPlay(j)} aria-disabled={locked}>
              <span className="no">{i + 1}</span>
              <span className="name">{locked && <svg className="lock" viewBox="0 0 16 18" aria-label="Locked"><path d="M4 8V5.5a4 4 0 0 1 8 0V8h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zm2 0h4V5.5a2 2 0 0 0-4 0z" /></svg>}{j.name}</span>
              <span className="blurb">{j.blurb}</span>
              <span className="meta">{j.rules.safes} safes · take {money(j.rules.target)} · {j.peekMs / 1000} second look</span>
              <Reads list={readsList(j.level)} />
              {j.daily && <span className="meta">New safes in <span className="countdown">{left}</span></span>}
              {locked ? (
                <span className="price">
                  <span className="t">{money(stash.total)} / {money(j.price)} stash</span>
                  <span className="bar" style={{ display: 'block' }}><i style={{ width: `${Math.round(unlockProgress(j, stash) * 100)}%` }} /></span>
                </span>
              ) : (
                <span className="best"><span>Best take {stash.clean[j.id] ? <span className="clean">· clean</span> : null}</span><b>{best !== undefined ? money(best) : 'none yet'}</b></span>
              )}
            </button>
          );
        })}
      </div>
      <div className="jobs-foot">
        <span>Arrows and Enter, or press 1 to 7. {sim ? 'Sample run: a simulated body plays, no camera.' : ''}</span>
        <span>Your results stay on this computer. {canWipe && <button className="link" onClick={onWipe}>Wipe my history</button>}</span>
      </div>
    </div>
  );
}

function ConsentScreen({ onAgree, onBack }: { onAgree: () => void; onBack: () => void }): JSX.Element {
  const items: [string, JSX.Element][] = [
    ['1', <><b>Your camera reads your breath, blinks, face and pulse</b> while you play. It turns on only after you agree.</>],
    ['2', <><b>Nothing is stored but results.</b> Frames are processed on this computer and never saved. Only your results and tells stay here, and you can wipe them.</>],
    ['3', <><b>These are tells, not health readings.</b> A tell is how your body reacts to what you see. This is a game.</>],
    ['4', <><b>Esc turns the camera off</b> at any moment and pauses the job.</>],
  ];
  return (
    <div className="center">
      <div className="sheet">
        <div className="eyebrow">Before the camera turns on</div>
        <div className="display">The Fence watches you, not your screen.</div>
        <ul className="consent-list">
          {items.map(([n, t]) => <li key={n}><span className="n">{n}</span><span>{t}</span></li>)}
        </ul>
        <div className="actions">
          <Btn primary k="Enter" onClick={onAgree}>I agree, turn it on</Btn>
          <Btn ghost k="Esc" onClick={onBack}>Not now</Btn>
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
      <div className="sheet">
        <div className="eyebrow">Presage key</div>
        <div className="display">{keyOnFile ? 'Your Presage key is ready.' : 'Paste your Presage key.'}</div>
        <div className="body">{keyOnFile
          ? 'A key is set up on this computer. Press Enter to use your camera, or paste a different key.'
          : 'It lets SmartSpectra read your breathing from the webcam. It stays on this computer.'}</div>
        <form style={{ marginTop: 18 }} onSubmit={(e) => { e.preventDefault(); onLive(); }}>
          <input className="field" type="password" spellCheck={false} autoComplete="off" placeholder={keyOnFile ? 'key on this computer' : 'your key'}
            value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Presage API key" />
        </form>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <Btn primary k="Enter" onClick={onLive}>Use my camera</Btn>
          <Btn ghost k="S" onClick={onSim}>Try a sample run (no camera)</Btn>
        </div>
        <div className="small" style={{ marginTop: 14 }}>
          No key? The sample run plays the whole game with a simulated body and made up signals, clearly marked on screen.
          {draft && <> <button className="link" onClick={onForget}>Forget my key</button></>}
        </div>
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
      <div className="prompt big">Breathe normally. He is learning your calm.</div>
      <div className="stage-card">
        <div className="peekrow">
          <Ring progress={p} label={String(left)} />
          <div className="grow"><BreathLine bus={bus} big /></div>
        </div>
        <div className="small" style={{ color: 'rgba(58,7,16,0.7)', marginTop: 4 }}>That line is your breathing. {BASELINE_MS / 1000} seconds, then the safes.</div>
      </div>
      <div className="actions" style={{ marginTop: 4 }}>
        <Btn ghost k="H" onClick={onToggle}>
          {wantPractice ? (howSeen ? 'Practice on: two marked safes first' : 'Skip the two practice safes') : 'How it works: two practice safes first'}
        </Btn>
      </div>
    </>
  );
}

function PracticeStage({ idx, total, kind, stage, last, recRef, bus, reusedCalm, peekMs, open, onNext, onSkip }: {
  idx: number; total: number; kind: BoxKind; stage: PracticeState['stage']; last: PeekFeatures | null; peekMs: number; open: boolean;
  recRef: React.MutableRefObject<{ progress: () => number } | null>; bus: SignalBus | null; reusedCalm: boolean; onNext: () => void; onSkip: () => void;
}): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  const what = kind === 'trap' ? 'an empty safe' : kind === 'big' ? 'gold bars' : 'cash';
  if (stage === 'intro') {
    return (
      <>
        <div className="eyebrow">Practice {idx + 1} of {total}</div>
        <div className="prompt big">He knows this safe holds {what}.</div>
        <div className="line">
          {idx === 0 && reusedCalm ? 'He remembers your calm from last time. ' : ''}
          Look inside and he watches how your breath reacts to a safe he already knows.
        </div>
        <div className="actions">
          <Btn primary k="Space" onClick={onNext}>Crack it</Btn>
          <Btn ghost k="K" onClick={onSkip}>Skip to the real safes</Btn>
        </div>
      </>
    );
  }
  if (stage === 'peek' && !open) return <Cracking />;
  if (stage === 'peek') {
    return (
      <>
        <div className={`contents ${kind}`}>{kindName(kind)}</div>
        <div className="stage-card">
          <div className="peekrow">
            <Ring progress={p} label={String(Math.max(0, Math.ceil((peekMs / 1000) * (1 - p))))} />
            <div className="grow"><BreathLine bus={bus} big /></div>
          </div>
        </div>
        <div className="line">Only you can see inside. Keep breathing. He is watching.</div>
      </>
    );
  }
  let note = 'Your breath stayed even.';
  if (last) {
    if (last.quality < MIN_QUALITY) note = 'He could not read that one. Sit back in the light.';
    else if (last.breathCatchMs > 0) note = `Your breath stopped for ${secs(last.breathCatchMs)} seconds.`;
    else if (last.shallowing > 0.2) note = `Your breathing went ${sayTell('shallow', last.shallowing * 100)}.`;
    else if (Math.abs(last.rateChange) > 0.2) note = `Your breathing ${last.rateChange > 0 ? 'sped up' : 'slowed'}.`;
  }
  return (
    <>
      <div className="eyebrow">Noted</div>
      <div className="prompt big">{note}</div>
      <div className="line">{idx + 1 < total ? 'He wrote that down. One more.' : 'He has seen you at an empty safe and a full one. Now the real safes.'}</div>
      <div className="actions"><Btn primary k="Space" onClick={onNext}>{idx + 1 < total ? 'Next practice safe' : 'To the safes'}</Btn></div>
    </>
  );
}

/** The crack: dial and door only. What is inside stays hidden until the door is open. */
function Cracking(): JSX.Element {
  return (
    <div className="cracking" role="status">
      <svg className="dialicon" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" /><line x1="50" y1="50" x2="50" y2="18" /></svg>
      <span className="word">Cracking…</span>
    </div>
  );
}

function PeekStage({ kind, value, recRef, caught, peekMs, alert, final, take }: {
  kind: BoxKind; value: number; recRef: React.MutableRefObject<{ progress: () => number } | null>; caught: boolean; peekMs: number;
  /** his live suspicion 0..1, or null when the job gives no hints */
  alert: number | null;
  /** the last safe, double or nothing: he calls it instead of making an offer */
  final: boolean; take: number;
}): JSX.Element {
  const p = usePoll(() => recRef.current?.progress() ?? 0, [], 100);
  const secs = Math.max(0, Math.ceil((peekMs / 1000) * (1 - p)));
  const dud = kind === 'trap';
  const a = alert === null ? null : Math.max(0, Math.min(1, caught ? Math.max(alert, 0.85) : alert));
  const word = a === null ? '' : a > 0.66 ? 'He is onto you' : a > 0.33 ? 'He is getting suspicious' : 'He suspects nothing';
  return (
    <div className="peek-card">
      <div className="peek-head">
        <div>
          <div className="eyebrow">You found</div>
          <div className={`contents ${kind}`}>{kindName(kind, value)}</div>
        </div>
        <div className="peek-timer" title={final ? 'He calls it when this runs out' : 'His offer comes when this runs out'}><Ring progress={p} label={String(secs)} /></div>
      </div>
      <div className="peek-goal">
        {final
          ? (dud ? <>Breathe slow and even. Make him think it is full.</> : <>Hold your breath a moment. Make him think it is empty.</>)
          : dud
            ? <>Hide it. Breathe like it is full, so he pays you for this empty safe.</>
            : <>Hide it. Stay calm, so he cannot tell what you found.</>}
      </div>
      {a !== null && (
        <div className={`susp${a > 0.66 ? ' hot' : ''}`}>
          <div className="susp-lab"><span>His suspicion</span><b>{caught ? 'He saw that.' : word}</b></div>
          <div className="susp-bar"><i style={{ width: `${Math.round(8 + a * 92)}%` }} /></div>
        </div>
      )}
      <div className="peek-next">
        {final
          ? <>In {secs}s he calls it: <b>full</b> or <b>empty</b>. If he is wrong, your {money(take)} doubles.</>
          : <>In {secs}s he names his price. You get five seconds to <b>take his cash</b> or <b>keep what is inside</b>.</>}
      </div>
    </div>
  );
}

/** His offer: the big cash card is the button, and the price falls while the ring drains. */
function OfferStage({ offer, elapsed, tooSlow, flinched, blind, quote, kind, value, strikes, onTake, onKeep }: {
  offer: number; elapsed: number; tooSlow: boolean; flinched: boolean; blind: boolean; quote: string; kind: BoxKind; value: number; strikes: number;
  onTake: () => void; onKeep: () => void;
}): JSX.Element {
  const left = Math.max(0, OFFER_WINDOW_MS - elapsed);
  const late = left <= 2000;
  const dud = kind === 'trap';
  const next = strikes + 1;
  return (
    <div className="offer3">
      {quote && <div className="quote"><span className="who">The Fence</span>&ldquo;{quote}&rdquo;</div>}
      {tooSlow ? (
        <div className="tooslow">{flinched ? 'You flinched. Deal is off.' : 'Too slow. Deal is off.'}</div>
      ) : (
        <>
          <div className={`deal-timer${late ? ' late' : ''}`}><i style={{ width: `${(left / OFFER_WINDOW_MS) * 100}%` }} /></div>
          <div className="choices">
            <button className="choice take" onClick={onTake}>
              <span className="lab">{blind ? 'Take his blind offer' : 'Take his cash'}</span>
              <span className="amt num">{money(offer)}</span>
              <span className="key">T</span>
            </button>
            <button className="choice keep" onClick={onKeep}>
              <span className="lab">Keep the safe</span>
              <span className="amt num">{dud ? 'Empty' : money(value)}</span>
              <span className="key">K</span>
            </button>
          </div>
          <div className="watch">{dud ? `He is still watching. Sell him this empty safe and it is strike ${next} of ${MAX_STRIKES}.` : 'He is still watching. Flinch and the deal is off.'}</div>
        </>
      )}
    </div>
  );
}

/** One safe left: bank the take, or bet it all on fooling him once more. */
function FinalChoice({ take, onWalk, onBet }: { take: number; onWalk: () => void; onBet: () => void }): JSX.Element {
  return (
    <div className="final">
      <div className="eyebrow enter">Last safe</div>
      <div className="take-big num">{money(take)}</div>
      <div className="rules enter" style={{ ['--d' as string]: 2 }}>Fool him once more and it doubles to <b>{money(take * 2)}</b>. Get read and you lose it all.</div>
      <div className="final-choice enter" style={{ ['--d' as string]: 3 }}>
        <Btn big k="L" onClick={onWalk}>Walk out</Btn>
        <button className="btn bet big" onClick={onBet}><span className="lbl">Double or nothing</span><span className="key">D</span></button>
      </div>
    </div>
  );
}

/** His call on the last safe: he thinks, he calls it, then the truth and what it did to your take. */
function FinalCallStage({ fc, stage, kind, value, onNext }: { fc: FinalCall; stage: number; kind: BoxKind; value: number; onNext: () => void }): JSX.Element {
  const truth = kind === 'trap' ? 'It was empty.' : kind === 'big' ? `It was full: gold bars worth ${money(value)}.` : `It was full: cash worth ${money(value)}.`;
  const word = fc.call === 'dud' ? 'Empty' : fc.call === 'loot' ? 'Full' : 'No read';
  return (
    <div className="call">
      {stage === 0 && <div className="thinking">He calls it…</div>}
      {stage >= 1 && <div className="says">{fc.call === 'none' ? 'He could not see you' : 'He says it is'}</div>}
      {stage >= 1 && <div className={`word ${fc.call}`}>{word}</div>}
      {stage >= 1 && fc.why && <div className="why"><b>What he saw:</b> {fc.why}</div>}
      {stage === 1 && fc.line && <Subtitle text={fc.line} />}
      {stage >= 2 && <div className="truth">{truth}</div>}
      {stage >= 2 && (
        <div className={`result ${fc.call === 'none' ? 'even' : fc.right ? 'lost' : 'won'}`}>
          {fc.call === 'none' ? `No bet. You keep ${money(fc.before)}.` : fc.right ? 'He read you. You lose everything.' : `He was wrong. Your take doubles: ${money(fc.after)}`}
        </div>
      )}
      {stage >= 2 && <div className="actions"><Btn primary k="Enter" onClick={onNext}>See how the job ended</Btn></div>}
    </div>
  );
}

/** The strike, in one line. */
function strikeText(o: BoxOutcome): string {
  const how = o.result === 'burned' ? 'He caught you at an empty safe.' : 'He found the empty safe you sold him.';
  return o.strikes >= MAX_STRIKES ? `${how} Strike ${o.strikes}: the alarm goes off and you lose your take.` : `${how} Strike ${o.strikes}.`;
}

/** What the safe did to your take, in one line, with a stamp. */
function outcomeCopy(game: GameState): { stamp: JSX.Element; line: string } {
  const o = game.lastOutcome!;
  const trap = o.kind === 'trap';
  const paid = o.paid ?? o.offer ?? 0;
  if (o.result === 'burned') {
    return trap
      ? { stamp: <span className="stamp">Caught</span>, line: 'He saw the empty safe on you and passed. No cash.' }
      : { stamp: <span className="stamp copper">He passed</span>, line: `He passed on it. The safe locked shut with ${money(o.value)} inside.` };
  }
  if (o.expired) {
    return { stamp: <span className="stamp copper">No deal</span>, line: trap ? 'No deal. You kept the empty safe: nothing added.' : `No deal. You kept what was inside: ${money(o.value)} added.` };
  }
  if (o.result === 'sold' && trap) {
    if (game.busted) return { stamp: <span className="stamp">Busted</span>, line: `You sold him an empty safe for ${money(paid)}, and he found it.` };
    const heist = o.decision === 'offer';
    const total = paid + (heist ? heistPay(paid, game.rules) : 0);
    return { stamp: <span className="stamp good">Sold him an empty</span>, line: heist ? `He paid ${money(total)} in all for it.` : `He paid ${money(paid)} blind for it.` };
  }
  if (o.result === 'sold') return { stamp: <span className="stamp copper">Sold</span>, line: `You took his ${money(paid)}. It held ${money(o.value)}.` };
  if (trap) return { stamp: <span className="stamp">Empty</span>, line: 'You kept an empty safe. Nothing added.' };
  return { stamp: <span className="stamp good">Kept</span>, line: `${money(o.value)} added to your take.` };
}

function ReplayStage({ game, verdict, tape, peekMs, onNext, onLeave }: {
  game: GameState; verdict: ReplayVerdict; tape: { frames: SignalFrame[]; baseline: Baseline } | null; peekMs: number; onNext: () => void; onLeave: (() => void) | null;
}): JSX.Element {
  const { stamp, line } = outcomeCopy(game);
  const left = runLeft(game);
  const o = game.lastOutcome!;
  return (
    <div className="replay" key={game.log.length}>
      <div className="replay-head">
        {stamp}
        <span className="replay-out">{line}</span>
        {o.strike && <span className="strike-line"><span className="lamp on" />{strikeText(o)}</span>}
      </div>
      <div className="stage-card">
        <div className="lab">{verdict.caught ? 'Where he caught you' : 'What he saw'}</div>
        {tape ? <ReplayTrace frames={tape.frames} baseline={tape.baseline} marks={verdict.marks} peekMs={peekMs} /> : <div className="small" style={{ color: 'rgba(58,7,16,0.7)' }}>No trace for this safe.</div>}
        <div className="replay-chips">
          {verdict.marks.length === 0 ? <span className="chip calm">Nothing moved</span> : verdict.marks.map((m, i) => <span key={i} className={`chip ${m.kind}`}>{m.label}</span>)}
        </div>
      </div>
      <Subtitle text={verdict.line} />
      <div className="actions" style={{ marginTop: 2 }}>
        <Btn primary k="Enter" onClick={onNext}>{game.phase === 'reveal' ? 'Go on' : left === 1 && game.pile > 0 && !game.finalBet ? 'The last safe' : left > 0 ? `Next safe · ${left} to go` : 'Open the rest'}</Btn>
        {onLeave && game.pile > 0 && <Btn ghost k="L" onClick={onLeave}>Walk out with {money(game.pile)}</Btn>}
      </div>
    </div>
  );
}

function RevealStage({ game, hidden, revealN, onDone }: { game: GameState; hidden: number[]; revealN: number; onDone: () => void }): JSX.Element {
  const shown = hidden.slice(0, revealN);
  const done = revealN >= hidden.length;
  const fc = game.finalCall;
  const head = game.busted ? 'Two strikes. The alarm went off: you leave with nothing.'
    : fc ? (fc.right ? 'He read you on the last safe. You leave with nothing.' : `He guessed wrong. You walk out with ${money(game.pile)}.`)
      : game.left ? `You walked out with ${money(game.pile)}.` : `Job done. Your take: ${money(game.pile)}.`;
  const burned = shown.map((id) => game.boxes.find((x) => x.id === id)!).filter((b) => b.state === 'burned');
  return (
    <>
      {game.busted ? <span className="stamp">Busted</span>
        : fc ? (fc.right ? <span className="stamp">Read you</span> : <span className="stamp good">Doubled</span>)
          : <span className="stamp good">{game.left ? 'Walked out' : 'Job done'}</span>}
      <div className="prompt big">{head}</div>
      <div className="line" style={{ minHeight: '2.8em' }}>
        {shown.length === 0 ? 'Now every safe you did not keep swings open.' : burned.length === 0 ? 'The safes you did not crack are open.' : burned.map((b) => (
          <div key={b.id}>Safe {b.id + 1} held {b.kind === 'trap' ? 'nothing' : b.kind === 'big' ? `gold bars worth ${money(b.value)}` : `cash worth ${money(b.value)}`}. {b.kind === 'trap' ? 'He passed on an empty safe. Good call for him.' : 'He passed on a full safe. Bad call for him.'}</div>
        ))}
      </div>
      {done && <div className="actions"><Btn primary k="Enter" onClick={onDone}>See your tell</Btn></div>}
    </>
  );
}

function verdictFor(game: GameState): { cls: string; text: string; why: string } {
  const sc = game.score!;
  if (sc.busted) return { cls: 'busted', text: 'Busted', why: 'Two strikes. The alarm went off and you lost your take.' };
  if (sc.finalCall?.right) return { cls: 'busted', text: 'He read you', why: 'You bet your take on the last safe and he called it right. You lost it all.' };
  if (sc.won) return { cls: 'clean', text: 'Clean job', why: sc.finalCall ? `He guessed wrong on the last safe and your take doubled. Clean.` : `You took at least ${money(sc.target)} before the alarm.` };
  const misses: string[] = [];
  if (sc.pile < sc.target) misses.push(`${money(sc.target - sc.pile)} short of the ${money(sc.target)} target`);
  return { cls: 'short', text: 'Not clean', why: `${misses.join(', and ')}.`.replace(/^./, (c) => c.toUpperCase()) };
}

function StashNews({ end }: { end: EndInfo }): JSX.Element {
  const next = nextLocked(end.stashAfter);
  if (end.opened.length) {
    return <div className="unlock new enter" style={{ ['--d' as string]: 5 }}>Unlocked: {end.opened.map((j) => j.name).join(' and ')}. {end.opened[0]!.blurb}</div>;
  }
  if (!next) return <div className="unlock enter" style={{ ['--d' as string]: 5 }}>Every job is open. Now hide your tell.</div>;
  return (
    <div className="unlock enter" style={{ ['--d' as string]: 5 }}>
      {money(end.stashAfter.total)} / {money(next.price)} stash to open {next.name}
      <div className="bar"><i style={{ width: `${Math.round(unlockProgress(next, end.stashAfter) * 100)}%` }} /></div>
    </div>
  );
}

function FirstJobReveal({ game, end, onHeist, onReport, onJobs }: { game: GameState; end: EndInfo; onHeist: () => void; onReport: () => void; onJobs: () => void }): JSX.Element {
  const v = verdictFor(game);
  const tell = end.sheet.biggest ? `Your tell: ${end.tell.charAt(0).toLowerCase()}${end.tell.slice(1)}` : 'He could not find your tell. Yet.';
  return (
    <div className="reveal-tell">
      <div className="eyebrow enter">First Job · {v.text} · take {money(game.pile)}</div>
      <div className="tell">{tell}</div>
      {end.sheet.biggest && <div className="body measure enter" style={{ ['--d' as string]: 8 }}>{end.sheet.biggest.sentence}</div>}
      <div className="body enter" style={{ ['--d' as string]: 9 }}>He will watch for it. Hide it and take him for more.</div>
      <div className="actions enter" style={{ ['--d' as string]: 10 }}>
        <Btn primary big k="Enter" onClick={onHeist}>Now beat him: The Heist</Btn>
        <Btn ghost k="R" onClick={onReport}>Full report</Btn>
        <Btn ghost k="B" onClick={onJobs}>All jobs</Btn>
      </div>
    </div>
  );
}

function EndScreen({ game, job, end, cardUrl, onAgain, onJobs, onSave }: {
  game: GameState; job: Job; end: EndInfo; cardUrl: string | null; onAgain: () => void; onJobs: () => void; onSave: () => void;
}): JSX.Element {
  const sc = game.score!;
  const v = verdictFor(game);
  const { sheet, trend } = end;
  const caught = caughtCount(game);
  return (
    <div className="end">
      <div className="left">
        <div className="eyebrow enter">{job.name}{job.daily ? ` · ${today()}` : ''}</div>
        <div className={`verdict ${v.cls} enter`} style={{ ['--d' as string]: 1 }}>{v.text}</div>
        <div className="body enter" style={{ ['--d' as string]: 1 }}>{v.why}</div>
        <div className="take-big num">{money(sc.pile)}</div>
        <div className="stash-add enter" style={{ ['--d' as string]: 2 }}>
          <span>{end.banked > 0 ? <>Added <b>{money(end.banked)}</b> to your stash.</> : 'Nothing added to your stash.'}</span>
          <span>Stash <b>{money(end.stashAfter.total)}</b></span>
        </div>
        <div className="small enter" style={{ ['--d' as string]: 3 }}>
          {sheet.readLine} {sc.trapsSold > 0 && `You sold him ${sc.trapsSold} empty safe${sc.trapsSold > 1 ? 's' : ''}.`} {caught > 0 && `He caught you at ${caught}.`}
        </div>
        <div className="tell-card enter" style={{ ['--d' as string]: 4 }}>
          <div className="lab">Your tell</div>
          <div className="tell">{end.tell}</div>
          {sheet.biggest && <div className="why">{sheet.biggest.sentence}</div>}
          <div className="trend">{trend.line}</div>
        </div>
        <StashNews end={end} />
        <div className="actions enter" style={{ justifyContent: 'flex-start', ['--d' as string]: 6 }}>
          <Btn primary k="Enter" onClick={onAgain}>Run it again</Btn>
          <Btn ghost k="B" onClick={onJobs}>The jobs</Btn>
        </div>
      </div>
      <div className="right">
        {cardUrl ? <img className="card-preview" src={cardUrl} alt="Your share card" /> : <div className="small">Drawing your card</div>}
        {cardUrl && <Btn ghost k="C" onClick={onSave}>Save the card</Btn>}
      </div>
    </div>
  );
}
