// The vault room: terrazzo floor, concrete walls, round vault door ajar, wall of deposit boxes, wall clock.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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

function VaultDoor({ mats }: { mats: VaultMaterials }) {
  const bolts = 14;
  const ring = useMemo(() => {
    const s = new THREE.Shape(); s.absarc(0, 0, DOOR.r + 0.2, 0, Math.PI * 2, false);
    const h = new THREE.Path(); h.absarc(0, 0, DOOR.r + 0.01, 0, Math.PI * 2, true); s.holes.push(h);
    return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 96 });
  }, []);
  const open = THREE.MathUtils.degToRad(48);
  return (
    <group position={[DOOR.x, DOOR.y, ROOM.back]}>
      {/* frame ring */}
      <mesh geometry={ring} material={mats.steelBrushed} castShadow receiveShadow />
      {/* tunnel into the vault, with a dim warm glow deep inside */}
      <mesh position={[0, 0, -0.6]} rotation={[Math.PI / 2, 0, 0]} material={mats.concrete}>
        <cylinderGeometry args={[DOOR.r + 0.01, DOOR.r + 0.01, 1.2, 64, 1, true]} />
      </mesh>
      <mesh position={[0, 0, -1.2]} material={mats.concrete}>
        <circleGeometry args={[DOOR.r + 0.02, 48]} />
      </mesh>
      <pointLight position={[0.2, 0.3, -0.9]} intensity={0.25} distance={2.5} color="#ffb46e" />
      {/* the door, hinged on the right of the ring, swung toward the room */}
      <group position={[DOOR.r + 0.12, 0, 0.12]} rotation={[0, open, 0]}>
        <group position={[-(DOOR.r + 0.12), 0, 0.18]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.steel} castShadow receiveShadow>
            <cylinderGeometry args={[DOOR.r + 0.08, DOOR.r + 0.08, 0.16, 96]} />
          </mesh>
          <mesh position={[0, 0, -0.28]} rotation={[Math.PI / 2, 0, 0]} material={mats.steelBrushed} castShadow>
            <cylinderGeometry args={[DOOR.r - 0.04, DOOR.r - 0.02, 0.42, 96]} />
          </mesh>
          {Array.from({ length: bolts }, (_, i) => {
            const a = (i / bolts) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * (DOOR.r + 0.04), Math.sin(a) * (DOOR.r + 0.04), -0.3]} rotation={[0, 0, a + Math.PI / 2]} material={mats.steelBrushed} castShadow>
                <cylinderGeometry args={[0.045, 0.045, 0.16, 24]} />
              </mesh>
            );
          })}
          {/* face rings */}
          {[0.95, 0.72, 0.42].map((r) => (
            <mesh key={r} position={[0, 0, 0.085]} material={mats.steelBrushed}>
              <torusGeometry args={[r, 0.012, 12, 96]} />
            </mesh>
          ))}
          {/* hub + three spoke wheel + brass combination dial */}
          <mesh position={[0, 0, 0.11]} rotation={[Math.PI / 2, 0, 0]} material={mats.steelBrushed} castShadow>
            <cylinderGeometry args={[0.12, 0.14, 0.06, 48]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation={[0, 0, (i / 3) * Math.PI * 2 + 0.3]}>
              <mesh position={[0, 0.24, 0.2]} material={mats.steelBrushed} castShadow>
                <cylinderGeometry args={[0.018, 0.018, 0.36, 16]} />
              </mesh>
              <mesh position={[0, 0.43, 0.2]} material={mats.brassPolished} castShadow>
                <sphereGeometry args={[0.035, 20, 16]} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]} material={mats.steelBrushed}>
            <cylinderGeometry args={[0.05, 0.05, 0.1, 24]} />
          </mesh>
          <mesh position={[0, 0.58, 0.1]} rotation={[Math.PI / 2, 0, 0]} material={mats.brass} castShadow>
            <cylinderGeometry args={[0.1, 0.11, 0.04, 48]} />
          </mesh>
          <mesh position={[0, 0.58, 0.125]} rotation={[Math.PI / 2, 0, 0]} material={mats.blackEnamel}>
            <cylinderGeometry args={[0.07, 0.07, 0.012, 40]} />
          </mesh>
        </group>
      </group>
      {/* massive hinge */}
      <mesh position={[DOOR.r + 0.16, 0, 0.16]} material={mats.steel} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 1.3, 32]} />
      </mesh>
    </group>
  );
}

function DepositWall({ mats }: { mats: VaultMaterials }) {
  const cols = 15, rows = 10, cw = 0.15, rh = 0.15, gap = 0.008;
  const x0 = 0.95, y0 = 0.32, z = ROOM.back + 0.02;
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
  const doorGeo = useMemo(() => new RoundedBoxGeometry(cw - gap, 1, 0.014, 2, 0.003), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const p = new THREE.Vector3();
    const col = new THREE.Color();
    cells.forEach((c, i) => {
      doors.current!.setMatrixAt(i, m.compose(p.set(c.x, c.y, z + 0.012), q, s.set(1, c.h - gap, 1)));
      col.setHSL(0.11, 0.25, 0.5 + ((i * 37) % 11) / 60);
      doors.current!.setColorAt(i, col);
      holes.current!.setMatrixAt(i, m.compose(p.set(c.x + cw * 0.28, c.y, z + 0.0205), q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), s.set(1, 1, 1)));
      plates.current!.setMatrixAt(i, m.compose(p.set(c.x - cw * 0.12, c.y + c.h * 0.22, z + 0.0198), new THREE.Quaternion(), s.set(1, 1, 1)));
    });
    for (const r of [doors, holes, plates]) { r.current!.instanceMatrix.needsUpdate = true; r.current!.computeBoundingSphere(); }
    if (doors.current!.instanceColor) doors.current!.instanceColor.needsUpdate = true;
  }, [cells]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9cfb4', roughness: 0.5, metalness: 0.3 }), []);
  return (
    <group>
      <mesh position={[x0 + (cols * cw) / 2, y0 + (rows * rh) / 2, z]} material={mats.steel} receiveShadow>
        <boxGeometry args={[cols * cw + 0.06, rows * rh + 0.06, 0.03]} />
      </mesh>
      <instancedMesh ref={doors} args={[doorGeo, mats.brass, cells.length]} castShadow receiveShadow />
      <instancedMesh ref={holes} args={[undefined, mats.blackEnamel, cells.length]}>
        <cylinderGeometry args={[0.009, 0.009, 0.003, 16]} />
      </instancedMesh>
      <instancedMesh ref={plates} args={[undefined, plateMat, cells.length]}>
        <boxGeometry args={[0.04, 0.016, 0.002]} />
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
      <AimedSpot position={[2.1, 3.1, ROOM.back + 1.3]} target={[2.1, 1.0, ROOM.back]} angle={0.75} penumbra={0.9} intensity={0.9} distance={6} color="#d8dde6" />
    </group>
  );
});

export { DOOR };
