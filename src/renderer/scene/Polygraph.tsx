// Period polygraph on the player's side: brass pneumograph gauge (needle = breath) and a strip chart recorder.
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { TABLE_Y, CAMERA_POS } from './layout';
import type { VaultMaterials } from './materials';
import { gaugeDialTexture } from './textures';

const faceCamera = (x: number, z: number) => Math.atan2(CAMERA_POS.x - x, CAMERA_POS.z - z);

const needleGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.0016, -0.012); s.lineTo(0.0016, -0.012); s.lineTo(0.0005, 0.05); s.lineTo(-0.0005, 0.05); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.0006, bevelEnabled: false });
})();

export const Gauge = memo(function Gauge({ mats, breath, beat }: { mats: VaultMaterials; breath: React.MutableRefObject<number[]>; beat: React.MutableRefObject<number> }) {
  const pos: [number, number, number] = [0.15, TABLE_Y, -0.5];
  const needle = useRef<THREE.Group>(null);
  const jewel = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#4a0503', emissive: new THREE.Color('#ff2a12'), emissiveIntensity: 0.2, roughness: 0.15, clearcoat: 1, transmission: 0 }), []);
  const jewelLight = useRef<THREE.PointLight>(null);
  const dial = useMemo(() => gaugeDialTexture(), []);
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, clearcoat: 1, envMapIntensity: 1.5, depthWrite: false }), []);
  const spring = useRef({ x: 0, v: 0 });
  useFrame((_, dt) => {
    const b = breath.current;
    const target = b.length ? Math.max(-1.1, Math.min(1.1, b[b.length - 1])) : 0;
    // under-damped needle: a real meter movement overshoots a hair
    const sp = spring.current; const k = 140, c = 14;
    const step = Math.min(dt, 1 / 30);
    sp.v += (k * (target - sp.x) - c * sp.v) * step; sp.x += sp.v * step;
    if (needle.current) needle.current.rotation.z = -sp.x * 2.2;
    const hb = beat.current;
    jewel.emissiveIntensity = 0.25 + hb * 7;
    if (jewelLight.current) jewelLight.current.intensity = hb * 0.015;
  });
  return (
    <group position={pos} rotation={[0, faceCamera(pos[0], pos[2]), 0]} scale={0.7}>
      {/* walnut plinth with brass trim */}
      <RoundedBox args={[0.17, 0.03, 0.12]} radius={0.006} smoothness={3} position={[0, 0.015, 0]} material={mats.walnut} castShadow receiveShadow />
      <RoundedBox args={[0.172, 0.006, 0.122]} radius={0.002} smoothness={2} position={[0, 0.031, 0]} material={mats.brassDark} castShadow />
      {/* gauge drum, tilted back toward the eye */}
      <group position={[0, 0.105, -0.005]} rotation={[-0.42, 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.brass} castShadow receiveShadow>
          <cylinderGeometry args={[0.072, 0.072, 0.045, 64]} />
        </mesh>
        <mesh position={[0, 0, 0.0235]} material={mats.brassPolished}>
          <torusGeometry args={[0.067, 0.0055, 16, 64]} />
        </mesh>
        <mesh position={[0, 0, 0.0228]}>
          <circleGeometry args={[0.064, 64]} />
          <meshStandardMaterial map={dial} roughness={0.65} />
        </mesh>
        <group ref={needle} position={[0, 0, 0.0236]}>
          <mesh geometry={needleGeo} material={mats.blackEnamel} castShadow />
          <mesh position={[0, -0.012, 0.0004]} material={mats.blackEnamel}><circleGeometry args={[0.0042, 20]} /></mesh>
        </group>
        <mesh position={[0, 0, 0.0252]} rotation={[Math.PI / 2, 0, 0]} material={mats.brassPolished}>
          <cylinderGeometry args={[0.0032, 0.0032, 0.003, 16]} />
        </mesh>
        <mesh position={[0, 0, 0.0]} material={glass} renderOrder={4}>
          <sphereGeometry args={[0.066, 48, 16, 0, Math.PI * 2, 0, 0.42]} />
        </mesh>
        {/* stand legs */}
        <mesh position={[0, -0.07, -0.01]} material={mats.brass} castShadow><boxGeometry args={[0.03, 0.03, 0.02]} /></mesh>
      </group>
      {/* pulse pilot jewel */}
      <group position={[0.058, 0.04, 0.045]}>
        <mesh material={mats.brassPolished} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.009, 0.01, 0.008, 20]} /></mesh>
        <mesh position={[0, 0.002, 0.003]} material={jewel}><sphereGeometry args={[0.0065, 20, 14]} /></mesh>
        <pointLight ref={jewelLight} position={[0, 0.01, 0.02]} intensity={0} distance={0.35} decay={2} color="#ff3a1a" />
      </group>
    </group>
  );
});

export const StripRecorder = memo(function StripRecorder({ mats, breath }: { mats: VaultMaterials; breath: React.MutableRefObject<number[]> }) {
  const pos: [number, number, number] = [-0.17, TABLE_Y, -0.5];
  const W = 1024, Hh = 256;
  const { canvas, ctx, tex } = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = Hh;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return { canvas, ctx, tex };
  }, []);
  void canvas;
  const stylus = useRef<THREE.Group>(null);
  const scroll = useRef(0);
  const smooth = useRef(0);
  const PEN = 0.82;
  const PW = 0.19, PD = 0.07;
  const ARM = PW * (1 - PEN) + 0.03;
  useFrame((_, dt) => {
    const b = breath.current;
    scroll.current += dt * (W * PEN) / 10; // 10 s window
    ctx.fillStyle = '#eee6d2'; ctx.fillRect(0, 0, W, Hh);
    // paper grid scrolls left with the data
    const off = scroll.current % 40;
    ctx.strokeStyle = 'rgba(160,70,50,0.22)'; ctx.lineWidth = 1;
    for (let x = -off; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hh); ctx.stroke(); }
    for (let y = 16; y < Hh; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(160,70,50,0.45)'; ctx.lineWidth = 2;
    for (let x = -(scroll.current % 200); x < W; x += 200) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hh); ctx.stroke(); }
    // ink trace
    if (b.length > 1) {
      const n = b.length; const dx = (W * PEN) / (n - 1);
      ctx.strokeStyle = 'rgba(18,22,48,0.92)'; ctx.lineWidth = 3.2; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = W * PEN - (n - 1 - i) * dx; const y = Hh / 2 - Math.max(-1.2, Math.min(1.2, b[i])) * Hh * 0.36;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // margin print
    ctx.fillStyle = 'rgba(120,50,35,0.6)'; ctx.font = '16px "Times New Roman",serif'; ctx.fillText('PNEUMO  ·  CH.1', 12, 22);
    tex.needsUpdate = true;
    const last = b.length ? b[b.length - 1] : 0;
    smooth.current += (last - smooth.current) * Math.min(1, dt * 20);
    if (stylus.current) stylus.current.rotation.y = Math.asin(Math.max(-0.9, Math.min(0.9, -Math.max(-1.2, Math.min(1.2, smooth.current)) * 0.36 * PD / ARM)));
  });
  return (
    <group position={pos} rotation={[0, faceCamera(pos[0], pos[2]), 0]}>
      {/* chassis */}
      <RoundedBox args={[0.24, 0.045, 0.13]} radius={0.006} smoothness={3} position={[0, 0.0225, 0]} material={mats.blackEnamel} castShadow receiveShadow />
      <RoundedBox args={[0.242, 0.008, 0.132]} radius={0.003} smoothness={2} position={[0, 0.046, 0]} material={mats.steelBrushed} castShadow />
      {/* paper deck, tilted toward the player */}
      <group position={[0, 0.056, 0.004]} rotation={[-0.16, 0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[PW, PD]} />
          <meshStandardMaterial map={tex} roughness={0.92} />
        </mesh>
        {/* supply and take-up rolls */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * (PW / 2 + 0.008), 0.005, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.011, 0.011, PD + 0.004, 32]} /><meshStandardMaterial color="#e9e1cc" roughness={0.9} /></mesh>
            {[-1, 1].map((e) => (
              <mesh key={e} position={[0, 0, e * (PD / 2 + 0.004)]} rotation={[Math.PI / 2, 0, 0]} material={mats.brassPolished}><cylinderGeometry args={[0.014, 0.014, 0.003, 32]} /></mesh>
            ))}
          </group>
        ))}
        {/* stylus: pivots beside the paper, its tip rides the pen line */}
        <group position={[PW / 2 + 0.03, 0.004, 0]}>
          <mesh rotation={[0, 0, 0]} material={mats.brassPolished} castShadow><cylinderGeometry args={[0.007, 0.007, 0.012, 20]} /></mesh>
          <group ref={stylus}>
            <mesh position={[-ARM / 2, 0.003, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.brass} castShadow><cylinderGeometry args={[0.0011, 0.0011, ARM, 8]} /></mesh>
            <mesh position={[-ARM, 0.0012, 0]} material={mats.blackEnamel}><sphereGeometry args={[0.0022, 10, 8]} /></mesh>
          </group>
        </group>
      </group>
      {/* brass maker's badge */}
      <mesh position={[0, 0.024, 0.0655]} material={mats.brassPolished}><boxGeometry args={[0.05, 0.012, 0.001]} /></mesh>
    </group>
  );
});
