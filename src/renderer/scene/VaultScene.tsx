// The Vault: a 1950s Swiss bank vault after hours, rendered from the seated player's eyes.
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, PerformanceMonitor } from '@react-three/drei';
import type { VaultSceneProps } from './types';
import { useVaultMaterials, applyEnvStrength } from './materials';
import { Room } from './Room';
import { Table, TellerScreen, BankerLamp } from './Table';
import { Box } from './Box';
import { PracticeTray } from './Practice';
import { Banker } from './Banker';
import { Gauge, StripRecorder } from './Polygraph';
import { Effects } from './Effects';
import { CAMERA_POS, CAMERA_TARGET } from './layout';
import { sceneFx, flareEnvelope, pushEnvelope } from './fx';
import { AimedSpot } from './AimedSpot';

export type { VaultSceneProps, SceneBox, SceneBoxState, ScenePracticeBox } from './types';

/** Eases the banker's alert and turns the latest breath catch into the shared flare and push envelopes. Runs first each frame. */
function ReactionDriver({ alert, catchPulse }: { alert: React.MutableRefObject<number>; catchPulse: React.MutableRefObject<number | undefined> }) {
  useFrame((_, dt) => {
    const want = Math.max(0, Math.min(1, alert.current || 0));
    // rises a little faster than it settles: he notices quickly, forgives slowly
    const rate = want > sceneFx.alert ? 2.4 : 1.1;
    sceneFx.alert += (want - sceneFx.alert) * (1 - Math.exp(-Math.min(dt, 0.1) * rate));
    if (typeof catchPulse.current === 'number' && catchPulse.current > sceneFx.catchAt) sceneFx.catchAt = catchPulse.current;
    const ms = performance.now() - sceneFx.catchAt;
    sceneFx.flare = flareEnvelope(ms);
    sceneFx.push = pushEnvelope(ms);
  }, -1);
  return null;
}

function CameraRig() {
  const { camera, size } = useThree();
  const look = useRef(CAMERA_TARGET.clone());
  const tmp = useRef(new THREE.Vector3());
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime;
    const cam = camera as THREE.PerspectiveCamera;
    // keep all ten boxes in frame on narrow windows: guarantee ~68 deg horizontal
    const aspect = size.width / Math.max(1, size.height);
    const needV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(34)) / aspect));
    const fov = Math.max(52, Math.min(75, needV));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // seated breathing drift + lean toward the box being peeked
    const w = sceneFx.focusWeight;
    const lean = tmp.current.copy(sceneFx.focus).sub(CAMERA_POS).multiplyScalar(0.07 * w);
    cam.position.set(
      CAMERA_POS.x + Math.sin(t * 0.37) * 0.004 + Math.sin(t * 0.11) * 0.003 + lean.x,
      CAMERA_POS.y + Math.sin(t * 1.25) * 0.0035 + Math.sin(t * 0.21) * 0.002 + lean.y * 0.5,
      CAMERA_POS.z + Math.sin(t * 0.17) * 0.003 + lean.z,
    );
    const want = w > 0 ? tmp.current.copy(CAMERA_TARGET).lerp(sceneFx.focus, 0.3) : CAMERA_TARGET;
    look.current.lerp(want, 1 - Math.exp(-dt * 2));
    // breath catch: a small involuntary push toward the glass (a few cm, eased both ways), plus a hair closer as he grows suspicious
    const push = sceneFx.push * 0.035 + sceneFx.alert * 0.012;
    if (push > 0.0001) cam.position.addScaledVector(tmp.current.copy(look.current).sub(cam.position).normalize(), push);
    cam.lookAt(look.current.x + Math.sin(t * 0.29) * 0.004, look.current.y + Math.sin(t * 0.43) * 0.003, look.current.z);
  });
  return null;
}

// dev-only profiling switches, e.g. ?fx=0&shadows=0
const DEV_FLAGS = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams();
const devOff = (k: string) => DEV_FLAGS.get(k) === '0';

function SceneContents(props: VaultSceneProps) {
  const mats = useVaultMaterials();
  const breath = useRef(props.breath); breath.current = props.breath;
  const beat = useRef(props.heartbeat); beat.current = props.heartbeat;
  const heat = useRef(props.heat); heat.current = props.heat;
  const alert = useRef(props.alert ?? 0); alert.current = props.alert ?? 0;
  const catchPulse = useRef(props.catchPulse); catchPulse.current = props.catchPulse;
  const { scene } = useThree();
  const glow = useRef<THREE.PointLight>(null);
  const fps = useRef({ n: 0, t: 0 });

  const { gl } = useThree();
  useEffect(() => { if (import.meta.env.DEV) Object.assign(window, { __vaultGL: gl, __vaultScene: scene }); }, [gl, scene]);
  useEffect(() => {
    // the frosted screen only needs a blurred copy of the room behind it
    (gl as THREE.WebGLRenderer & { transmissionResolutionScale: number }).transmissionResolutionScale = props.quality === 'high' ? 0.5 : 0.35;
  }, [gl, props.quality]);
  useEffect(() => {
    scene.fog = new THREE.FogExp2('#08090a', 0.07);
    return () => { scene.fog = null; };
  }, [scene]);

  useFrame((_, dt) => {
    applyEnvStrength(mats, scene.environment);
    // shadows re-render only while something on the player's side moves
    gl.shadowMap.autoUpdate = false;
    if (sceneFx.shadowFrames > 0) { gl.shadowMap.needsUpdate = true; sceneFx.shadowFrames--; }
    const h = heat.current;
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) { fog.density = 0.06 + h * 0.12; fog.color.setRGB(0.032 + h * 0.03, 0.034, 0.038 - h * 0.01); }
    // one shared gold light follows the brightest open casket (constant light count: no shader recompiles)
    let best = 0, bi = -1;
    for (let i = 0; i < sceneFx.boxGlow.length; i++) if (sceneFx.boxGlow[i] > best) { best = sceneFx.boxGlow[i]; bi = i; }
    if (glow.current) {
      glow.current.intensity = best * 0.12;
      if (bi >= 0) glow.current.position.copy(sceneFx.boxGlowPos[bi]);
    }
    mats.gold.emissiveIntensity = 0.08 + best * 0.12;
    // active box focus decays when nothing is active
    const practicePeek = props.practice?.some((p) => p.state === 'peeking') ?? false;
    if (props.activeBoxId == null && !practicePeek) sceneFx.focusWeight = Math.max(0, sceneFx.focusWeight - dt * 1.5);
    fps.current.n++; fps.current.t += dt;
    if (fps.current.t >= 0.5) { sceneFx.fps = fps.current.n / fps.current.t; fps.current.n = 0; fps.current.t = 0; }
  });

  return (
    <>
      <Environment files="./assets/hdri/bank_vault_1k.hdr" environmentIntensity={0.06} />
      <hemisphereLight args={['#2a2e33', '#0a0a0a', 0.1]} />
      {/* cool fill spilling from the open vault, opposite the warm key */}
      <AimedSpot position={[-2.3, 2.6, -3.4]} target={[0.9, 0.9, -1.9]} angle={0.85} penumbra={1} intensity={5} distance={8} color="#a9bedb" />
      <pointLight ref={glow} intensity={0} distance={0.9} decay={2} color="#ffb347" />
      <ReactionDriver alert={alert} catchPulse={catchPulse} />
      <CameraRig />
      {!devOff('room') && <Room mats={mats} heat={heat} />}
      <Table mats={mats} />
      {!devOff('glass') && <TellerScreen mats={mats} quality={props.quality} />}
      {!devOff('lamp') && <BankerLamp mats={mats} heat={heat} beat={beat} quality={props.quality} />}
      <Banker state={props.bankerState} mats={mats} heat={heat} />
      <Gauge mats={mats} breath={breath} beat={beat} />
      <StripRecorder mats={mats} breath={breath} />
      {props.boxes.slice(0, 10).map((b, i) => (
        <Box key={b.id} index={i} box={b} isActive={props.activeBoxId === b.id} peekContents={props.activeBoxId === b.id ? props.peekContents : null} mats={mats} onClick={props.onBoxClick} />
      ))}
      {props.practice && props.practice.length > 0 && <PracticeTray practice={props.practice} mats={mats} />}
      {!devOff('fx') && !props.lite && <Effects quality={props.quality} />}
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
  // adaptive resolution: drop render scale when the GPU is busy (the SDK shares it), recover when it frees up
  const base = high ? 0.9 : 0.7;
  const [dpr, setDpr] = useState(base);
  useEffect(() => setDpr(base), [base]);
  const lite = !!props.lite;
  return (
    <Canvas
      frameloop={lite ? 'demand' : 'always'}
      shadows={devOff('shadows') ? false : { type: THREE.PCFShadowMap }}
      dpr={lite ? 0.5 : dpr}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping, stencil: false }}
      camera={{ fov: 52, near: 0.03, far: 40, position: CAMERA_POS.toArray() }}
      style={{ position: 'absolute', inset: 0, background: '#050403' }}
    >
      <color attach="background" args={['#050403']} />
      {lite && <LiteTicker fps={20} />}
      {!devOff('adapt') && !lite && <PerformanceMonitor bounds={() => [50, 59]} flipflops={6} onDecline={() => setDpr((d) => Math.max(high ? 0.65 : 0.5, +(d - 0.1).toFixed(2)))} onIncline={() => setDpr((d) => Math.min(base, +(d + 0.1).toFixed(2)))} />}
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}

export default VaultScene;
