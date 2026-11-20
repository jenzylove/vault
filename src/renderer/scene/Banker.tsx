// The banker: never a face. A seated silhouette behind frosted glass, backlit by his own lamp.
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { BANKER_Z, GLASS_Z, TABLE_Y } from './layout';
import type { BankerState } from './types';
import type { VaultMaterials } from './materials';
import { sceneFx } from './fx';
import { AimedSpot } from './AimedSpot';
import { FIG } from './bankerFigure';
import { enableBehindGlass } from './FrostedGlass';

const LAMP_LEVEL: Record<BankerState, number> = { idle: 0.55, reading: 1.6, speaking: 1.15, walking: 0.18, offering: 1.0 };
const HOT = new THREE.Color('#ff6f3d');
const FLARE = new THREE.Color('#ffb25e');
const LEAN: Record<BankerState, number> = { idle: 0.03, reading: 0.24, speaking: 0.1, walking: -0.16, offering: 0.16 };

function chitTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#efe7d2'; ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#2a2116'; ctx.lineWidth = 5; ctx.strokeRect(10, 10, 236, 140);
  ctx.fillStyle = '#2a2116'; ctx.textAlign = 'center';
  ctx.font = '600 30px "Bodoni MT","Times New Roman",serif'; ctx.fillText('OFFRE', 128, 62);
  ctx.font = 'italic 22px "Times New Roman",serif'; ctx.fillText('Banque Keller & Cie', 128, 98);
  ctx.font = '18px "Times New Roman",serif'; ctx.fillText('Nº 0417', 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export const Banker = memo(function Banker({ state, mats, heat }: { state: BankerState; mats: VaultMaterials; heat: React.MutableRefObject<number> }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const chit = useRef<THREE.Group>(null);
  const washMat = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(170, 120, 10, 150, 128, 190);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#6a6a6a'); g.addColorStop(1, '#000000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    const m = mats.walnut.clone(); m.emissiveMap = t; m.emissive = new THREE.Color('#ffd4a3'); m.emissiveIntensity = 0.2;
    return m;
  }, [mats.walnut]);
  const shadeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a2a18', emissive: new THREE.Color('#ffc58a'), emissiveIntensity: 2, roughness: 0.9, side: THREE.DoubleSide }), []);
  const chitMat = useMemo(() => new THREE.MeshStandardMaterial({ map: chitTexture(), color: '#e9c77c', metalness: 0.55, roughness: 0.4 }), []);
  const rootRef = useRef<THREE.Group>(null);
  const figure = useRef<THREE.Group>(null);
  useEffect(() => { if (rootRef.current) enableBehindGlass(rootRef.current); }, []);
  const st = useRef({ state, since: 0, lamp: LAMP_LEVEL[state], lean: LEAN[state], chit: 0, reach: 0 });
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((s, dt) => {
    const a = st.current; const now = s.clock.elapsedTime;
    if (a.state !== state) { a.state = state; a.since = now; }
    const t = now - a.since;
    const k = 1 - Math.exp(-dt * 3);
    // lamp swells while he reads you; heartbeat-free, slow and deliberate
    const lampT = LAMP_LEVEL[state] * (state === 'reading' ? 0.92 + 0.08 * Math.sin(now * 2.1) : 1);
    a.lamp += (lampT - a.lamp) * (1 - Math.exp(-dt * (state === 'walking' ? 2.2 : 1.6)));
    const al = sceneFx.alert; const fl = sceneFx.flare;
    col.set('#ffd4a3').lerp(HOT, heat.current * 0.6).lerp(FLARE, fl * 0.5);
    // his lamp's wash on the booth panel is emissive (no extra light for every pixel in the room)
    // it brightens as he grows suspicious and flares on a breath catch, so the silhouette sharpens against it
    const lampNow = a.lamp * (1 + al * 0.35) + fl * 0.9;
    washMat.emissive.copy(col); washMat.emissiveIntensity = 0.05 + lampNow * 0.32;
    shadeMat.emissive.copy(col); shadeMat.emissiveIntensity = 0.25 + lampNow * 0.9;

    // posture
    const breathe = Math.sin(now * 1.3) * 0.006;
    a.lean += (LEAN[state] - a.lean) * k;
    // suspicion: the whole figure slides toward the glass and grows a touch, the torso leans in over the desk.
    // Eased (sceneFx.alert is already damped), so it creeps in rather than jumps; walking pulls him back.
    const leanIn = state === 'walking' ? al * 0.25 : al;
    const ease = leanIn * leanIn * (3 - 2 * leanIn);
    if (figure.current) {
      figure.current.position.z = BANKER_Z - 0.06 + ease * 0.12 + fl * 0.01;
      figure.current.scale.setScalar(1 + ease * 0.07);
    }
    if (body.current) { body.current.rotation.x = a.lean + ease * 0.17 + fl * 0.03 + breathe * (1 - ease * 0.6); body.current.position.y = breathe * 0.5; }
    if (head.current) {
      const talk = state === 'speaking' ? Math.sin(now * 5.3) * 0.045 + Math.sin(now * 3.1) * 0.03 : 0;
      const tilt = state === 'reading' ? Math.sin(now * 0.6) * 0.06 : state === 'speaking' ? Math.sin(now * 1.7) * 0.05 : 0;
      // he cocks his head and keeps his eyes level on you as he leans in; a catch snaps it up for an instant
      head.current.rotation.x = talk + (state === 'reading' ? 0.12 : 0) - ease * 0.14 - fl * 0.07;
      head.current.rotation.z = tilt * 0.6 * (1 - ease * 0.5) + ease * 0.2;
      head.current.rotation.y = tilt * (1 - ease * 0.7) - ease * 0.06;
    }
    // arm reaches when offering a chit or pulling a burned box
    const pulling = now - sceneFx.pullTime;
    const reachT = state === 'offering' ? 1 : pulling > -0.3 && pulling < 2.2 ? 0.9 : 0;
    a.reach += (reachT - a.reach) * (1 - Math.exp(-dt * 4));
    if (armR.current) armR.current.rotation.x = -0.35 - a.reach * 0.9;
    // chit slides under the glass toward the player while offering
    const chitT = state === 'offering' ? Math.min(1, Math.max(0, (t - 0.4) / 1.4)) : 0;
    const e = chitT * chitT * (3 - 2 * chitT);
    a.chit += ((state === 'offering' ? e : 0) - a.chit) * (state === 'offering' ? 1 : 1 - Math.exp(-dt * 2));
    if (a.chit > 0.001 && a.chit < 0.999) sceneFx.shadowFrames = Math.max(sceneFx.shadowFrames, 2);
    if (chit.current) {
      chit.current.position.z = THREE.MathUtils.lerp(BANKER_Z + 0.35, GLASS_Z + 0.38, a.chit);
      chit.current.visible = a.chit > 0.01;
    }
  });

  const S = mats.silhouette;
  return (
    <group ref={rootRef}>
      {/* backdrop panel of his booth, washed by his lamp so he reads as a silhouette */}
      <mesh position={[0, 1.45, BANKER_Z - 0.85]} material={washMat} receiveShadow>
        <boxGeometry args={[2.1, 1.7, 0.04]} />
      </mesh>
      {/* credenza and his lamp */}
      <RoundedBox args={[1.1, 0.8, 0.4]} radius={0.01} position={[0, 0.4, BANKER_Z - 0.6]} material={mats.walnut} receiveShadow castShadow />
      <group position={[0.36, 0.8, BANKER_Z - 0.62]}>
        <mesh position={[0, 0.02, 0]} material={mats.brass}><cylinderGeometry args={[0.06, 0.07, 0.04, 32]} /></mesh>
        <mesh position={[0, 0.2, 0]} material={mats.brass}><cylinderGeometry args={[0.008, 0.008, 0.34, 12]} /></mesh>
        <mesh position={[0, 0.4, 0]} material={shadeMat}><cylinderGeometry args={[0.07, 0.13, 0.17, 40, 1, true]} /></mesh>
      </group>

      {/* high-backed chair */}
      <RoundedBox args={[0.5, 0.62, 0.1]} radius={0.05} smoothness={3} position={[0, 0.86, BANKER_Z - 0.26]} material={S} />
      <RoundedBox args={[0.55, 0.08, 0.5]} radius={0.03} position={[0, 0.48, BANKER_Z]} material={S} />

      {/* seated figure, pivoting at the hips */}
      <group ref={figure} position={[0, 0.55, BANKER_Z - 0.06]}>
        <group ref={body}>
          <mesh geometry={FIG.torso} material={S} />
          <group ref={head} position={[0, 0.66, 0.01]}>
            <mesh geometry={FIG.head} material={S} />
          </group>
          {/* left forearm rests on the desk */}
          <group position={[-0.215, 0.5, 0]} rotation={[-0.3, 0, 0.1]}>
            <mesh geometry={FIG.upperArm} material={S} />
            <group position={[0, -0.26, 0]} rotation={[1.45, 0, -0.35]}>
              <mesh geometry={FIG.foreArm} material={S} />
              <mesh geometry={FIG.hand} material={S} position={[0, -0.25, 0]} />
            </group>
          </group>
          {/* right arm reaches */}
          <group ref={armR} position={[0.215, 0.5, 0]} rotation={[-0.3, 0, -0.1]}>
            <mesh geometry={FIG.upperArm} material={S} />
            <group position={[0, -0.26, 0]} rotation={[1.45, 0, 0.35]}>
              <mesh geometry={FIG.foreArm} material={S} />
              <mesh geometry={FIG.hand} material={S} position={[0, -0.25, 0]} />
            </group>
          </group>
        </group>
      </group>

      {/* brass chit, slides under the screen to the player */}
      <group ref={chit} position={[0.1, TABLE_Y + 0.003, BANKER_Z + 0.35]} rotation={[0, -0.08, 0]} visible={false}>
        <RoundedBox args={[0.075, 0.003, 0.048]} radius={0.0012} smoothness={2} material={mats.brassPolished} castShadow />
        <mesh position={[0, 0.0017, 0]} rotation={[-Math.PI / 2, 0, 0]} material={chitMat}><planeGeometry args={[0.062, 0.038]} /></mesh>
      </group>
    </group>
  );
});
