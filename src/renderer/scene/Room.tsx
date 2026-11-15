// The vault room: terrazzo floor, concrete walls, round vault door ajar, wall of deposit boxes, wall clock.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOM } from './layout';
import type { VaultMaterials } from './materials';
import { clockDialTexture } from './textures';
import { AimedSpot } from './AimedSpot';

const DOOR = { x: -2.25, y: 1.22, r: 1.02 };

function BackWall({ mats }: { mats: VaultMaterials }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(ROOM.left, 0); s.lineTo(ROOM.right, 0); s.lineTo(ROOM.right, ROOM.ceil); s.lineTo(ROOM.left, ROOM.ceil); s.closePath();
    const hole = new THREE.Path();
    hole.absarc(DOOR.x, DOOR.y, DOOR.r + 0.06, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ShapeGeometry(s, 64);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 7.2, uv.getY(i) / 3.3);
    return g;
  }, []);
  return <mesh geometry={geo} position={[0, 0, ROOM.back]} material={mats.concrete} receiveShadow />;
}

function mergedDoorParts(): { steel: THREE.BufferGeometry; bright: THREE.BufferGeometry } {
  const steel: THREE.BufferGeometry[] = [];
  const bright: THREE.BufferGeometry[] = [];
  const P = (g: THREE.BufferGeometry, m: THREE.Matrix4, list = steel) => { const n = g.index ? g.toNonIndexed() : g; n.applyMatrix4(m); for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); list.push(n); };
  const M = (p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1));
  // stepped, bevelled door plug: lathe profile (radius, depth) turned about the door axis
  const R = DOOR.r;
  const prof = [
    new THREE.Vector2(0.0, 0.2), new THREE.Vector2(0.16, 0.2), new THREE.Vector2(0.17, 0.19), new THREE.Vector2(0.45, 0.19), new THREE.Vector2(0.47, 0.17),
    new THREE.Vector2(0.74, 0.17), new THREE.Vector2(0.76, 0.15), new THREE.Vector2(R + 0.05, 0.15), new THREE.Vector2(R + 0.08, 0.12),
    new THREE.Vector2(R + 0.08, 0.03), new THREE.Vector2(R - 0.03, 0.0), new THREE.Vector2(R - 0.03, -0.42), new THREE.Vector2(R - 0.07, -0.45), new THREE.Vector2(0, -0.45),
  ];
  P(new THREE.LatheGeometry(prof, 96), M([0, 0, 0], [Math.PI / 2, 0, 0]));
  // locking bolts: round-nosed steel pins around the plug
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    P(new THREE.CapsuleGeometry(0.038, 0.12, 6, 16), M([Math.cos(a) * (R - 0.0), Math.sin(a) * (R - 0.0), -0.25], [0, 0, a - Math.PI / 2]), bright);
  }
  // face bolt heads on the outer ring
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    P(new THREE.SphereGeometry(0.016, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M([Math.cos(a) * (R - 0.08), Math.sin(a) * (R - 0.08), 0.15], [Math.PI / 2, 0, 0]), bright);
  }
  // hub, spoked handwheel
  P(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 48), M([0, 0, 0.23], [Math.PI / 2, 0, 0]), bright);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    P(new THREE.CylinderGeometry(0.02, 0.016, 0.36, 16), M([Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0.3], [0, 0, -a]), bright);
    P(new THREE.SphereGeometry(0.034, 20, 14), M([Math.sin(a) * 0.4, Math.cos(a) * 0.4, 0.3]), bright);
  }
  P(new THREE.TorusGeometry(0.4, 0.016, 10, 72), M([0, 0, 0.3]), bright);
  return { steel: mergeGeometries(steel)!, bright: mergeGeometries(bright)! };
}

function VaultDoor({ mats }: { mats: VaultMaterials }) {
  const ring = useMemo(() => {
    const s = new THREE.Shape(); s.absarc(0, 0, DOOR.r + 0.22, 0, Math.PI * 2, false);
    const h = new THREE.Path(); h.absarc(0, 0, DOOR.r + 0.01, 0, Math.PI * 2, true); s.holes.push(h);
    return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 4, curveSegments: 96 });
  }, []);
  const door = useMemo(() => mergedDoorParts(), []);
  const open = THREE.MathUtils.degToRad(48);
  return (
    <group position={[DOOR.x, DOOR.y, ROOM.back]}>
      <mesh geometry={ring} material={mats.steel} receiveShadow />
      <mesh position={[0, 0, -0.6]} rotation={[Math.PI / 2, 0, 0]} material={mats.concrete}>
        <cylinderGeometry args={[DOOR.r + 0.01, DOOR.r + 0.01, 1.2, 64, 1, true]} />
      </mesh>
      <mesh position={[0, 0, -1.19]}><circleGeometry args={[DOOR.r * 0.9, 40]} /><meshBasicMaterial color="#14171b" /></mesh>
      <group position={[DOOR.r + 0.12, 0, 0.12]} rotation={[0, open, 0]}>
        <group position={[-(DOOR.r + 0.12), 0, 0.05]}>
          <mesh geometry={door.steel} material={mats.steel} receiveShadow />
          <mesh geometry={door.bright} material={mats.steelBrushed} />
          <mesh position={[0, 0.58, 0.21]} rotation={[Math.PI / 2, 0, 0]} material={mats.brassDark}>
            <cylinderGeometry args={[0.1, 0.11, 0.04, 48]} />
          </mesh>
        </group>
      </group>
      <mesh position={[DOOR.r + 0.16, 0, 0.16]} material={mats.steel}>
        <cylinderGeometry args={[0.07, 0.07, 1.3, 32]} />
      </mesh>
    </group>
  );
}

function DepositWall({ mats }: { mats: VaultMaterials }) {
  const cols = 15, rows = 10, cw = 0.15, rh = 0.15;
  const x0 = 0.95, y0 = 0.32, z = ROOM.back + 0.03;
  const frames = useRef<THREE.InstancedMesh>(null);
  const doors = useRef<THREE.InstancedMesh>(null);
  const holes = useRef<THREE.InstancedMesh>(null);
  const plates = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(() => {
    const out: { x: number; y: number; h: number }[] = [];
    for (let c = 0; c < cols; c++) {
      let r = 0;
      while (r < rows) {
        const tall = (c * 7 + r * 3) % 9 === 0 && r < rows - 1 ? 2 : 1;
        out.push({ x: x0 + c * cw + cw / 2, y: y0 + r * rh + (tall * rh) / 2, h: tall * rh });
        r += tall;
      }
    }
    return out;
  }, []);
  // a modelled frame (rectangle with a bevelled opening) per cell, a recessed door inside it
  const frameGeo = useMemo(() => {
    const s = new THREE.Shape(); s.moveTo(-cw / 2, -0.5); s.lineTo(cw / 2, -0.5); s.lineTo(cw / 2, 0.5); s.lineTo(-cw / 2, 0.5); s.closePath();
    const h = new THREE.Path(); const iw = cw / 2 - 0.009; h.moveTo(-iw, -0.5 + 0.009); h.lineTo(-iw, 0.5 - 0.009); h.lineTo(iw, 0.5 - 0.009); h.lineTo(iw, -0.5 + 0.009); h.closePath(); s.holes.push(h);
    return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  }, []);
  const doorGeo = useMemo(() => new RoundedBoxGeometry(cw - 0.022, 1, 0.008, 2, 0.002), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const p = new THREE.Vector3();
    const col = new THREE.Color();
    const qx = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    cells.forEach((c, i) => {
      frames.current!.setMatrixAt(i, m.compose(p.set(c.x, c.y, z), q, s.set(1, c.h, 1)));
      doors.current!.setMatrixAt(i, m.compose(p.set(c.x, c.y, z + 0.004), q, s.set(1, c.h - 0.022, 1)));
      col.setHSL(0.1, 0.22, 0.42 + ((i * 37) % 11) / 90);
      doors.current!.setColorAt(i, col);
      holes.current!.setMatrixAt(i, m.compose(p.set(c.x + cw * 0.28, c.y, z + 0.0085), qx, s.set(1, 1, 1)));
      plates.current!.setMatrixAt(i, m.compose(p.set(c.x - cw * 0.14, c.y + c.h * 0.25, z + 0.0085), q, s.set(1, 1, 1)));
    });
    for (const r of [frames, doors, holes, plates]) { r.current!.instanceMatrix.needsUpdate = true; r.current!.computeBoundingSphere(); }
    if (doors.current!.instanceColor) doors.current!.instanceColor.needsUpdate = true;
  }, [cells, frameGeo, doorGeo]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6f6656', roughness: 0.6, metalness: 0.4 }), []);
  return (
    <group>
      <mesh position={[x0 + (cols * cw) / 2, y0 + (rows * rh) / 2, z - 0.01]} material={mats.steel} receiveShadow>
        <boxGeometry args={[cols * cw + 0.06, rows * rh + 0.06, 0.02]} />
      </mesh>
      <instancedMesh ref={frames} args={[frameGeo, mats.brassDark, cells.length]} receiveShadow />
      <instancedMesh ref={doors} args={[doorGeo, mats.brass, cells.length]} receiveShadow />
      <instancedMesh ref={holes} args={[undefined, mats.void, cells.length]}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.002, 12]} />
      </instancedMesh>
      <instancedMesh ref={plates} args={[undefined, plateMat, cells.length]}>
        <boxGeometry args={[0.032, 0.012, 0.0015]} />
      </instancedMesh>
    </group>
  );
}

function WallClock({ mats, heat }: { mats: VaultMaterials; heat: React.MutableRefObject<number> }) {
  const sec = useRef<THREE.Group>(null);
  const min = useRef<THREE.Group>(null);
  const hr = useRef<THREE.Group>(null);
  const tick = useRef({ angle: 0, acc: 0, minute: 41 + 22 / 60 });
  useFrame((_, dt) => {
    const t = tick.current;
    const rate = 1 + heat.current * 1.8; // heat quickens the second hand
    t.acc += dt * rate;
    while (t.acc >= 1) { t.acc -= 1; t.angle += Math.PI / 30; t.minute += 1 / 60; }
    // quartz-less 1950s slave clock: crisp tick with a small overshoot
    const k = Math.min(1, t.acc * 12);
    const over = Math.sin(k * Math.PI) * 0.04 * (1 - k);
    if (sec.current) sec.current.rotation.z = -(t.angle + over);
    if (min.current) min.current.rotation.z = -(t.minute / 60) * Math.PI * 2;
    if (hr.current) hr.current.rotation.z = -((11 + t.minute / 60) / 12) * Math.PI * 2;
  });
  const dial = useMemo(() => clockDialTexture(), []);
  return (
    <group position={[2.05, 2.15, ROOM.back + 0.06]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.brass} castShadow>
        <cylinderGeometry args={[0.215, 0.215, 0.06, 64]} />
      </mesh>
      <mesh position={[0, 0, 0.031]}>
        <circleGeometry args={[0.19, 64]} />
        <meshStandardMaterial map={dial} roughness={0.7} />
      </mesh>
      <group ref={hr} position={[0, 0, 0.036]}>
        <mesh position={[0, 0.045, 0]} material={mats.blackEnamel}><boxGeometry args={[0.016, 0.11, 0.003]} /></mesh>
      </group>
      <group ref={min} position={[0, 0, 0.04]}>
        <mesh position={[0, 0.07, 0]} material={mats.blackEnamel}><boxGeometry args={[0.011, 0.16, 0.003]} /></mesh>
      </group>
      <group ref={sec} position={[0, 0, 0.044]}>
        <mesh position={[0, 0.06, 0]}><boxGeometry args={[0.003, 0.17, 0.002]} /><meshStandardMaterial color="#9b1a12" roughness={0.5} /></mesh>
        <mesh position={[0, 0.135, 0]}><circleGeometry args={[0.012, 24]} /><meshStandardMaterial color="#9b1a12" roughness={0.5} /></mesh>
      </group>
      <mesh position={[0, 0, 0.05]} material={mats.blackEnamel}><circleGeometry args={[0.008, 16]} /></mesh>
    </group>
  );
}

export const Room = memo(function Room({ mats, heat }: { mats: VaultMaterials; heat: React.MutableRefObject<number> }) {
  const w = ROOM.right - ROOM.left;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1]} material={mats.terrazzo} receiveShadow>
        <planeGeometry args={[w, 8]} />
      </mesh>
      {/* burn slot in the floor behind the banker */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -2.9]} material={mats.void}>
        <planeGeometry args={[0.5, 0.16]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, -2.9]} material={mats.brassDark}>
        <ringGeometry args={[0.28, 0.3, 4, 1, Math.PI / 4]} />
      </mesh>
      <BackWall mats={mats} />
      <mesh position={[ROOM.left, ROOM.ceil / 2, -1]} rotation={[0, Math.PI / 2, 0]} material={mats.paintedWall} receiveShadow>
        <planeGeometry args={[8, ROOM.ceil]} />
      </mesh>
      <mesh position={[ROOM.right, ROOM.ceil / 2, -1]} rotation={[0, -Math.PI / 2, 0]} material={mats.paintedWall} receiveShadow>
        <planeGeometry args={[8, ROOM.ceil]} />
      </mesh>
      <mesh position={[0, ROOM.ceil, -1]} rotation={[Math.PI / 2, 0, 0]} material={mats.concrete}>
        <planeGeometry args={[w, 8]} />
      </mesh>
      {/* skirting band */}
      <mesh position={[0, 0.06, ROOM.back + 0.01]} material={mats.steel}><boxGeometry args={[w, 0.12, 0.02]} /></mesh>
      <VaultDoor mats={mats} />
      <DepositWall mats={mats} />
      <WallClock mats={mats} heat={heat} />
      {/* grazing ceiling light on the deposit wall */}
    </group>
  );
});

export { DOOR };
