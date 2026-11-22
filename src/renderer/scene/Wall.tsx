// The vault wall: tufted red velvet with ten copper framed slots, cream wainscot, pilasters and crown, a
// checker floor, the Fence's arched booth window, marquee signs, his breath meter, the pulse bulb and the alarm.
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HeistMaterials } from './heistMaterials';
import { BOOTH, GRID, SAFE, CELL, WALL_Z, slotPos } from './layout';
import { sceneFx } from './fx';
import { PAL, signTexture, meterTexture, glowTexture, spillTexture } from './heistTextures';

// alarm beam: a long cone, narrow end at the beacon
const beamGeo = new THREE.CylinderGeometry(0.03, 1.1, 5, 24, 1, true).translate(0, -2.5, 0);

const WALL = { l: -5.6, r: 5.8, top: 4.6, wains: 0.62, crown: 3.55 };
const HOLE = SAFE.w / 2 + 0.025;
const ARCH_R = BOOTH.w / 2;
const ARCH_Y = BOOTH.top - ARCH_R; // centre of the arch

function archPath(p: THREE.Path | THREE.Shape, cx: number, halfW: number, bottom: number, archY: number, r: number, cw: boolean) {
  if (!cw) {
    p.moveTo(cx - halfW, bottom); p.lineTo(cx + halfW, bottom); p.lineTo(cx + halfW, archY);
    p.absarc(cx, archY, r, 0, Math.PI, false); p.lineTo(cx - halfW, bottom);
  } else {
    p.moveTo(cx - halfW, bottom); p.lineTo(cx - halfW, archY);
    p.absarc(cx, archY, r, Math.PI, 0, true); p.lineTo(cx + halfW, bottom); p.lineTo(cx - halfW, bottom);
  }
}

function buildWall() {
  const s = new THREE.Shape();
  s.moveTo(WALL.l, 0); s.lineTo(WALL.r, 0); s.lineTo(WALL.r, WALL.top); s.lineTo(WALL.l, WALL.top); s.lineTo(WALL.l, 0);
  for (let i = 0; i < GRID.cols * GRID.rows; i++) {
    const c = slotPos(i), h = new THREE.Path();
    h.moveTo(c.x - HOLE, c.y - HOLE); h.lineTo(c.x - HOLE, c.y + HOLE); h.lineTo(c.x + HOLE, c.y + HOLE); h.lineTo(c.x + HOLE, c.y - HOLE); h.lineTo(c.x - HOLE, c.y - HOLE);
    s.holes.push(h);
  }
  const w = new THREE.Path();
  archPath(w, BOOTH.x, BOOTH.w / 2, BOOTH.bottom, ARCH_Y, ARCH_R, true);
  s.holes.push(w);
  const depth = 0.12;
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, WALL_Z - depth);
}

function frameGeo() {
  // copper frame round every slot, and the slot recesses behind
  const b = 0.035, parts: THREE.BufferGeometry[] = [], recess: THREE.BufferGeometry[] = [];
  for (let i = 0; i < GRID.cols * GRID.rows; i++) {
    const c = slotPos(i), o = HOLE + b / 2;
    parts.push(
      new THREE.BoxGeometry(2 * HOLE + 2 * b, b, 0.03).translate(c.x, c.y + o, 0.015),
      new THREE.BoxGeometry(2 * HOLE + 2 * b, b, 0.03).translate(c.x, c.y - o, 0.015),
      new THREE.BoxGeometry(b, 2 * HOLE, 0.03).translate(c.x - o, c.y, 0.015),
      new THREE.BoxGeometry(b, 2 * HOLE, 0.03).translate(c.x + o, c.y, 0.015),
    );
    recess.push(new THREE.BoxGeometry(2 * HOLE, 2 * HOLE, SAFE.d + 0.12).translate(c.x, c.y, -(SAFE.d + 0.12) / 2 - 0.001));
  }
  return { frames: mergeGeometries(parts)!, recess: mergeGeometries(recess)! };
}

function archFrameGeo(inset: number, width: number, depth: number, z: number) {
  const outer = new THREE.Shape();
  archPath(outer, BOOTH.x, BOOTH.w / 2 + width - inset, BOOTH.bottom - 0.001, ARCH_Y, ARCH_R + width - inset, false);
  const hole = new THREE.Path();
  archPath(hole, BOOTH.x, BOOTH.w / 2 - inset, BOOTH.bottom - 0.001, ARCH_Y, ARCH_R - inset, true);
  outer.holes.push(hole);
  return new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 28 }).translate(0, 0, z);
}

/** A marquee sign with bulbs that chase. */
function Marquee({ text, x, y, w, h }: { text: string; x: number; y: number; w: number; h: number }) {
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.6, emissive: new THREE.Color('#ffffff'), emissiveMap: signTexture(text), emissiveIntensity: 0.35 }), [text]);
  const bulbA = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: new THREE.Color('#ffd28a'), emissiveIntensity: 2, toneMapped: false }), []);
  const bulbB = useMemo(() => bulbA.clone(), [bulbA]);
  const pts = useMemo(() => {
    const out: [number, number][] = [];
    const nx = Math.round(w / 0.16), ny = Math.max(1, Math.round(h / 0.16));
    for (let i = 0; i <= nx; i++) { out.push([-w / 2 + (i / nx) * w, h / 2]); out.push([-w / 2 + (i / nx) * w, -h / 2]); }
    for (let j = 1; j < ny; j++) { out.push([-w / 2, -h / 2 + (j / ny) * h]); out.push([w / 2, -h / 2 + (j / ny) * h]); }
    return out;
  }, [w, h]);
  const bulbGeo = useMemo(() => new THREE.SphereGeometry(0.026, 10, 8), []);
  useFrame((s) => {
    const k = Math.floor(s.clock.elapsedTime * 3) % 2;
    const alarm = sceneFx.alarm;
    bulbA.emissiveIntensity = (k ? 2.6 : 0.7) * (1 - alarm * 0.6);
    bulbB.emissiveIntensity = (k ? 0.7 : 2.6) * (1 - alarm * 0.6);
    bulbA.emissive.set(alarm > 0.05 ? PAL.alarm : '#ffd28a'); bulbB.emissive.copy(bulbA.emissive);
  });
  return (
    <group position={[x, y, WALL_Z + 0.02]}>
      <mesh position={[0, 0, -0.01]} material={signMat}><boxGeometry args={[w + 0.12, h + 0.12, 0.05]} /></mesh>
      {/* no bulbs: a quiet plaque reads as a vault, chasing lights read as a disco */}
    </group>
  );
}

export const Wall = memo(function Wall({ mats, breath, beat }: {
  mats: HeistMaterials; breath: React.MutableRefObject<number[]>; beat: React.MutableRefObject<number>;
}) {
  const wallGeo = useMemo(buildWall, []);
  const wainsGeo = useMemo(() => {
    // raised panel outlines along the wainscot
    const parts: THREE.BufferGeometry[] = [], pw = 0.9, b = 0.025;
    for (let x = WALL.l + 0.2; x + pw < WALL.r; x += pw + 0.18) {
      const cx = x + pw / 2, cy = WALL.wains / 2 - 0.02, ph = WALL.wains - 0.22;
      parts.push(
        new THREE.BoxGeometry(pw, b, 0.012).translate(cx, cy + ph / 2, 0.066), new THREE.BoxGeometry(pw, b, 0.012).translate(cx, cy - ph / 2, 0.066),
        new THREE.BoxGeometry(b, ph, 0.012).translate(cx - pw / 2, cy, 0.066), new THREE.BoxGeometry(b, ph, 0.012).translate(cx + pw / 2, cy, 0.066),
      );
    }
    return mergeGeometries(parts)!;
  }, []);
  const { frames, recess } = useMemo(frameGeo, []);
  const archCopper = useMemo(() => archFrameGeo(0.0, 0.09, 0.05, WALL_Z), []);
  const archCream = useMemo(() => archFrameGeo(-0.09, 0.12, 0.03, WALL_Z), []);
  const meterMat = useMemo(() => new THREE.MeshStandardMaterial({ map: meterTexture(), roughness: 0.5 }), []);
  const needle = useRef<THREE.Group>(null);
  const bulbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a0d18', emissive: new THREE.Color(PAL.crimson), emissiveIntensity: 0.4, roughness: 0.15, transparent: true, opacity: 0.92, toneMapped: false }), []);
  const bulbGlow = useMemo(() => new THREE.MeshBasicMaterial({ map: glowTexture(), color: PAL.alarm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const beaconMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a1a14', emissive: new THREE.Color(PAL.alarm), emissiveIntensity: 0.1, roughness: 0.2, transparent: true, opacity: 0.9, toneMapped: false }), []);
  const beaconGlow = useMemo(() => new THREE.MeshBasicMaterial({ map: glowTexture(), color: PAL.alarm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ map: spillTexture(), color: PAL.alarm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), []);
  const beams = useRef<THREE.Group>(null);
  const sweep = useRef<THREE.SpotLight>(null);
  const sweepTarget = useMemo(() => new THREE.Object3D(), []);
  const needleA = useRef(0);

  useFrame((s, dt) => {
    const now = s.clock.elapsedTime;
    // breath meter: latest chest sample swings the needle; a catch kicks it hard right
    const b = breath.current; const v = b.length ? b[b.length - 1] : Math.sin(now * 1.4) * 0.3;
    const want = -0.55 + (v + 1) * 0.5 * 1.1 + sceneFx.flare * 0.5;
    needleA.current += (want - needleA.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 8));
    if (needle.current) needle.current.rotation.z = -needleA.current;
    // pulse bulb follows the heartbeat envelope
    const h = Math.max(beat.current, sceneFx.flare * 0.8);
    bulbMat.emissiveIntensity = 0.35 + h * 3.2;
    bulbGlow.opacity = 0.08 + h * 0.6;
    // alarm beacon + sweeping red spot
    const al = sceneFx.alarm;
    beaconMat.emissiveIntensity = 0.15 + al * (3 + Math.sin(now * 20) * 1.2);
    beaconGlow.opacity = al * 0.9;
    const ang = now * 5.5;
    sweepTarget.position.set(Math.sin(ang) * 4.2, 1.4 + Math.cos(ang * 0.5) * 0.4, -0.2);
    if (sweep.current) sweep.current.intensity = al * 60;
    beamMat.opacity = al * 0.5;
    if (beams.current) { beams.current.visible = al > 0.01; beams.current.rotation.y = ang; }
  });

  const halfBooth = BOOTH.w / 2;
  const boothDepth = BOOTH.back;
  const gridL = GRID.x0 - (GRID.cols / 2) * CELL, gridR = GRID.x0 + (GRID.cols / 2) * CELL;
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 4]} material={mats.floor} receiveShadow>
        <planeGeometry args={[14, 8]} />
      </mesh>
      {/* velvet wall with slot holes and the booth window */}
      <mesh geometry={wallGeo} material={mats.velvet} receiveShadow />
      <mesh geometry={recess} material={mats.recess} />
      <mesh geometry={frames} material={mats.copper} castShadow receiveShadow />
      {/* cream wainscot with a copper rail, crown above */}
      <mesh position={[(WALL.l + WALL.r) / 2, WALL.wains / 2, WALL_Z + 0.03]} material={mats.cream} receiveShadow>
        <boxGeometry args={[WALL.r - WALL.l, WALL.wains, 0.06]} />
      </mesh>
      <mesh position={[(WALL.l + WALL.r) / 2, WALL.wains, WALL_Z + 0.07]} material={mats.copper}>
        <boxGeometry args={[WALL.r - WALL.l, 0.04, 0.05]} />
      </mesh>
      <mesh geometry={wainsGeo} material={mats.crimsonDeep} />
      <mesh position={[(WALL.l + WALL.r) / 2, (WALL.crown + WALL.top) / 2, WALL_Z + 0.04]} material={mats.cream} receiveShadow>
        <boxGeometry args={[WALL.r - WALL.l, WALL.top - WALL.crown, 0.08]} />
      </mesh>
      <mesh position={[(WALL.l + WALL.r) / 2, WALL.crown, WALL_Z + 0.09]} material={mats.copper}><boxGeometry args={[WALL.r - WALL.l, 0.05, 0.06]} /></mesh>
      {/* pilasters */}
      {[gridL - 0.28, (gridR + BOOTH.x - halfBooth) / 2 + 0.02, BOOTH.x + halfBooth + 0.42, -4.4, 4.9].map((x) => (
        <group key={x} position={[x, 0, WALL_Z]}>
          <mesh position={[0, (WALL.wains + WALL.crown) / 2, 0.04]} material={mats.cream} castShadow receiveShadow><boxGeometry args={[0.26, WALL.crown - WALL.wains, 0.08]} /></mesh>
          <mesh position={[0, (WALL.wains + WALL.crown) / 2, 0.085]} material={mats.copper}><boxGeometry args={[0.05, WALL.crown - WALL.wains - 0.2, 0.012]} /></mesh>
        </group>
      ))}
      {/* booth window: cream outer molding, copper inner arch, sill */}
      <mesh geometry={archCream} material={mats.cream} castShadow receiveShadow />
      <mesh geometry={archCopper} material={mats.copper} position={[0, 0, 0.02]} />
      <mesh position={[BOOTH.x, BOOTH.bottom - 0.02, 0.1]} material={mats.copper} castShadow><boxGeometry args={[BOOTH.w + 0.3, 0.05, 0.24]} /></mesh>
      {/* booth room behind the window */}
      <group>
        <mesh position={[BOOTH.x, 1.8, boothDepth]} material={mats.wallpaper} receiveShadow><planeGeometry args={[2.6, 2.6]} /></mesh>
        <mesh position={[BOOTH.x - 1.05, 1.8, boothDepth / 2]} rotation={[0, Math.PI / 2, 0]} material={mats.wallpaper}><planeGeometry args={[-boothDepth, 2.6]} /></mesh>
        <mesh position={[BOOTH.x + 1.05, 1.8, boothDepth / 2]} rotation={[0, -Math.PI / 2, 0]} material={mats.wallpaper}><planeGeometry args={[-boothDepth, 2.6]} /></mesh>
        <mesh position={[BOOTH.x, 3.0, boothDepth / 2]} rotation={[Math.PI / 2, 0, 0]} material={mats.velvetPlain}><planeGeometry args={[2.2, -boothDepth]} /></mesh>
        {/* curtain swags at the window's top corners */}
        {[-1, 1].map((sx) => (
          <mesh key={sx} position={[BOOTH.x + sx * (halfBooth - 0.12), 2.05, -0.12]} material={mats.velvetPlain} castShadow>
            <cylinderGeometry args={[0.1, 0.16, 1.5, 12, 1, false]} />
          </mesh>
        ))}
        {/* counter */}
        <mesh position={[BOOTH.x, BOOTH.bottom - 0.05, -0.35]} material={mats.crimson} receiveShadow castShadow><boxGeometry args={[BOOTH.w + 0.2, 0.08, 0.7]} /></mesh>
        <mesh position={[BOOTH.x, 0.55, -0.45]} material={mats.cream}><boxGeometry args={[BOOTH.w + 0.2, 0.8, 0.5]} /></mesh>
      </group>

      <Marquee text="THE VAULT" x={GRID.x0} y={3.05} w={1.9} h={0.34} />
      <Marquee text="THE FENCE" x={BOOTH.x} y={3.15} w={1.5} h={0.3} />

      {/* his breath meter and your pulse bulb, either side under the window */}
      <group position={[BOOTH.x - 0.42, 0.81, WALL_Z + 0.03]}>
        <mesh material={mats.copper} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.15, 0.15, 0.04, 32]} /></mesh>
        <mesh material={meterMat} position={[0, 0, 0.022]}><circleGeometry args={[0.13, 32]} /></mesh>
        <group ref={needle} position={[0, -0.03, 0.03]}>
          <mesh material={mats.crimson} position={[0, 0.05, 0]}><boxGeometry args={[0.008, 0.1, 0.004]} /></mesh>
        </group>
      </group>
      <group position={[BOOTH.x + 0.42, 0.81, WALL_Z + 0.03]}>
        <mesh material={mats.copper} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.1, 0.11, 0.04, 24]} /></mesh>
        <mesh material={bulbMat} position={[0, 0, 0.03]}><sphereGeometry args={[0.075, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <mesh material={bulbGlow} position={[0, 0, 0.1]}><planeGeometry args={[0.5, 0.5]} /></mesh>
      </group>

      {/* alarm beacon on top of the middle pilaster, and its sweeping light */}
      <group position={[(gridR + BOOTH.x - halfBooth) / 2 + 0.02, 3.3, WALL_Z + 0.2]}>
        <mesh material={mats.copper}><cylinderGeometry args={[0.13, 0.15, 0.06, 20]} /></mesh>
        <mesh material={beaconMat} position={[0, 0.1, 0]}><sphereGeometry args={[0.11, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <mesh material={beaconGlow} position={[0, 0.1, 0.12]}><planeGeometry args={[1.1, 1.1]} /></mesh>
        <group ref={beams} position={[0, 0.1, 0]} visible={false}>
          <mesh geometry={beamGeo} material={beamMat} rotation={[0, 0, Math.PI / 2 - 0.25]} />
          <mesh geometry={beamGeo} material={beamMat} rotation={[0, 0, -Math.PI / 2 + 0.25]} />
        </group>
      </group>
      <primitive object={sweepTarget} />
      <spotLight ref={sweep} position={[1.3, 3.4, 1.6]} target={sweepTarget} angle={0.38} penumbra={0.5} intensity={0} distance={12} decay={1.4} color={PAL.alarm} castShadow={false} />
    </group>
  );
});
