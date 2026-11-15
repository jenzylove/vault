// The Vault: a 1950s Swiss bank vault after hours, rendered from the seated player's eyes.
import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import type { VaultSceneProps } from './types';
import { useVaultMaterials } from './materials';
import { Room } from './Room';
import { Table, TellerScreen, BankerLamp } from './Table';
import { Box } from './Box';
import { Banker } from './Banker';
import { Gauge, StripRecorder } from './Polygraph';
import { Effects } from './Effects';
import { CAMERA_POS, CAMERA_TARGET } from './layout';
import { sceneFx } from './fx';

export type { VaultSceneProps } from './types';

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
    cam.lookAt(look.current.x + Math.sin(t * 0.29) * 0.004, look.current.y + Math.sin(t * 0.43) * 0.003, look.current.z);
  });
  return null;
}

function SceneContents(props: VaultSceneProps) {
  const mats = useVaultMaterials();
  const breath = useRef(props.breath); breath.current = props.breath;
  const beat = useRef(props.heartbeat); beat.current = props.heartbeat;
  const heat = useRef(props.heat); heat.current = props.heat;
  const { scene } = useThree();
  const glow = useRef<THREE.PointLight>(null);
  const fps = useRef({ n: 0, t: 0 });

  useEffect(() => {
    scene.fog = new THREE.FogExp2('#0d0a07', 0.07);
    return () => { scene.fog = null; };
  }, [scene]);

  useFrame((st, dt) => {
    const h = heat.current;
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) { fog.density = 0.06 + h * 0.12; fog.color.setRGB(0.05 + h * 0.03, 0.038, 0.027); }
    // one shared gold light follows the brightest open casket (constant light count: no shader recompiles)
    let best = 0, bi = -1;
    for (let i = 0; i < sceneFx.boxGlow.length; i++) if (sceneFx.boxGlow[i] > best) { best = sceneFx.boxGlow[i]; bi = i; }
    if (glow.current) {
      glow.current.intensity = best * 0.22;
      if (bi >= 0) glow.current.position.copy(sceneFx.boxGlowPos[bi]);
    }
    mats.gold.emissiveIntensity = 0.08 + best * 0.12;
    // active box focus decays when nothing is active
    if (props.activeBoxId == null) sceneFx.focusWeight = Math.max(0, sceneFx.focusWeight - dt * 1.5);
    fps.current.n++; fps.current.t += dt;
    if (fps.current.t >= 0.5) { sceneFx.fps = fps.current.n / fps.current.t; fps.current.n = 0; fps.current.t = 0; }
    void st;
  });

  return (
    <>
      <Environment files="./assets/hdri/lythwood_lounge_1k.hdr" environmentIntensity={0.08} />
      <hemisphereLight args={['#2c2a28', '#0b0806', 0.12]} />
      <pointLight ref={glow} intensity={0} distance={0.9} decay={2} color="#ffb347" />
      <CameraRig />
      <Room mats={mats} heat={heat} />
      <Table mats={mats} />
      <TellerScreen mats={mats} />
      <BankerLamp mats={mats} heat={heat} beat={beat} quality={props.quality} />
      <Banker state={props.bankerState} mats={mats} heat={heat} />
      <Gauge mats={mats} breath={breath} beat={beat} />
      <StripRecorder mats={mats} breath={breath} />
      {props.boxes.slice(0, 10).map((b, i) => (
        <Box key={b.id} index={i} box={b} isActive={props.activeBoxId === b.id} peekContents={props.activeBoxId === b.id ? props.peekContents : null} mats={mats} onClick={props.onBoxClick} />
      ))}
      <Effects quality={props.quality} />
    </>
  );
}

export function VaultScene(props: VaultSceneProps): JSX.Element {
  const high = props.quality === 'high';
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={high ? [1, 1.25] : [1, 1]}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping, stencil: false }}
      camera={{ fov: 52, near: 0.03, far: 40, position: CAMERA_POS.toArray() }}
      style={{ position: 'absolute', inset: 0, background: '#050403' }}
    >
      <color attach="background" args={['#050403']} />
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}

export default VaultScene;
