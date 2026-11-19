// The practice round's own place on the table: a felt lined walnut tray behind the ten boxes, an engraved
// brass placard, and one labelled box per practice peek with a folded card saying what the banker knows is inside.
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { PRACTICE_TRAY, TABLE_Y, CAMERA_POS, practiceSlot } from './layout';
import type { ScenePracticeBox, SceneBox } from './types';
import type { VaultMaterials } from './materials';
import { Box } from './Box';
import { cardTexture } from './textures';

const ROMAN = ['I', 'II', 'III', 'IV'];
// a practice peek is held up over the ten boxes, toward the player's eye
const PRACTICE_PEEK = { z: 0.36, y: 0.13, tilt: 0.55 };
const KIND_WORD = { trap: 'Trap', small: 'Treasure', big: 'Big treasure' } as const;

function TentCard({ word, pos, rotY }: { word: string; pos: THREE.Vector3; rotY: number }) {
  const map = useMemo(() => cardTexture(word, 'known to the bank'), [word]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), [map]);
  const w = 0.052, h = 0.026;
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* folded card: the front face leans back toward the box, the back leg keeps it standing */}
      <mesh material={mat} position={[0, h * 0.47, 0.004]} rotation={[-0.32, 0, 0]} castShadow receiveShadow>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh material={mat} position={[0, h * 0.47, -0.004]} rotation={[0.32, Math.PI, 0]}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

export const PracticeTray = memo(function PracticeTray({ practice, mats }: { practice: ScenePracticeBox[]; mats: VaultMaterials }) {
  const n = Math.min(4, practice.length);
  const slots = useMemo(() => Array.from({ length: n }, (_, i) => practiceSlot(i, n)), [n]);
  const facing = Math.atan2(CAMERA_POS.x - PRACTICE_TRAY.x, CAMERA_POS.z - PRACTICE_TRAY.z);
  const trayW = Math.max(0.2, n * PRACTICE_TRAY.gap + 0.06);
  const placard = useMemo(() => {
    const m = mats.brassPolished.clone();
    m.map = cardTexture('Practice', 'labelled boxes', '#1a1209', '#c9a45c');
    m.color.set('#ffffff'); m.metalness = 0.75; m.roughness = 0.45;
    return m;
  }, [mats.brassPolished]);
  const root = useRef<THREE.Group>(null);
  const appear = useRef(0);
  useFrame((_, dt) => {
    // the tray slides out from under the deal tray when practice starts
    appear.current = Math.min(1, appear.current + dt * 1.6);
    if (root.current) root.current.position.z = (1 - appear.current) ** 3 * -0.25;
  });
  const boxes: SceneBox[] = useMemo(() => practice.slice(0, n).map((p, i) => ({
    id: 1000 + i, kind: p.kind,
    state: p.state === 'peeking' ? 'peeking' : p.state === 'opened' ? (p.kind === 'trap' ? 'opened-trap' : 'opened-treasure') : 'sealed',
  })), [practice, n]);
  return (
    <group ref={root}>
      <group position={[PRACTICE_TRAY.x, TABLE_Y, PRACTICE_TRAY.z]} rotation={[0, facing, 0]}>
        <RoundedBox args={[trayW, 0.012, 0.2]} radius={0.004} smoothness={2} position={[0, 0.006, 0]} material={mats.walnut} castShadow receiveShadow />
        <mesh position={[0, 0.0122, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.velvet} receiveShadow>
          <planeGeometry args={[trayW - 0.016, 0.184]} />
        </mesh>
        {/* engraved brass placard on the tray's front lip */}
        <mesh position={[0, 0.0065, 0.1006]} material={placard}>
          <planeGeometry args={[0.07, 0.0105]} />
        </mesh>
      </group>
      {boxes.map((b, i) => (
        <group key={b.id}>
          <Box index={10 + i} box={b} isActive={b.state === 'peeking'} peekContents={b.state === 'peeking' ? b.kind ?? null : null} mats={mats} slot={slots[i]} label={ROMAN[i]} peekPose={PRACTICE_PEEK} />
          <TentCard word={KIND_WORD[practice[i].kind]} pos={new THREE.Vector3(slots[i].pos.x, slots[i].pos.y, slots[i].pos.z).add(new THREE.Vector3(0, 0, 0.078).applyAxisAngle(new THREE.Vector3(0, 1, 0), slots[i].rotY))} rotY={slots[i].rotY} />
        </group>
      ))}
    </group>
  );
});
