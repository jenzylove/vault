// One machined brass safe deposit box. Animates purely from props (state + kind) with timed transitions.
import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOX, TABLE_Y, boxSlot, GLASS_Z } from './layout';
import type { SceneBox, SceneBoxKind } from './types';
import type { VaultMaterials } from './materials';
import { barStampTexture, coinFaceTexture, plateTexture, softSpriteTexture } from './textures';
import { sceneFx } from './fx';
import { Smoke, SmokeHandle } from './Smoke';
import { boxGeometries, barGeo, barStampGeo, coinGeo, springGeo, jawGeo, FLOOR, HINGE_Y, HINGE_Z, PLATE } from './boxGeometry';

const { w: W, h: H, d: D } = BOX;
const deg = THREE.MathUtils.degToRad;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const cradleGeo = new RoundedBoxGeometry(W + 0.014, 0.0014, D + 0.014, 2, 0.0006);

// shared content materials (created lazily from the shared gold)
let contentMats: { coin: THREE.Material[]; stamp: THREE.MeshStandardMaterial } | null = null;
function getContentMats(mats: VaultMaterials) {
  if (!contentMats) {
    const face = mats.gold.clone(); face.bumpMap = coinFaceTexture(); face.bumpScale = 1.5;
    const stamp = mats.gold.clone(); stamp.bumpMap = barStampTexture(); stamp.bumpScale = -1.5; stamp.roughness = 0.32;
    contentMats = { coin: [mats.gold, face, face], stamp };
  }
  return contentMats;
}

function coinLayout(seed: number, n: number) {
  const out: { p: [number, number, number]; r: [number, number, number] }[] = [];
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const stacked = i < 2;
    out.push({
      p: [stacked ? -0.012 : (r() - 0.5) * (W - 0.03), FLOOR + 0.001 + (stacked ? i * 0.002 : 0.0004), stacked ? 0.008 : (r() - 0.5) * (D - 0.035)],
      r: [stacked ? 0 : (r() - 0.5) * 0.25, r() * 6, stacked ? 0 : (r() - 0.5) * 0.25],
    });
  }
  return out;
}

function Contents({ kind, mats, seed, jaws }: { kind: SceneBoxKind; mats: VaultMaterials; seed: number; jaws: React.RefObject<THREE.Group> }) {
  const cm = getContentMats(mats);
  const coins = useMemo(() => coinLayout(seed, kind === 'big' ? 2 : 4), [seed, kind]);
  if (kind === 'trap') {
    // cocked steel spring jaws on a base plate, pan trigger in the middle
    return (
      <group position={[0, FLOOR, 0.002]}>
        <mesh position={[0, 0.001, 0]} material={mats.steel} castShadow receiveShadow>
          <boxGeometry args={[W - 0.016, 0.002, D - 0.024]} />
        </mesh>
        <mesh geometry={springGeo} material={mats.steelBrushed} position={[0.022, 0.002, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow />
        <mesh position={[0, 0.003, 0]} material={mats.steelBrushed} castShadow>
          <cylinderGeometry args={[0.009, 0.009, 0.0012, 24]} />
        </mesh>
        <group ref={jaws}>
          <group name="jawA" position={[0, 0.003, 0]}><mesh geometry={jawGeo} material={mats.steel} castShadow /></group>
          <group name="jawB" position={[0, 0.003, 0]} rotation={[0, Math.PI, 0]}><mesh geometry={jawGeo} material={mats.steel} castShadow /></group>
        </group>
      </group>
    );
  }
  return (
    <group>
      {kind === 'big' && (
        <group position={[0.004, FLOOR, -0.006]}>
          {[[-0.008, 0.00475, -0.0095, 0], [-0.008, 0.00475, 0.0075, 0], [-0.008, 0.01425, -0.001, 0.1]].map(([x, y, z, ry], i) => (
            <group key={i} position={[x, y, z]} rotation={[0, ry, 0]}>
              <mesh geometry={barGeo} material={mats.gold} castShadow receiveShadow />
              <mesh geometry={barStampGeo} material={cm.stamp} position={[0, 0.0048, 0]} rotation={[-Math.PI / 2, 0, 0]} />
            </group>
          ))}
        </group>
      )}
      {coins.map((c, i) => (
        <mesh key={i} geometry={coinGeo} material={cm.coin} position={kind === 'big' ? [0.026, c.p[1], c.p[2] * 0.5] : c.p} rotation={c.r} castShadow receiveShadow />
      ))}
    </group>
  );
}

export const Box = memo(function Box({ index, box, isActive, peekContents, mats, onClick }: {
  index: number; box: SceneBox; isActive: boolean; peekContents: SceneBoxKind | null; mats: VaultMaterials; onClick?: (id: number) => void;
}) {
  const geo = boxGeometries();
  const slot = useMemo(() => boxSlot(index), [index]);
  const root = useRef<THREE.Group>(null);
  const lid = useRef<THREE.Group>(null);
  const contents = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const smoke = useRef<SmokeHandle>(null);
  const jaws = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  // slight per-box variation: tarnish tone, smudge placement, wear
  const brass = useMemo(() => {
    const m = mats.brass.clone();
    const h = ((box.id * 37) % 11) / 10 - 0.5;
    m.color.offsetHSL(h * 0.012, h * 0.06, h * 0.05);
    m.roughness = mats.brass.roughness * (0.9 + ((box.id * 13) % 7) / 30);
    return m;
  }, [mats.brass, box.id]);
  const uvOffset = useMemo(() => new THREE.Vector2(((box.id * 0.37) % 1), ((box.id * 0.61) % 1)), [box.id]);
  useMemo(() => {
    // per-box UV shift so fingerprints don't repeat box to box
    if (brass.roughnessMap) { brass.roughnessMap = brass.roughnessMap.clone(); brass.roughnessMap.offset.copy(uvOffset); brass.roughnessMap.needsUpdate = true; }
  }, [brass, uvOffset]);
  const plate = useMemo(() => plateTexture(box.id), [box.id]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate, bumpMap: plate, bumpScale: -2, color: '#a88a55', metalness: 0.7, roughness: 0.42 }), [plate]);
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: softSpriteTexture(), color: '#ffc46a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), []);

  const anim = useRef({ state: box.state, since: -1e9, lid: 0, off: new THREE.Vector3(), tilt: 0, glow: 0, smoked: false, jaw: 0 });
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), end: new THREE.Vector3() }), []);

  const shownKind: SceneBoxKind | null =
    box.state === 'peeking' ? (peekContents ?? box.kind ?? null)
      : box.state === 'opened-treasure' || box.state === 'opened-trap' ? (box.kind ?? (box.state === 'opened-trap' ? 'trap' : 'small'))
        : null;

  useFrame((st, dt) => {
    const a = anim.current;
    const now = st.clock.elapsedTime;
    const env = mats.brass.envMap;
    if (env && brass.envMap !== env) {
      for (const m of [brass, plateMat, ...(contentMats ? [contentMats.stamp, contentMats.coin[1] as THREE.MeshStandardMaterial] : [])]) {
        m.envMap = env; m.envMapIntensity = m === plateMat ? 0.6 : m === brass ? mats.brass.envMapIntensity : mats.gold.envMapIntensity; m.needsUpdate = true;
      }
    }
    if (a.state !== box.state) { a.state = box.state; a.since = now; a.smoked = false; if (box.state === 'burned') { sceneFx.pullTime = now + 0.3; sceneFx.pullX = slot.pos.x * 0.4; } }
    const t = now - a.since;
    const k = 1 - Math.exp(-dt * 9);
    let lidT = 0, offZ = 0, offY = 0, tilt = 0, glowT = 0, jawT = 0;
    let world: THREE.Vector3 | null = null; let worldRot = slot.rotY; let hidden = false;
    const hoverLift = hover && box.state === 'sealed' && onClick ? 0.004 : 0;

    switch (box.state) {
      case 'sealed': lidT = 0; offY = hoverLift; break;
      case 'peeking':
        lidT = deg(70); offZ = 0.15; offY = 0.035; tilt = 0.42;
        glowT = shownKind === 'big' ? 1.0 : shownKind === 'small' ? 0.5 : 0;
        if (shownKind === 'trap' && t > 0.5 && !a.smoked) { a.smoked = true; smoke.current?.burst(now); }
        jawT = 0.04 * Math.max(0, Math.sin(t * 9)) * (t > 0.5 ? 1 : 0); // cocked jaws twitch
        break;
      case 'opened-treasure':
        lidT = deg(105); offZ = 0.06;
        glowT = (shownKind === 'big' ? 1.6 : 0.8) * (1 + 0.4 * Math.exp(-t * 1.5));
        break;
      case 'opened-trap':
        // lid flies open, jaws snap, lid slams shut with a jolt and smoke
        lidT = t < 0.22 ? deg(85) : 0; offZ = 0.03;
        jawT = t > 0.1 ? 1 : 0;
        if (t > 0.24 && !a.smoked) { a.smoked = true; smoke.current?.burst(now); }
        if (t > 0.22 && t < 0.6) offY = Math.abs(Math.sin((t - 0.22) * 40)) * 0.006 * (1 - (t - 0.22) / 0.38);
        break;
      case 'sold': {
        const p = ease(clamp01((t - 0.35) / 2.4));
        world = tmp.v.copy(slot.pos).lerp(tmp.end.set(slot.pos.x * 0.42, TABLE_Y, GLASS_Z - 0.32), p);
        worldRot = slot.rotY * (1 - p);
        break;
      }
      case 'burned': {
        const p1 = ease(clamp01((t - 0.3) / 2.0));
        world = tmp.v.copy(slot.pos).lerp(tmp.end.set(slot.pos.x * 0.4, TABLE_Y, GLASS_Z - 0.5), p1);
        worldRot = slot.rotY * (1 - p1);
        const t2 = t - 2.4;
        if (t2 > 0) {
          world.z -= ease(clamp01(t2 / 0.6)) * 0.42;
          if (t2 > 0.5) world.y -= 4.9 * (t2 - 0.5) * (t2 - 0.5);
          if (t2 > 1.4) hidden = true;
        }
        break;
      }
    }

    const lk = box.state === 'opened-trap' ? 1 - Math.exp(-dt * 45) : box.state === 'peeking' ? 1 - Math.exp(-dt * 3.2) : k * 0.7;
    a.lid += (lidT - a.lid) * lk;
    a.off.z += (offZ - a.off.z) * k * 0.6;
    a.off.y += (offY - a.off.y) * (box.state === 'opened-trap' ? 1 : k);
    a.tilt += (tilt - a.tilt) * k * 0.6;
    a.glow += (glowT - a.glow) * (1 - Math.exp(-dt * 4));
    a.jaw += (jawT - a.jaw) * (1 - Math.exp(-dt * (jawT > a.jaw ? 70 : 6)));

    const g = root.current!;
    if (world) { g.position.copy(world); g.rotation.set(0, worldRot, 0); }
    else {
      tmp.v.set(0, a.off.y, a.off.z).applyAxisAngle(tmp.up, slot.rotY);
      g.position.copy(slot.pos).add(tmp.v);
      g.rotation.set(a.tilt, slot.rotY, 0, 'YXZ');
    }
    g.visible = !hidden;
    if (lid.current) lid.current.rotation.x = -a.lid;
    if (contents.current) contents.current.visible = a.lid > 0.05 || box.state === 'peeking' || box.state === 'opened-trap';
    if (jaws.current) {
      const ang = a.jaw * (Math.PI / 2 - 0.08);
      jaws.current.children[0].rotation.x = -ang;
      jaws.current.children[1].rotation.set(ang, Math.PI, 0);
    }
    const flick = 1 + 0.05 * Math.sin(now * 13 + index) + 0.03 * Math.sin(now * 31);
    const gl = a.glow * flick * Math.min(1, a.lid / deg(30));
    if (glow.current) {
      glow.current.visible = gl > 0.01;
      glowMat.opacity = Math.min(0.3, gl * 0.12);
      glow.current.scale.setScalar(0.06 + gl * 0.02);
    }
    sceneFx.boxGlow[index] = gl;
    g.localToWorld(sceneFx.boxGlowPos[index].set(0, H + 0.03, 0.01));
    if (t < 4.5 || hover) sceneFx.shadowFrames = Math.max(sceneFx.shadowFrames, 2);
    if (isActive) { sceneFx.focus.copy(g.position); sceneFx.focusWeight = 1; }
  });

  const clickable = !!onClick && box.state === 'sealed';
  const handlers = clickable ? {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick!(box.id); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
  } : {};

  return (
    <>
      <mesh geometry={cradleGeo} material={mats.brassDark} position={[slot.pos.x, TABLE_Y + 0.0007, slot.pos.z]} rotation={[0, slot.rotY, 0]} receiveShadow />
      <group ref={root} {...handlers}>
        <mesh geometry={geo.body} material={brass} castShadow receiveShadow />
        <mesh geometry={geo.void} material={mats.void} />
        <mesh geometry={geo.felt} material={mats.velvet} receiveShadow />
        <mesh geometry={geo.plate} material={plateMat} position={[0, PLATE.y, D / 2 + 0.00045]} />
        <group ref={lid} position={[0, HINGE_Y, HINGE_Z]}>
          <mesh geometry={geo.lid} material={brass} castShadow receiveShadow />
          <mesh geometry={geo.lidFelt} material={mats.velvet} />
        </group>
        <group ref={contents} visible={false}>
          {shownKind && <Contents kind={shownKind} mats={mats} seed={box.id} jaws={jaws} />}
        </group>
        {shownKind === 'trap' && <Smoke ref={smoke} origin={[0, H + 0.01, 0.01]} count={18} color="#8f8c87" />}
        <sprite ref={glow} material={glowMat} position={[0, H + 0.03, -0.01]} visible={false} />
      </group>
    </>
  );
});
