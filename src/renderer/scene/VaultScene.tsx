// The Vault, heist cut: a red velvet wall of safe deposit doors, the active safe turning like a prize in the
// middle of the screen, and The Fence watching from his lit booth window. The scene renders props only.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import type { SceneBox, SceneBoxKind, SceneBoxState, VaultSceneProps } from './types';
import { useHeistMaterials } from './heistMaterials';
import { Wall } from './Wall';
import { Fence } from './Fence';
import { Safe, type SafeLook } from './Safe';
import { Payout } from './Payout';
import { Effects } from './Effects';
import { CAMERA_POS, CAMERA_TARGET, PRACTICE, SAFE, GRID, slotPos, practicePos } from './layout';
import { sceneFx, flareEnvelope, pushEnvelope, alarmEnvelope, shakeEnvelope } from './fx';
import { PAL } from './heistTextures';

export type { VaultSceneProps, SceneBox, SceneBoxState, ScenePracticeBox } from './types';

/** Eases alert, turns catch and bust stamps into envelopes, drives the shared lights. Runs first each frame. */
function Driver({ alert, catchPulse, busted, beat, heat, lite }: {
  alert: React.MutableRefObject<number>; catchPulse: React.MutableRefObject<number | undefined>; busted: React.MutableRefObject<number | undefined>;
  beat: React.MutableRefObject<number>; heat: React.MutableRefObject<number>; lite: boolean;
}) {
  const heroLight = useRef<THREE.PointLight>(null);
  const wash = useRef<THREE.PointLight>(null);
  const scene = useThree((st) => st.scene);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const fps = useRef({ n: 0, t: 0 });
  const SKY = useMemo(() => new THREE.Color('#fff0dc'), []);
  const RED = useMemo(() => new THREE.Color(PAL.alarm), []);
  const KEY = useMemo(() => new THREE.Color('#ffe8cc'), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const want = Math.max(0, Math.min(1, alert.current || 0));
    const rate = want > sceneFx.alert ? 2.4 : 1.1; // he notices quickly, forgives slowly
    sceneFx.alert += (want - sceneFx.alert) * (1 - Math.exp(-dt * rate));
    if (typeof catchPulse.current === 'number' && catchPulse.current > sceneFx.catchAt) sceneFx.catchAt = catchPulse.current;
    if (typeof busted.current === 'number' && busted.current > sceneFx.bustAt) sceneFx.bustAt = busted.current;
    const now = performance.now();
    sceneFx.flare = flareEnvelope(now - sceneFx.catchAt);
    sceneFx.push = pushEnvelope(now - sceneFx.catchAt);
    sceneFx.alarm = alarmEnvelope(now - sceneFx.bustAt);
    sceneFx.shake = shakeEnvelope(now - sceneFx.bustAt);
    sceneFx.beat = beat.current;
    // the hero light carries last frame's open-door glow from the safes, then resets for this frame
    sceneFx.heroLight = sceneFx.heroAccLight; sceneFx.heroAccLight = 0;
    sceneFx.heroWeight = sceneFx.heroAccWeight; sceneFx.heroAccWeight = 0;
    if (heroLight.current) {
      heroLight.current.position.copy(sceneFx.heroLightPos);
      heroLight.current.color.copy(sceneFx.heroLightColor);
      heroLight.current.intensity = sceneFx.heroLight * 3;
    }
    // a bust floods the room red; suspicion warms it a little
    const al = sceneFx.alarm, pulse = al * (0.6 + 0.4 * Math.sin(now / 1000 * 18));
    if (hemi.current) { hemi.current.color.copy(SKY).lerp(RED, Math.min(1, pulse * 0.8 + heat.current * 0.08)); hemi.current.intensity = (lite ? 1.1 : 1.15) * (1 - al * 0.35); }
    if (wash.current) wash.current.intensity = pulse * 30;
    scene.environmentIntensity = 0.55 * (1 - al * 0.75);
    if (key.current) { key.current.intensity = (lite ? 2.2 : 2.3) * (1 - al * 0.3); key.current.color.copy(KEY).lerp(RED, pulse * 0.85); }
    fps.current.n++; fps.current.t += dt;
    if (fps.current.t >= 0.5) { sceneFx.fps = fps.current.n / fps.current.t; fps.current.n = 0; fps.current.t = 0; }
  }, -2);
  return (
    <>
      <hemisphereLight ref={hemi} args={['#fff0dc', PAL.velvet, 1.15]} />
      <directionalLight ref={key} position={[-3.5, 7, 8]} intensity={2.3} color="#ffe8cc" castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={4.5} shadow-camera-bottom={-1} shadow-camera-near={1} shadow-camera-far={20} />
      {/* soft warm fill from the right so the wall never goes muddy */}
      <directionalLight position={[5, 3, 6]} intensity={0.6} color="#ffd2b0" />
      {/* alarm wash: dark until a bust, then a pulsing red flood from over your shoulder */}
      <pointLight ref={wash} position={[0.5, 3, 4.5]} intensity={0} distance={14} decay={1.2} color={PAL.alarm} />
      <pointLight ref={heroLight} intensity={0} distance={3.2} decay={1.6} color="#ffb54a" />
    </>
  );
}

function CameraRig() {
  const { camera, size } = useThree();
  const look = useRef(CAMERA_TARGET.clone());
  const tmp = useRef(new THREE.Vector3());
  useFrame((st, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const t = st.clock.elapsedTime;
    const cam = camera as THREE.PerspectiveCamera;
    // keep the whole wall and the booth in frame on narrow windows: about 62 degrees across
    const aspect = size.width / Math.max(1, size.height);
    const needV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(31)) / aspect));
    const fov = Math.max(36, Math.min(70, needV));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const hw = sceneFx.heroWeight;
    const want = tmp.current.copy(CAMERA_TARGET).lerp(sceneFx.heroPos, 0.12 * hw);
    look.current.lerp(want, 1 - Math.exp(-dt * 2));
    const sh = sceneFx.shake;
    cam.position.set(
      CAMERA_POS.x + Math.sin(t * 0.37) * 0.02 + (Math.random() - 0.5) * sh * 0.12,
      CAMERA_POS.y + Math.sin(t * 0.53) * 0.012 + (Math.random() - 0.5) * sh * 0.1,
      CAMERA_POS.z - hw * 0.25,
    );
    // a breath catch pulls you a little toward the wall
    const push = sceneFx.push * 0.35 + sceneFx.alert * 0.1;
    if (push > 0.0001) cam.position.addScaledVector(tmp.current.copy(look.current).sub(cam.position).normalize(), push);
    cam.lookAt(look.current);
  });
  return null;
}

/** Map a practice entry to a wall-style state. */
function practiceState(p: { kind: SceneBoxKind; state: 'sealed' | 'peeking' | 'opened' }): SceneBoxState {
  return p.state === 'peeking' ? 'peeking' : p.state === 'opened' ? (p.kind === 'trap' ? 'opened-trap' : 'opened-treasure') : 'sealed';
}

const ROMAN = ['I', 'II', 'III', 'IV'];

function SceneContents(props: VaultSceneProps) {
  const mats = useHeistMaterials();
  const lite = !!props.lite;
  const breath = useRef(props.breath); breath.current = props.breath;
  const beat = useRef(props.heartbeat); beat.current = props.heartbeat;
  const heat = useRef(props.heat); heat.current = props.heat;
  const alert = useRef(props.alert ?? 0); alert.current = props.alert ?? 0;
  const catchPulse = useRef(props.catchPulse); catchPulse.current = props.catchPulse;
  const busted = useRef(props.busted); busted.current = props.busted;
  const { gl, scene } = useThree();

  useEffect(() => { if (import.meta.env.DEV) Object.assign(window, { __vaultGL: gl, __vaultScene: scene }); }, [gl, scene]);
  // The renderer always tone maps with ACES: three skips it while the post stack renders into its own target (the
  // stack tone maps instead), and applies it when lite mode draws straight to the screen. Nothing is toggled on the
  // renderer, so switching to lite never forces every shader to rebuild. Lite refreshes shadows at about 2 fps.
  const shadowTick = useRef(0);
  useFrame(() => {
    if (!lite) { gl.shadowMap.autoUpdate = true; return; }
    gl.shadowMap.autoUpdate = false;
    if (shadowTick.current++ % 10 === 0) gl.shadowMap.needsUpdate = true;
  });

  const practice = props.practice ?? [];
  const practicePeeking = practice.some((p) => p.state === 'peeking');
  const boxes = props.boxes.slice(0, GRID.cols * GRID.rows);
  const homes = useMemo(() => Array.from({ length: GRID.cols * GRID.rows }, (_, i) => slotPos(i)), []);
  const pHomes = useMemo(() => practice.map((_, i) => practicePos(i, practice.length)), [practice.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Environment resolution={64} frames={1}>
        <color attach="background" args={['#3a1410']} />
        <Lightformer form="rect" intensity={3} color="#fff0dc" scale={[12, 4, 1]} position={[0, 6, 4]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.6} color="#ffd9a8" scale={[6, 4, 1]} position={[-6, 2, 3]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.2} color={PAL.crimson} scale={[8, 4, 1]} position={[6, 1, 0]} rotation-y={-Math.PI / 2} />
        <Lightformer form="ring" intensity={2.5} color="#ffb070" scale={2} position={[2, 3, 6]} />
      </Environment>
      <Driver alert={alert} catchPulse={catchPulse} busted={busted} beat={beat} heat={heat} lite={lite} />
      <CameraRig />
      <Wall mats={mats} breath={breath} beat={beat} />
      <Fence state={props.bankerState} mats={mats} heat={heat} lite={lite} />
      {boxes.map((b, i) => {
        const hero = props.activeBoxId === b.id && !practicePeeking;
        const look: SafeLook = { state: b.state, kind: b.kind, peekContents: props.activeBoxId === b.id ? props.peekContents : null, hero };
        return <Safe key={b.id} id={b.id} label={String(i + 1)} home={homes[i]} look={look} mats={mats} onClick={props.onBoxClick} />;
      })}
      {practice.length > 0 && (
        <group>
          <mesh position={[GRID.x0, PRACTICE.y / 2 - SAFE.h * PRACTICE.scale / 4, PRACTICE.z - 0.05]} material={mats.crimsonDeep} castShadow receiveShadow>
            <boxGeometry args={[practice.length * PRACTICE.gap + 0.2, PRACTICE.y - SAFE.h * PRACTICE.scale / 2, 0.6]} />
          </mesh>
          {practice.slice(0, 4).map((p, i) => {
            const st = practiceState(p);
            const look: SafeLook = { state: st, kind: p.kind, peekContents: p.state === 'peeking' ? p.kind : null, hero: p.state === 'peeking' };
            return <Safe key={'p' + i} id={1000 + i} label={ROMAN[i] ?? String(i + 1)} home={pHomes[i]} homeScale={PRACTICE.scale} look={look} mats={mats} practiceTag={p.kind} />;
          })}
        </group>
      )}
      <Payout payout={props.payout} />
      {!lite && <Effects quality={props.quality} />}
    </>
  );
}

/** In lite mode the canvas only draws on demand; this asks for a frame at a fixed low rate. */
function LiteTicker({ fps }: { fps: number }): null {
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => { const id = setInterval(() => invalidate(), 1000 / fps); return () => clearInterval(id); }, [invalidate, fps]);
  return null;
}

export function VaultScene(props: VaultSceneProps): JSX.Element {
  const high = props.quality === 'high';
  // adaptive resolution: drop render scale when the GPU is busy, recover when it frees up
  const base = high ? 0.9 : 0.7;
  const [dpr, setDpr] = useState(base);
  useEffect(() => setDpr(base), [base]);
  const lite = !!props.lite;
  return (
    <Canvas
      frameloop={lite ? 'demand' : 'always'}
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={lite ? 0.5 : dpr}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0, stencil: false }}
      camera={{ fov: 38, near: 0.1, far: 40, position: CAMERA_POS.toArray() }}
      style={{ position: 'absolute', inset: 0, background: '#2a070d' }}
    >
      <color attach="background" args={['#2a070d']} />
      {lite && <LiteTicker fps={20} />}
      {!lite && <PerformanceMonitor bounds={() => [50, 59]} flipflops={6} onDecline={() => setDpr((d) => Math.max(high ? 0.65 : 0.5, +(d - 0.1).toFixed(2)))} onIncline={() => setDpr((d) => Math.min(base, +(d + 0.1).toFixed(2)))} />}
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}

export default VaultScene;
