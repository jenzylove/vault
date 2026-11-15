// The banker: never a face. A seated silhouette behind frosted glass, backlit by his own lamp.
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { BANKER_Z, GLASS_Z, TABLE_Y } from './layout';
import type { BankerState } from './types';
import type { VaultMaterials } from './materials';
import { sceneFx } from './fx';
import { AimedSpot } from './AimedSpot';

const LAMP_LEVEL: Record<BankerState, number> = { idle: 0.55, reading: 1.6, speaking: 1.15, walking: 0.18, offering: 1.0 };
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
  const back = useRef<THREE.SpotLight>(null);
  const shadeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a2a18', emissive: new THREE.Color('#ffc58a'), emissiveIntensity: 2, roughness: 0.9, side: THREE.DoubleSide }), []);
  const chitMat = useMemo(() => new THREE.MeshStandardMaterial({ map: chitTexture(), color: '#e9c77c', metalness: 0.55, roughness: 0.4 }), []);
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
    col.set('#ffbe7a').lerp(new THREE.Color('#ff6f3d'), heat.current * 0.6);
    if (back.current) { back.current.intensity = a.lamp * 1.6; back.current.color.copy(col); }
    shadeMat.emissive.copy(col); shadeMat.emissiveIntensity = 0.4 + a.lamp * 2.2;

    // posture
    const breathe = Math.sin(now * 1.3) * 0.006;
    a.lean += (LEAN[state] - a.lean) * k;
    if (body.current) { body.current.rotation.x = a.lean + breathe; body.current.position.y = breathe * 0.5; }
    if (head.current) {
      const talk = state === 'speaking' ? Math.sin(now * 5.3) * 0.045 + Math.sin(now * 3.1) * 0.03 : 0;
      const tilt = state === 'reading' ? Math.sin(now * 0.6) * 0.06 : state === 'speaking' ? Math.sin(now * 1.7) * 0.05 : 0;
      head.current.rotation.x = talk + (state === 'reading' ? 0.12 : 0);
      head.current.rotation.z = tilt * 0.6;
      head.current.rotation.y = tilt;
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
    <group>
      {/* backdrop panel of his booth, washed by his lamp so he reads as a silhouette */}
      <mesh position={[0, 1.45, BANKER_Z - 0.85]} material={mats.walnut} receiveShadow>
        <boxGeometry args={[1.3, 1.6, 0.04]} />
      </mesh>
      {/* credenza and his lamp */}
      <RoundedBox args={[1.1, 0.8, 0.4]} radius={0.01} position={[0, 0.4, BANKER_Z - 0.6]} material={mats.walnut} receiveShadow castShadow />
      <group position={[0.36, 0.8, BANKER_Z - 0.62]}>
        <mesh position={[0, 0.02, 0]} material={mats.brass}><cylinderGeometry args={[0.06, 0.07, 0.04, 32]} /></mesh>
        <mesh position={[0, 0.2, 0]} material={mats.brass}><cylinderGeometry args={[0.008, 0.008, 0.34, 12]} /></mesh>
        <mesh position={[0, 0.4, 0]} material={shadeMat}><cylinderGeometry args={[0.07, 0.13, 0.17, 40, 1, true]} /></mesh>
      </group>
      <AimedSpot lightRef={back} position={[0.36, 1.2, BANKER_Z - 0.55]} target={[0, 1.4, BANKER_Z - 0.85]} angle={1.2} penumbra={1} intensity={4} distance={2} color="#ffbe7a" />

      {/* high-backed chair */}
      <RoundedBox args={[0.5, 0.62, 0.1]} radius={0.05} smoothness={3} position={[0, 0.86, BANKER_Z - 0.26]} material={S} />
      <RoundedBox args={[0.55, 0.08, 0.5]} radius={0.03} position={[0, 0.48, BANKER_Z]} material={S} />

      {/* seated figure, pivoting at the hips */}
      <group position={[0, 0.55, BANKER_Z - 0.06]}>
        <group ref={body}>
          <mesh position={[0, 0.34, 0]} scale={[1.25, 1, 0.72]} material={S}><capsuleGeometry args={[0.16, 0.3, 8, 20]} /></mesh>
          <mesh position={[0, 0.58, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.8]} material={S}><capsuleGeometry args={[0.075, 0.33, 8, 16]} /></mesh>
          <mesh position={[0, 0.68, 0]} material={S}><cylinderGeometry args={[0.05, 0.058, 0.1, 16]} /></mesh>
          <group ref={head} position={[0, 0.74, 0.01]}>
            <mesh position={[0, 0.09, 0]} scale={[0.86, 1.12, 0.98]} material={S}><sphereGeometry args={[0.1, 32, 24]} /></mesh>
            {[-1, 1].map((s) => <mesh key={s} position={[s * 0.088, 0.085, 0]} scale={[0.4, 1, 0.7]} material={S}><sphereGeometry args={[0.03, 12, 10]} /></mesh>)}
          </group>
          {/* left arm resting on the desk */}
          <group position={[-0.24, 0.56, 0]} rotation={[-0.35, 0, 0.12]}>
            <mesh position={[0, -0.14, 0]} material={S}><capsuleGeometry args={[0.05, 0.24, 6, 12]} /></mesh>
            <mesh position={[0.05, -0.27, 0.15]} rotation={[1.35, 0, -0.4]} material={S}><capsuleGeometry args={[0.045, 0.26, 6, 12]} /></mesh>
          </group>
          {/* right arm reaches */}
          <group ref={armR} position={[0.24, 0.56, 0]} rotation={[-0.35, 0, -0.12]}>
            <mesh position={[0, -0.14, 0]} material={S}><capsuleGeometry args={[0.05, 0.24, 6, 12]} /></mesh>
            <mesh position={[-0.05, -0.27, 0.15]} rotation={[1.35, 0, 0.4]} material={S}><capsuleGeometry args={[0.045, 0.26, 6, 12]} /></mesh>
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
