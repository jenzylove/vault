// One brass safe deposit casket. Animates purely from props (state + kind) with timed transitions.
import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOX, TABLE_Y, boxSlot, GLASS_Z } from './layout';
import type { SceneBox, SceneBoxKind } from './types';
import type { VaultMaterials } from './materials';
import { plateTexture, softSpriteTexture } from './textures';
import { sceneFx } from './fx';
import { Smoke, SmokeHandle } from './Smoke';

const { w: W, h: H, d: D, lid: L, wall: WALL } = BOX;
const FLOOR = H * 0.45; // raised velvet tray so contents sit near the rim
const deg = THREE.MathUtils.degToRad;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// ---------- shared geometries ----------
const coinGeo = new THREE.CylinderGeometry(0.0085, 0.0085, 0.0022, 40);
const barGeo = (() => {
  const g = new THREE.BoxGeometry(0.034, 0.011, 0.016, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.84); p.setZ(i, p.getZ(i) * 0.78); }
  g.computeVertexNormals();
  return g;
})();
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private turns: number, private height: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.r, t * this.height, Math.sin(a) * this.r);
  }
}
const springGeo = new THREE.TubeGeometry(new Helix(0.009, 7, 0.04), 280, 0.0011, 8, false);
const hingeGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 0.014, 20);
const keyholeGeo = (() => {
  const s = new THREE.Shape();
  s.absarc(0, 0.0012, 0.0013, 0, Math.PI * 2, false);
  const s2 = new THREE.Shape();
  s2.moveTo(-0.0006, 0.0006); s2.lineTo(0.0006, 0.0006); s2.lineTo(0.0011, -0.0028); s2.lineTo(-0.0011, -0.0028); s2.closePath();
  return new THREE.ShapeGeometry([s, s2], 12);
})();
const cradleGeo = new RoundedBoxGeometry(W + 0.016, 0.0016, D + 0.016, 2, 0.0008);

// deterministic coin layout per box
function coinLayout(seed: number, n: number) {
  const out: { p: [number, number, number]; r: [number, number, number] }[] = [];
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const stack = i < 3 ? i : 0;
    const x = i < 3 ? -0.012 : (r() - 0.5) * (W - 0.03);
    const z = i < 3 ? 0.01 : (r() - 0.5) * (D - 0.035);
    out.push({ p: [x, FLOOR + 0.0012 + stack * 0.0023 + (i >= 3 ? 0.001 : 0), z], r: [i >= 3 ? (r() - 0.5) * 0.35 : 0, r() * 6, i >= 3 ? (r() - 0.5) * 0.35 : 0] });
  }
  return out;
}

function Contents({ kind, mats, seed, springRef }: { kind: SceneBoxKind; mats: VaultMaterials; seed: number; springRef: React.RefObject<THREE.Group> }) {
  const coins = useMemo(() => coinLayout(seed, kind === 'big' ? 5 : 7), [seed, kind]);
  if (kind === 'trap') {
    return (
      <group>
        {/* steel base plate, spring and snapping jaw */}
        <mesh position={[0, FLOOR + 0.0012, 0]} castShadow receiveShadow material={mats.steelBrushed}>
          <boxGeometry args={[W - 0.016, 0.0024, D - 0.02]} />
        </mesh>
        <group ref={springRef} position={[0, FLOOR + 0.0024, 0.006]}>
          <mesh geometry={springGeo} material={mats.steelBrushed} castShadow />
          <mesh position={[0, 0.041, 0]} rotation={[0, 0, 0]} material={mats.steel} castShadow>
            <cylinderGeometry args={[0.013, 0.013, 0.003, 28]} />
          </mesh>
          {/* teeth ring */}
          {Array.from({ length: 10 }, (_, i) => (
            <mesh key={i} position={[Math.cos((i / 10) * Math.PI * 2) * 0.011, 0.0445, Math.sin((i / 10) * Math.PI * 2) * 0.011]} material={mats.steel}>
              <coneGeometry args={[0.0018, 0.005, 6]} />
            </mesh>
          ))}
        </group>
        <mesh position={[0, FLOOR + 0.004, -0.03]} rotation={[0, 0, Math.PI / 2]} material={mats.steelBrushed}>
          <cylinderGeometry args={[0.0014, 0.0014, W - 0.02, 10]} />
        </mesh>
      </group>
    );
  }
  return (
    <group>
      {kind === 'big' && (
        <group position={[0.006, FLOOR, -0.006]}>
          <mesh geometry={barGeo} material={mats.gold} position={[-0.009, 0.0055, -0.011]} castShadow receiveShadow />
          <mesh geometry={barGeo} material={mats.gold} position={[-0.009, 0.0055, 0.008]} castShadow receiveShadow />
          <mesh geometry={barGeo} material={mats.gold} position={[-0.009, 0.0165, -0.0015]} rotation={[0, 0.12, 0]} castShadow receiveShadow />
        </group>
      )}
      {coins.map((c, i) => (
        <mesh key={i} geometry={coinGeo} material={mats.gold} position={kind === 'big' ? [c.p[0] * 0.4 + 0.024, c.p[1], c.p[2]] : c.p} rotation={c.r} castShadow receiveShadow />
      ))}
    </group>
  );
}

export const Box = memo(function Box({ index, box, isActive, peekContents, mats, onClick }: {
  index: number; box: SceneBox; isActive: boolean; peekContents: SceneBoxKind | null; mats: VaultMaterials; onClick?: (id: number) => void;
}) {
  const slot = useMemo(() => boxSlot(index), [index]);
  const root = useRef<THREE.Group>(null);
  const lid = useRef<THREE.Group>(null);
  const contents = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const smoke = useRef<SmokeHandle>(null);
  const spring = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const plate = useMemo(() => plateTexture(box.id), [box.id]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate, bumpMap: plate, bumpScale: -1.2, color: '#d6b46c', metalness: 0.75, roughness: 0.34 }), [plate]);
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: softSpriteTexture(), color: '#ffb84a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), []);

  // transition bookkeeping (elapsed-clock based)
  const anim = useRef({ state: box.state, since: -1e9, lid: 0, off: new THREE.Vector3(), tilt: 0, glow: 0, hidden: false, smoked: false, springPop: 0, lastLid: 0 });
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);

  // what kind is visible inside right now (player-only view)
  const shownKind: SceneBoxKind | null =
    box.state === 'peeking' ? (peekContents ?? box.kind ?? null)
      : box.state === 'opened-treasure' || box.state === 'opened-trap' ? (box.kind ?? (box.state === 'opened-trap' ? 'trap' : 'small'))
        : null;

  useFrame((st, dt) => {
    const a = anim.current;
    const now = st.clock.elapsedTime;
    if (a.state !== box.state) { a.state = box.state; a.since = now; a.smoked = false; if (box.state === 'burned') { sceneFx.pullTime = now + 0.3; sceneFx.pullX = slot.pos.x * 0.4; } }
    const t = now - a.since;
    const k = 1 - Math.exp(-dt * 9);
    let lidT = 0, offZ = 0, offY = 0, tilt = 0, glowT = 0;
    let world: THREE.Vector3 | null = null; let worldRot = slot.rotY; let hidden = false;
    const hoverLift = hover && box.state === 'sealed' && onClick ? 0.004 : 0;

    switch (box.state) {
      case 'sealed':
        lidT = 0; offY = hoverLift; break;
      case 'peeking': {
        lidT = deg(68); offZ = 0.15; offY = 0.035; tilt = 0.42;
        glowT = shownKind === 'big' ? 1.6 : shownKind === 'small' ? 0.8 : 0;
        if (shownKind === 'trap' && t > 0.35 && !a.smoked) { a.smoked = true; smoke.current?.burst(now); a.springPop = 1; }
        break;
      }
      case 'opened-treasure':
        lidT = deg(105); offZ = 0.06; offY = 0.0; tilt = 0.0;
        glowT = (shownKind === 'big' ? 2.4 : 1.2) * (1 + 0.5 * Math.exp(-t * 1.5));
        break;
      case 'opened-trap': {
        // fling open, then snap shut with a jolt and smoke
        if (t < 0.14) lidT = deg(80); else lidT = 0;
        offZ = 0.03; tilt = 0;
        if (t > 0.18 && !a.smoked) { a.smoked = true; smoke.current?.burst(now); a.springPop = 1; }
        if (t > 0.14 && t < 0.5) offY = Math.abs(Math.sin((t - 0.14) * 40)) * 0.006 * (1 - (t - 0.14) / 0.36);
        break;
      }
      case 'sold': {
        lidT = 0;
        const p = ease(clamp01((t - 0.35) / 2.4));
        const end = new THREE.Vector3(slot.pos.x * 0.42, TABLE_Y, GLASS_Z - 0.32);
        world = tmp.v.copy(slot.pos).lerp(end, p);
        worldRot = slot.rotY * (1 - p);
        break;
      }
      case 'burned': {
        lidT = 0;
        const p1 = ease(clamp01((t - 0.3) / 2.0));
        const mid = new THREE.Vector3(slot.pos.x * 0.4, TABLE_Y, GLASS_Z - 0.5);
        world = tmp.v.copy(slot.pos).lerp(mid, p1);
        worldRot = slot.rotY * (1 - p1);
        const t2 = t - 2.4;
        if (t2 > 0) {
          const slide = ease(clamp01(t2 / 0.6));
          world.z -= slide * 0.42;
          if (t2 > 0.5) world.y -= 4.9 * (t2 - 0.5) * (t2 - 0.5);
          if (t2 > 1.4) hidden = true;
        }
        break;
      }
    }

    // lid: the trap snap is near-instant, everything else eased
    const lk = box.state === 'opened-trap' ? 1 - Math.exp(-dt * (t < 0.14 ? 30 : 60)) : box.state === 'peeking' ? 1 - Math.exp(-dt * 3.2) : k * 0.7;
    a.lid += (lidT - a.lid) * lk;
    a.off.z += (offZ - a.off.z) * k * 0.6;
    a.off.y += (offY - a.off.y) * (box.state === 'opened-trap' ? 1 : k);
    a.tilt += (tilt - a.tilt) * k * 0.6;
    a.glow += (glowT - a.glow) * (1 - Math.exp(-dt * 4));
    a.springPop *= Math.exp(-dt * 2.5);

    const g = root.current!;
    if (world) {
      g.position.copy(world);
      g.rotation.set(0, worldRot, 0);
    } else {
      // local offset in the slot frame (+z toward the player)
      tmp.v.set(0, a.off.y, a.off.z).applyAxisAngle(tmp.up, slot.rotY);
      g.position.copy(slot.pos).add(tmp.v);
      g.rotation.set(a.tilt, slot.rotY, 0, 'YXZ');
    }
    g.visible = !hidden;
    if (lid.current) lid.current.rotation.x = -a.lid;
    if (contents.current) contents.current.visible = a.lid > 0.05 || box.state === 'peeking';
    if (spring.current) {
      const pop = a.springPop;
      spring.current.scale.y = 0.55 + 0.45 * Math.min(1, a.lid / deg(40)) + pop * 0.5 * Math.sin(now * 38) * pop;
      spring.current.rotation.z = pop * 0.25 * Math.sin(now * 29);
    }
    // golden light spill above the open casket
    const flick = 1 + 0.06 * Math.sin(now * 13 + index) + 0.04 * Math.sin(now * 31);
    const gl = a.glow * flick * Math.min(1, a.lid / deg(30));
    if (glow.current) {
      glow.current.visible = gl > 0.01;
      glowMat.opacity = Math.min(0.9, gl * 0.38);
      glow.current.scale.setScalar(0.11 + gl * 0.05);
    }
    sceneFx.boxGlow[index] = gl;
    g.localToWorld(sceneFx.boxGlowPos[index].set(0, H + 0.03, 0.01));
    if (isActive) { sceneFx.focus.copy(g.position); sceneFx.focusWeight = 1; }
  });

  const clickable = !!onClick && box.state === 'sealed';
  const handlers = clickable ? {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick!(box.id); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
  } : {};

  const inner = { w: W - 2 * WALL, d: D - 2 * WALL };
  return (
    <>
      {/* recessed cradle on the table marks the slot even after the box is gone */}
      <mesh geometry={cradleGeo} material={mats.brassDark} position={[slot.pos.x, TABLE_Y + 0.0008, slot.pos.z]} rotation={[0, slot.rotY, 0]} receiveShadow />
      <group ref={root} {...handlers}>
        {/* walls */}
        <RoundedBox args={[W, WALL, D]} radius={0.0012} smoothness={2} position={[0, WALL / 2, 0]} material={mats.brass} castShadow receiveShadow />
        <RoundedBox args={[W, H, WALL]} radius={0.0014} smoothness={3} position={[0, H / 2, D / 2 - WALL / 2]} material={mats.brass} castShadow receiveShadow />
        <RoundedBox args={[W, H, WALL]} radius={0.0014} smoothness={3} position={[0, H / 2, -D / 2 + WALL / 2]} material={mats.brass} castShadow receiveShadow />
        <RoundedBox args={[WALL, H, D]} radius={0.0014} smoothness={3} position={[-W / 2 + WALL / 2, H / 2, 0]} material={mats.brass} castShadow receiveShadow />
        <RoundedBox args={[WALL, H, D]} radius={0.0014} smoothness={3} position={[W / 2 - WALL / 2, H / 2, 0]} material={mats.brass} castShadow receiveShadow />
        {/* base skirt */}
        <RoundedBox args={[W + 0.004, 0.005, D + 0.004]} radius={0.0018} smoothness={3} position={[0, 0.0025, 0]} material={mats.brassDark} castShadow receiveShadow />
        {/* velvet lining */}
        <mesh position={[0, FLOOR, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.velvet} receiveShadow>
          <planeGeometry args={[inner.w, inner.d]} />
        </mesh>
        <mesh position={[0, (H + FLOOR) / 2, -D / 2 + WALL + 0.0004]} material={mats.velvet}>
          <planeGeometry args={[inner.w, H - FLOOR]} />
        </mesh>
        <mesh position={[0, (H + FLOOR) / 2, D / 2 - WALL - 0.0004]} rotation={[0, Math.PI, 0]} material={mats.velvet}>
          <planeGeometry args={[inner.w, H - FLOOR]} />
        </mesh>
        {/* engraved number plate + keyhole escutcheon */}
        <mesh position={[0, H * 0.36, D / 2 + 0.0007]} material={plateMat} castShadow>
          <boxGeometry args={[0.032, 0.02, 0.0012]} />
        </mesh>
        <group position={[0, H * 0.78, D / 2 + 0.0008]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.brassPolished} castShadow>
            <cylinderGeometry args={[0.0052, 0.0056, 0.0016, 28]} />
          </mesh>
          <mesh geometry={keyholeGeo} position={[0, 0, 0.0009]} material={mats.void} />
        </group>
        {/* hinges */}
        {[-0.024, 0.024].map((x) => (
          <mesh key={x} geometry={hingeGeo} material={mats.brassPolished} position={[x, H, -D / 2 - 0.0016]} rotation={[0, 0, Math.PI / 2]} castShadow />
        ))}
        {/* lid, hinged at the back edge so it only ever opens toward the player */}
        <group ref={lid} position={[0, H, -D / 2]}>
          <RoundedBox args={[W + 0.003, L, D + 0.003]} radius={0.0028} smoothness={4} position={[0, L / 2, D / 2]} material={mats.brass} castShadow receiveShadow />
          <RoundedBox args={[W - 0.014, 0.0025, D - 0.016]} radius={0.0012} smoothness={2} position={[0, L + 0.0008, D / 2]} material={mats.brass} castShadow />
          <mesh position={[0, -0.0003, D / 2]} rotation={[Math.PI / 2, 0, 0]} material={mats.velvet}>
            <planeGeometry args={[inner.w, inner.d]} />
          </mesh>
          {/* front lip / pull tab */}
          <RoundedBox args={[0.022, 0.006, 0.004]} radius={0.0015} smoothness={2} position={[0, L * 0.4, D + 0.0028]} material={mats.brassPolished} castShadow />
        </group>
        <group ref={contents} visible={false}>
          {shownKind && <Contents kind={shownKind} mats={mats} seed={box.id} springRef={spring} />}
        </group>
        {shownKind === 'trap' && <Smoke ref={smoke} origin={[0, H + 0.01, 0.01]} count={22} color="#a29d93" />}
        <sprite ref={glow} material={glowMat} position={[0, H + 0.025, 0.012]} visible={false} />
      </group>
    </>
  );
});
