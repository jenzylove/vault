// One machined brass safe deposit box. Animates purely from props (state + kind) with timed transitions.
import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX, TABLE_Y, GLASS_Z, boxSlot } from './layout';
import type { SceneBox, SceneBoxKind } from './types';
import type { VaultMaterials } from './materials';
import { barStampTexture, coinFaceTexture, emberTexture, plateTexture, softSpriteTexture } from './textures';
import { sceneFx } from './fx';
import { Smoke, SmokeHandle } from './Smoke';
import { boxGeometries, barGeo, barStampGeo, coinGeo, springGeo, jawGeo, FLOOR, HINGE_Y, HINGE_Z, PLATE } from './boxGeometry';

const { w: W, h: H, d: D } = BOX;
const deg = THREE.MathUtils.degToRad;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const cradleGeo = new RoundedBoxGeometry(W + 0.014, 0.0014, D + 0.014, 2, 0.0006);
const scorchGeo = new THREE.PlaneGeometry(W * 2.6, D * 2.2);
const CHAR_COLOR = new THREE.Color('#1c130c');
const PLATE_COLOR = new THREE.Color('#a88a55');
const ease3 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);

// steel bank straps for a burned box: one band over the top and down both sides, one over the top and down
// the back, and a hasp folded over the front lip where the padlock hangs
const strapGeo = (() => {
  const t = 0.0012, bw = 0.013, o = 0.0009, top = H + o + 0.0028;
  const parts = [
    new THREE.BoxGeometry(W + 2 * o + 2 * t, t, bw).translate(0, top + t / 2, -0.012),
    new THREE.BoxGeometry(t, top, bw).translate(W / 2 + o + t / 2, top / 2, -0.012),
    new THREE.BoxGeometry(t, top, bw).translate(-W / 2 - o - t / 2, top / 2, -0.012),
    new THREE.BoxGeometry(bw, t, D + 2 * o + 2 * t + 0.004).translate(0, top + t * 1.5, 0),
    new THREE.BoxGeometry(bw, top, t).translate(0, top / 2, -D / 2 - o - t / 2 - 0.002),
    new THREE.BoxGeometry(bw, 0.016, t).translate(0, H - 0.004, D / 2 + o + t / 2 + 0.0012),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
})();
const lockBodyGeo = new RoundedBoxGeometry(0.0145, 0.0125, 0.0055, 2, 0.0014);
const lockShackleGeo = new THREE.TorusGeometry(0.0042, 0.00095, 8, 20, Math.PI);
// pooled sealing wax: a soft disc with a pressed rim
const sealGeo = new THREE.LatheGeometry([
  new THREE.Vector2(0, 0.0024), new THREE.Vector2(0.006, 0.0024), new THREE.Vector2(0.0072, 0.0029),
  new THREE.Vector2(0.0086, 0.0019), new THREE.Vector2(0.0095, 0.0006), new THREE.Vector2(0.0098, 0),
], 28).scale(1.35, 1.2, 1.35);

let burnMats: { strap: THREE.MeshStandardMaterial; lock: THREE.MeshStandardMaterial; wax: THREE.MeshStandardMaterial } | null = null;
function getBurnMats(mats: VaultMaterials) {
  if (!burnMats) {
    const strap = mats.steelBrushed.clone(); strap.color.set('#c4c7cc'); strap.roughness = 0.65;
    const lock = mats.steelBrushed.clone(); lock.color.set('#d2d4d8'); lock.roughness = 0.45;
    const wax = new THREE.MeshStandardMaterial({ color: '#8a120c', roughness: 0.32, metalness: 0, emissive: new THREE.Color('#5a0602'), emissiveIntensity: 0.6 });
    burnMats = { strap, lock, wax };
  }
  return burnMats;
}

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

export const Box = memo(function Box({ index, box, isActive, peekContents, mats, onClick, slot: slotOverride, label, peekPose }: {
  index: number; box: SceneBox; isActive: boolean; peekContents: SceneBoxKind | null; mats: VaultMaterials; onClick?: (id: number) => void;
  /** place the box somewhere other than its arc slot (the practice tray) */
  slot?: { pos: THREE.Vector3; rotY: number };
  /** engraved plate text; defaults to the box number */
  label?: string;
  /** how far the box comes toward the player (z), how high it lifts (y) and how far it tips (tilt) while peeking */
  peekPose?: { z: number; y: number; tilt: number };
}) {
  const geo = boxGeometries();
  const slot = useMemo(() => slotOverride ?? boxSlot(index), [index, slotOverride]);
  const baseY = slot.pos.y;
  const bm = getBurnMats(mats);
  const straps = useRef<THREE.Group>(null);
  const scorch = useRef<THREE.Mesh>(null);
  const burnSmoke = useRef<SmokeHandle>(null);
  const scorchMat = useMemo(() => new THREE.MeshBasicMaterial({ map: softSpriteTexture(), color: '#000000', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
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
    // scorch state: base tone kept for the char blend, ember glow through a cracked noise map
    m.userData.base = m.color.clone();
    m.userData.baseRough = m.roughness;
    m.emissive.set('#ff7a2e'); m.emissiveIntensity = 0; m.emissiveMap = emberTexture();
    return m;
  }, [mats.brass, box.id]);
  const uvOffset = useMemo(() => new THREE.Vector2(((box.id * 0.37) % 1), ((box.id * 0.61) % 1)), [box.id]);
  useMemo(() => {
    // per-box UV shift so fingerprints don't repeat box to box
    if (brass.roughnessMap) { brass.roughnessMap = brass.roughnessMap.clone(); brass.roughnessMap.offset.copy(uvOffset); brass.roughnessMap.needsUpdate = true; }
  }, [brass, uvOffset]);
  const plate = useMemo(() => plateTexture(label ?? index + 1), [index, label]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate, bumpMap: plate, bumpScale: -2, color: '#a88a55', metalness: 0.7, roughness: 0.42 }), [plate]);
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: softSpriteTexture(), color: '#ffc46a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), []);

  const anim = useRef({ state: box.state, since: -1e9, lid: 0, off: new THREE.Vector3(), tilt: 0, glow: 0, smoked: false, jaw: 0, char: 0, strap: 0, wisp: -1e9 });
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), end: new THREE.Vector3() }), []);

  const shownKind: SceneBoxKind | null =
    box.state === 'peeking' ? (peekContents ?? box.kind ?? null)
      : box.state === 'opened-treasure' || box.state === 'opened-trap' ? (box.kind ?? (box.state === 'opened-trap' ? 'trap' : 'small'))
        : box.state === 'burned-revealed' ? (box.kind ?? null)
          : null;

  useFrame((st, dt) => {
    const a = anim.current;
    const now = st.clock.elapsedTime;
    const env = mats.brass.envMap;
    if (env && brass.envMap !== env) {
      for (const m of [brass, plateMat, bm.strap, bm.lock, ...(contentMats ? [contentMats.stamp, contentMats.coin[1] as THREE.MeshStandardMaterial] : [])]) {
        m.envMap = env; m.envMapIntensity = m === plateMat ? 0.6 : m === brass ? mats.brass.envMapIntensity : m === bm.strap || m === bm.lock ? 1.1 : mats.gold.envMapIntensity; m.needsUpdate = true;
      }
    }
    if (a.state !== box.state) {
      const fromBurn = a.state === 'burned';
      a.state = box.state; a.since = now; a.smoked = fromBurn && box.state === 'burned-revealed';
      if (box.state === 'burned') { sceneFx.pullTime = now + 0.1; sceneFx.pullX = slot.pos.x * 0.4; }
    }
    const fresh = a.since < -1e8; // mounted already in this state: show the end pose, no replay
    const t = now - a.since;
    const k = 1 - Math.exp(-dt * 9);
    let lidT = 0, offZ = 0, offY = 0, tilt = 0, glowT = 0, jawT = 0;
    let world: THREE.Vector3 | null = null; let worldRot = slot.rotY;
    const hoverLift = hover && box.state === 'sealed' && onClick ? 0.004 : 0;

    switch (box.state) {
      case 'sealed': lidT = 0; offY = hoverLift; break;
      case 'peeking':
        // lifted and tipped toward the eye; kept high so it stays above the prompts at the bottom of the screen
        lidT = deg(72); offZ = peekPose?.z ?? 0.1; offY = peekPose?.y ?? 0.06; tilt = peekPose?.tilt ?? 0.5;
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
      case 'burned':
        // he walked: the box is scorched where it stands, then strapped and sealed by the bank. It stays that way.
        lidT = 0;
        if (!fresh && t > 0.12 && !a.smoked) { a.smoked = true; burnSmoke.current?.burst(now); a.wisp = now; }
        // it keeps smouldering: a thin wisp every few seconds
        if (now - a.wisp > 7 + (index % 3)) { a.wisp = now; burnSmoke.current?.burst(now); }
        if (!fresh && t > 0.05 && t < 0.4) offY = Math.abs(Math.sin(t * 60)) * 0.0025; // a jolt as it catches
        break;
      case 'burned-revealed':
        // the reveal at the end: still scorched, straps off, lid up on what he burned
        lidT = deg(100); offZ = 0.02;
        glowT = shownKind === 'big' ? 0.55 : shownKind === 'small' ? 0.3 : 0;
        jawT = shownKind === 'trap' ? 1 : 0;
        break;
    }

    const lk = box.state === 'opened-trap' ? 1 - Math.exp(-dt * 45) : box.state === 'peeking' ? 1 - Math.exp(-dt * 3.2) : k * 0.7;
    a.lid += (lidT - a.lid) * lk;
    a.off.z += (offZ - a.off.z) * k * 0.6;
    a.off.y += (offY - a.off.y) * (box.state === 'opened-trap' ? 1 : k);
    a.tilt += (tilt - a.tilt) * k * 0.6;
    a.glow += (glowT - a.glow) * (1 - Math.exp(-dt * 4));
    a.jaw += (jawT - a.jaw) * (1 - Math.exp(-dt * (jawT > a.jaw ? 70 : 6)));
    // scorch: the brass chars over a second and a half and never recovers; embers glow, then die out
    const burnt = box.state === 'burned' || box.state === 'burned-revealed';
    const charT = !burnt ? 0 : fresh || box.state === 'burned-revealed' ? 1 : ease3(clamp01((t - 0.1) / 1.6));
    a.char = burnt ? Math.max(a.char, charT) : 0;
    const ember = box.state === 'burned' && !fresh ? clamp01((t - 0.05) * 8) * Math.exp(-Math.max(0, t - 0.4) * 0.8) : 0;
    if (a.char > 0 || brass.emissiveIntensity > 0 || brass.metalness < 1) {
      const flickE = 0.75 + 0.25 * Math.sin(now * 17 + index) * Math.sin(now * 7.3);
      brass.color.copy(brass.userData.base as THREE.Color).lerp(CHAR_COLOR, a.char * 0.93);
      brass.roughness = (brass.userData.baseRough as number) + a.char * 0.5;
      brass.metalness = 1 - a.char * 0.3;
      // after the flare it keeps smouldering: faint live cracks that breathe
      const smoulder = box.state === 'burned' ? a.char * (0.06 + 0.035 * Math.sin(now * 1.3 + index * 2.1)) : 0;
      brass.emissiveIntensity = Math.max(ember * 2.4, smoulder) * flickE;
      plateMat.color.copy(PLATE_COLOR).lerp(CHAR_COLOR, a.char * 0.7);
    }
    // straps drop on after the flare, with a small settle
    const strapT = box.state === 'burned' ? (fresh ? 1 : clamp01((t - 0.9) / 0.35)) : 0;
    a.strap = strapT;
    if (straps.current) {
      straps.current.visible = a.strap > 0.001;
      const settle = box.state === 'burned' && !fresh && t > 1.25 && t < 1.6 ? Math.sin((t - 1.25) * 30) * 0.0012 * (1 - (t - 1.25) / 0.35) : 0;
      straps.current.position.y = (1 - ease(a.strap)) * 0.05 + settle;
    }
    if (scorch.current) { scorch.current.visible = a.char > 0.01; scorchMat.opacity = a.char * 0.92; }

    const g = root.current!;
    if (world) { g.position.copy(world); g.rotation.set(0, worldRot, 0); }
    else {
      tmp.v.set(0, a.off.y, a.off.z).applyAxisAngle(tmp.up, slot.rotY);
      g.position.copy(slot.pos).add(tmp.v);
      g.rotation.set(a.tilt, slot.rotY, 0, 'YXZ');
    }
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
    if (t < 4.5 || hover || ember > 0.01) sceneFx.shadowFrames = Math.max(sceneFx.shadowFrames, 2);
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
      <mesh geometry={cradleGeo} material={mats.brassDark} position={[slot.pos.x, baseY + 0.0007, slot.pos.z]} rotation={[0, slot.rotY, 0]} receiveShadow />
      <mesh ref={scorch} geometry={scorchGeo} material={scorchMat} position={[slot.pos.x, baseY + 0.0016, slot.pos.z]} rotation={[-Math.PI / 2, 0, slot.rotY + 0.4]} visible={false} renderOrder={2} />
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
        <group ref={straps} visible={false}>
          <mesh geometry={strapGeo} material={bm.strap} castShadow />
          <group position={[0, H - 0.017, D / 2 + 0.0062]} rotation={[0.12, 0, 0]}>
            <mesh geometry={lockShackleGeo} material={bm.lock} position={[0, 0.0064, 0]} />
            <mesh geometry={lockBodyGeo} material={bm.lock} castShadow />
          </group>
          <mesh geometry={sealGeo} material={bm.wax} position={[0, H + 0.0062, -0.012]} />
        </group>
        {(box.state === 'burned' || box.state === 'burned-revealed') && <Smoke ref={burnSmoke} origin={[0, H + 0.006, 0]} count={16} color="#3b3733" life={4.2} />}
      </group>
    </>
  );
});
