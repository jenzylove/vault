// The Fence: a stylised buyer in his lit booth window. He reads you: leans in and narrows his eyes as his alert
// rises, flinches and his lamp flares on a breath catch, smirks and fans cash when he makes an offer, and turns
// his back when he passes.
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BankerState } from './types';
import type { HeistMaterials } from './heistMaterials';
import { BOOTH } from './layout';
import { sceneFx } from './fx';
import { FIG } from './bankerFigure';
import { PAL, billTexture } from './heistTextures';

const V = (x: number, y: number) => new THREE.Vector2(x, y);
const hatCrown = new THREE.LatheGeometry([V(0, 0.2), V(0.12, 0.19), V(0.17, 0.16), V(0.185, 0.06), V(0.195, 0)], 32);
const hatBrim = new THREE.LatheGeometry([V(0.15, 0.008), V(0.3, 0.0), V(0.335, 0.025), V(0.335, 0.012), V(0.3, -0.012), V(0.15, -0.004)], 40);
const hatBand = new THREE.CylinderGeometry(0.192, 0.196, 0.05, 32, 1, true);
const headGeo = new THREE.SphereGeometry(0.2, 32, 24);
const eyeGeo = new THREE.SphereGeometry(0.048, 18, 14);
const pupilGeo = new THREE.SphereGeometry(0.022, 12, 10);
const lidGeo = new THREE.SphereGeometry(0.052, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const browGeo = new THREE.BoxGeometry(0.1, 0.024, 0.03);
const noseGeo = new THREE.SphereGeometry(0.058, 16, 12);
const earGeo = new THREE.SphereGeometry(0.045, 12, 10);
const stacheGeo = new THREE.CapsuleGeometry(0.022, 0.07, 4, 10).rotateZ(Math.PI / 2);
const mouthGeo = new THREE.TorusGeometry(0.055, 0.012, 8, 18, Math.PI);
const cigarGeo = new THREE.CylinderGeometry(0.014, 0.016, 0.16, 10).rotateZ(Math.PI / 2);
const emberGeo = new THREE.SphereGeometry(0.017, 10, 8);
const tieGeo = mergeGeometries([
  new THREE.BoxGeometry(0.05, 0.04, 0.02).translate(0, 0.0, 0),
  new THREE.CylinderGeometry(0.045, 0.02, 0.3, 4).rotateY(Math.PI / 4).scale(1, 1, 0.35).translate(0, -0.17, 0),
])!;
const shirtGeo = new THREE.CircleGeometry(0.12, 3, Math.PI / 2 + Math.PI, 0).scale(1, 1.6, 1);
const billGeo = new THREE.PlaneGeometry(0.17, 0.085);

const WARM = new THREE.Color('#ff9a5a');
const HOT = new THREE.Color(PAL.alarm);
const LAMP: Record<BankerState, number> = { idle: 1, reading: 1.35, speaking: 1.15, walking: 0.45, offering: 1.25 };

export const Fence = memo(function Fence({ state, mats, heat, lite }: { state: BankerState; mats: HeistMaterials; heat: React.MutableRefObject<number>; lite: boolean }) {
  const skin = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e7ad84', roughness: 0.6 }), []);
  const nose = useMemo(() => new THREE.MeshStandardMaterial({ color: '#df8a6e', roughness: 0.5 }), []);
  const suit = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a3226', roughness: 0.75 }), []);
  const hat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a2418', roughness: 0.6 }), []);
  const hair = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3b2016', roughness: 0.8 }), []);
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fff8ec', roughness: 0.25 }), []);
  const pupil = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a140c', roughness: 0.2 }), []);
  const lip = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a1a1a', roughness: 0.5 }), []);
  const cigar = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.8 }), []);
  const ember = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: new THREE.Color('#ff5a20'), emissiveIntensity: 2, toneMapped: false }), []);
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: PAL.crimson, emissive: new THREE.Color('#ff8a4a'), emissiveIntensity: 0.6, roughness: 0.5, side: THREE.DoubleSide }), []);
  const bill = useMemo(() => new THREE.MeshStandardMaterial({ map: billTexture(), roughness: 0.7, side: THREE.DoubleSide }), []);

  const fig = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const lids = useRef<THREE.Mesh[]>([]);
  const brows = useRef<THREE.Mesh[]>([]);
  const pupils = useRef<THREE.Mesh[]>([]);
  const mouth = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Group>(null);
  const fan = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const st = useRef({ turn: 0, lean: 0, lamp: 1, smirk: 0, reach: 0, nextBlink: 2, blink: 0 });

  useFrame((s, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const a = st.current; const now = s.clock.elapsedTime;
    const k = (r: number) => 1 - Math.exp(-dt * r);
    const al = sceneFx.alert, fl = sceneFx.flare, push = sceneFx.push;
    const walking = state === 'walking';
    // turn his back when he passes
    a.turn += ((walking ? 1 : 0) - a.turn) * k(walking ? 3.2 : 2.4);
    // suspicion: lean toward the window
    const leanIn = walking ? 0 : al * al * (3 - 2 * al);
    a.lean += (leanIn - a.lean) * k(4);
    a.smirk += ((state === 'offering' ? 1 : 0) - a.smirk) * k(5);
    a.reach += ((state === 'offering' ? 1 : 0) - a.reach) * k(3.5);
    // idle blinks (never while narrowing hard)
    if (now > a.nextBlink) { a.blink = 1; a.nextBlink = now + 2.5 + Math.random() * 3; }
    a.blink = Math.max(0, a.blink - dt * 7);

    if (fig.current) {
      fig.current.position.z = -0.62 + a.lean * 0.28 + push * 0.08 - fl * 0.06;
      fig.current.rotation.y = a.turn * Math.PI * 0.92;
    }
    if (body.current) {
      body.current.rotation.x = 0.04 + a.lean * 0.2 + Math.sin(now * 1.3) * 0.01 - fl * 0.12;
      body.current.position.y = Math.sin(now * 1.3) * 0.006;
    }
    if (head.current) {
      const talk = state === 'speaking' ? Math.sin(now * 6) * 0.03 : 0;
      const nod = state === 'offering' ? Math.max(0, Math.sin(now * 3.2)) * 0.08 : 0;
      const tilt = state === 'reading' ? Math.sin(now * 0.7) * 0.06 : 0;
      head.current.rotation.x = talk + nod - fl * 0.22 + a.lean * 0.08;
      head.current.rotation.z = tilt + a.lean * 0.12 + a.smirk * 0.06;
      head.current.rotation.y = tilt * 0.5 + a.lean * -0.12;
    }
    // eyes: lids narrow with alert, snap wide on a catch; a blink now and then
    const narrow = Math.max(0, a.lean * 0.95 - fl * 1.5);
    const close = Math.min(1, Math.max(narrow * 0.62, a.blink));
    for (const l of lids.current) if (l) l.rotation.x = -1.9 + close * 1.5;
    brows.current.forEach((b, i) => {
      if (!b) return;
      const side = i === 0 ? -1 : 1;
      b.position.y = 0.105 - a.lean * 0.02 + fl * 0.04 + (state === 'offering' && i === 1 ? 0.02 : 0);
      b.rotation.z = side * (-a.lean * 0.45 + fl * 0.25) + (i === 1 ? a.smirk * 0.25 : 0);
    });
    // pupils follow the hero safe when it is out, otherwise you
    const lookX = sceneFx.heroWeight > 0.3 ? -0.9 : -0.35, lookY = sceneFx.heroWeight > 0.3 ? -0.35 : -0.1;
    pupils.current.forEach((p, i) => { if (p) p.position.set((i === 0 ? -0.07 : 0.07) + lookX * 0.014, 0.03 + lookY * 0.014, 0.205); });
    if (mouth.current) {
      const open = state === 'speaking' ? 0.7 + Math.abs(Math.sin(now * 7.5)) * 0.9 : 0.4;
      mouth.current.scale.set(1 + a.smirk * 0.15, open, 1);
      mouth.current.rotation.z = Math.PI + a.smirk * 0.35 - a.lean * 0.1;
      mouth.current.position.x = a.smirk * 0.025;
    }
    if (armR.current) armR.current.rotation.x = -0.9 - a.reach * 1.1;
    if (fan.current) { fan.current.visible = a.reach > 0.05; fan.current.scale.setScalar(Math.max(0.01, a.reach)); }
    // the booth lamp: brighter as he reads, flares on a catch, dims when he turns away
    const want = LAMP[state] * (1 + al * 0.3);
    a.lamp += (want - a.lamp) * k(2);
    const lampNow = a.lamp + fl * 1.6;
    shade.emissiveIntensity = 0.4 + lampNow * 0.8;
    shade.emissive.copy(WARM).lerp(HOT, Math.min(1, heat.current * 0.5 + fl * 0.4));
    ember.emissiveIntensity = 1.5 + fl * 6 + Math.sin(now * 2) * 0.4;
    if (lamp.current) lamp.current.intensity = lampNow * (lite ? 4.5 : 3.6);
  });

  const L = (i: number) => (m: THREE.Mesh | null) => { if (m) lids.current[i] = m; };
  const B = (i: number) => (m: THREE.Mesh | null) => { if (m) brows.current[i] = m; };
  const P = (i: number) => (m: THREE.Mesh | null) => { if (m) pupils.current[i] = m; };

  return (
    <group position={[BOOTH.x, 0, 0]}>
      {/* booth lamp on the counter */}
      <group position={[-0.56, BOOTH.bottom - 0.01, -0.3]}>
        <mesh material={mats.copper} position={[0, 0.015, 0]}><cylinderGeometry args={[0.07, 0.08, 0.03, 20]} /></mesh>
        <mesh material={mats.copper} position={[0, 0.17, 0]}><cylinderGeometry args={[0.009, 0.009, 0.3, 8]} /></mesh>
        <mesh material={shade} position={[0, 0.34, 0]}><cylinderGeometry args={[0.06, 0.13, 0.14, 24, 1, true]} /></mesh>
        <pointLight ref={lamp} position={[0.1, 0.3, 0.15]} color="#ffc48a" intensity={3.6} distance={3.2} decay={1.6} />
      </group>

      <group ref={fig} position={[0, 0.5, -0.62]} scale={1.3}>
        <group ref={body}>
          <mesh geometry={FIG.torso} material={suit} scale={[1.25, 1.2, 1.25]} castShadow />
          <mesh geometry={shirtGeo} material={mats.cream} position={[0, 0.6, 0.12]} rotation={[-0.15, 0, 0]} />
          <mesh geometry={tieGeo} material={mats.crimson} position={[0, 0.64, 0.135]} rotation={[-0.12, 0, 0]} />
          {/* arms on the counter */}
          {[-1, 1].map((sx) => (
            <group key={sx} ref={sx === 1 ? armR : undefined} position={[sx * 0.26, 0.6, 0]} rotation={[-0.9, 0, sx * -0.12]}>
              <mesh geometry={FIG.upperArm} material={suit} scale={1.15} />
              <group position={[0, -0.3, 0]} rotation={[-0.5, 0, sx * 0.3]}>
                <mesh geometry={FIG.foreArm} material={suit} scale={1.15} />
                <mesh geometry={FIG.hand} material={skin} position={[0, -0.28, 0]} scale={1.2} />
                {sx === 1 && (
                  <group ref={fan} position={[0, -0.33, 0.02]} rotation={[0.4, 0, 0]} visible={false}>
                    {[-0.35, 0, 0.35].map((r, i) => (
                      <mesh key={i} geometry={billGeo} material={bill} position={[0, -0.04, 0.004 * i]} rotation={[Math.PI / 2, 0, r]} />
                    ))}
                  </group>
                )}
              </group>
            </group>
          ))}
          {/* head */}
          <group ref={head} position={[0, 0.9, 0.02]}>
            <mesh geometry={headGeo} material={skin} scale={[0.95, 1.05, 0.95]} castShadow />
            <mesh geometry={headGeo} material={skin} position={[0, -0.08, 0.03]} scale={[0.72, 0.55, 0.75]} />
            {[-1, 1].map((sx) => <mesh key={sx} geometry={earGeo} material={skin} position={[sx * 0.19, 0.0, -0.01]} scale={[0.5, 1, 0.8]} />)}
            <mesh geometry={noseGeo} material={nose} position={[0, -0.02, 0.2]} scale={[0.9, 0.85, 1]} />
            {[0, 1].map((i) => (
              <group key={i}>
                <mesh geometry={eyeGeo} material={white} position={[i === 0 ? -0.07 : 0.07, 0.03, 0.165]} />
                <mesh ref={P(i)} geometry={pupilGeo} material={pupil} position={[i === 0 ? -0.07 : 0.07, 0.03, 0.205]} />
                <mesh ref={L(i)} geometry={lidGeo} material={skin} position={[i === 0 ? -0.07 : 0.07, 0.03, 0.165]} rotation={[-1.9, 0, 0]} />
                <mesh ref={B(i)} geometry={browGeo} material={hair} position={[i === 0 ? -0.075 : 0.075, 0.105, 0.19]} />
              </group>
            ))}
            {[-1, 1].map((sx) => <mesh key={sx} geometry={stacheGeo} material={hair} position={[sx * 0.05, -0.075, 0.205]} rotation={[0, sx * -0.3, sx * -0.25]} />)}
            <mesh ref={mouth} geometry={mouthGeo} material={lip} position={[0, -0.115, 0.19]} rotation={[0, 0, Math.PI]} />
            <group position={[0.09, -0.12, 0.2]} rotation={[0, -0.5, -0.12]}>
              <mesh geometry={cigarGeo} material={cigar} position={[0.07, 0, 0]} />
              <mesh geometry={emberGeo} material={ember} position={[0.15, 0, 0]} />
            </group>
            {/* fedora */}
            <group position={[0, 0.13, -0.01]} rotation={[-0.12, 0, 0.05]}>
              <mesh geometry={hatCrown} material={hat} castShadow />
              <mesh geometry={hatBand} material={mats.crimson} position={[0, 0.03, 0]} />
              <mesh geometry={hatBrim} material={hat} castShadow />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
});
