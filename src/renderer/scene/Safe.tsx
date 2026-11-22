// One safe deposit box. In the wall only its cream door shows; when it is the active box it slides out to the
// middle of the screen, scales up and turns like a prize. On a peek the dial clicks round, the handle drops and the
// door swings open on the loot (or the dud). Everything animates from props.
import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneBoxKind, SceneBoxState } from './types';
import type { HeistMaterials } from './heistMaterials';
import { SAFE, HERO } from './layout';
import { sceneFx } from './fx';
import { PAL, plateTexture, sootTexture, splatTexture, tagTexture, spillTexture, glowTexture } from './heistTextures';

const { w: W, h: H, d: D } = SAFE;
const T = 0.03; // shell thickness
const DW = W - 0.05, DH = H - 0.05, DT = 0.045; // door
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const TAU = Math.PI * 2;
const DOOR_COL = new THREE.Color('#f1e2c6');
const SCORCH_COL = new THREE.Color('#5a3424');

// ---------- shared geometry ----------
/** Merge anything: drop the index and keep only position and normal so mixed primitives always combine. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  }))!;
}
const shellGeo = mergeGeometries([
  new THREE.BoxGeometry(W, H, T).translate(0, 0, -D / 2 + T / 2),
  new THREE.BoxGeometry(T, H, D).translate(-W / 2 + T / 2, 0, 0),
  new THREE.BoxGeometry(T, H, D).translate(W / 2 - T / 2, 0, 0),
  new THREE.BoxGeometry(W, T, D).translate(0, H / 2 - T / 2, 0),
  new THREE.BoxGeometry(W, T, D).translate(0, -H / 2 + T / 2, 0),
])!;
const rimGeo = (() => {
  const b = 0.028, z = D / 2 - 0.004;
  return mergeGeometries([
    new THREE.BoxGeometry(W + 0.012, b, 0.016).translate(0, H / 2 - b / 2, z),
    new THREE.BoxGeometry(W + 0.012, b, 0.016).translate(0, -H / 2 + b / 2, z),
    new THREE.BoxGeometry(b, H, 0.016).translate(-W / 2 + b / 2, 0, z),
    new THREE.BoxGeometry(b, H, 0.016).translate(W / 2 - b / 2, 0, z),
  ])!;
})();
// copper edge trims on the eight back and side edges, corner caps, inset panels and carry handles on the sides
const trimGeo = (() => {
  const b = 0.034, parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(b, b, D - 0.02).translate(sx * (W / 2 - b / 2 + 0.004), sy * (H / 2 - b / 2 + 0.004), -0.01));
    parts.push(new THREE.SphereGeometry(b * 0.75, 10, 8).translate(sx * (W / 2 - 0.004), sy * (H / 2 - 0.004), -D / 2 + 0.01));
  }
  for (const sy of [-1, 1]) parts.push(new THREE.BoxGeometry(W - 0.02, b, b).translate(0, sy * (H / 2 - b / 2 + 0.004), -D / 2 + b / 2 - 0.004));
  for (const sx of [-1, 1]) parts.push(new THREE.BoxGeometry(b, H - 0.02, b).translate(sx * (W / 2 - b / 2 + 0.004), 0, -D / 2 + b / 2 - 0.004));
  // side carry handles
  for (const sx of [-1, 1]) {
    parts.push(new THREE.TorusGeometry(0.06, 0.011, 8, 20, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI / 2).translate(sx * (W / 2 + 0.002), 0.02, 0));
    parts.push(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14).rotateZ(Math.PI / 2).translate(sx * (W / 2 + 0.004), 0.02, 0.06));
    parts.push(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14).rotateZ(Math.PI / 2).translate(sx * (W / 2 + 0.004), 0.02, -0.06));
  }
  // rivet rows along the back
  for (let i = 0; i < 5; i++) for (const sy of [-1, 1]) parts.push(new THREE.SphereGeometry(0.01, 8, 6).translate(-0.2 + i * 0.1, sy * 0.24, -D / 2 - 0.002));
  return merge(parts);
})();
const insetGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) parts.push(new THREE.BoxGeometry(0.006, H - 0.16, D - 0.16).translate(sx * (W / 2 + 0.001), 0, -0.01));
  parts.push(new THREE.BoxGeometry(W - 0.16, H - 0.16, 0.006).translate(0, 0, -D / 2 - 0.001));
  parts.push(new THREE.BoxGeometry(W - 0.16, 0.006, D - 0.16).translate(0, H / 2 + 0.001, -0.01));
  return mergeGeometries(parts)!;
})();
const liningGeo = new THREE.BoxGeometry(W - 2 * T, H - 2 * T, D - T).translate(0, 0, T / 2);
const doorGeo = new RoundedBoxGeometry(DW, DH, DT, 3, 0.014);
const doorInsetGeo = (() => {
  const s = 0.012, iw = DW - 0.07, ih = DH - 0.07;
  return mergeGeometries([
    new THREE.BoxGeometry(iw, s, 0.006).translate(0, ih / 2, 0),
    new THREE.BoxGeometry(iw, s, 0.006).translate(0, -ih / 2, 0),
    new THREE.BoxGeometry(s, ih, 0.006).translate(-iw / 2, 0, 0),
    new THREE.BoxGeometry(s, ih, 0.006).translate(iw / 2, 0, 0),
  ])!;
})();
const dialGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.028, 40).rotateX(Math.PI / 2);
const bezelGeo = new THREE.TorusGeometry(0.093, 0.011, 10, 40);
const hingeGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.1, 14);
const rivetGeo = new THREE.SphereGeometry(0.011, 10, 8);
const leverGeo = mergeGeometries([
  new THREE.CylinderGeometry(0.026, 0.026, 0.03, 18).rotateX(Math.PI / 2),
  new THREE.CylinderGeometry(0.011, 0.011, 0.13, 10).translate(0, -0.065, 0.012),
  new THREE.SphereGeometry(0.02, 12, 10).translate(0, -0.13, 0.012),
])!;
const plateGeo = new THREE.PlaneGeometry(0.2, 0.1);
const coverGeo = new THREE.PlaneGeometry(DW * 0.98, DH * 0.98);
// light spill: a pool on the floor in front of the open door, narrow at the safe and widening out
const spillGeo = (() => {
  const g = new THREE.BufferGeometry();
  const y = -H / 2 + 0.004, z0 = D / 2, z1 = D / 2 + 0.95, w0 = W * 0.42, w1 = W * 0.95;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w0, y, z0, w0, y, z0, w1, y, z1, -w1, y, z1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
})();
const backGlowGeo = new THREE.PlaneGeometry(W * 1.4, H * 1.4);

// loot
const stackGeo = new THREE.BoxGeometry(0.17, 0.06, 0.085);
const bandGeo = new THREE.BoxGeometry(0.035, 0.062, 0.087);
const barGeo = (() => {
  const g = new THREE.CylinderGeometry(0.052, 0.068, 0.05, 4, 1).rotateY(Math.PI / 4);
  g.scale(1.55, 1, 0.78);
  return g.toNonIndexed();
})();
const gemGeo = new THREE.OctahedronGeometry(0.03, 0).scale(1, 1.3, 1);
const coinGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.008, 20);
const dyeGeo = new THREE.BoxGeometry(0.22, 0.1, 0.13);
const ledGeo = new THREE.SphereGeometry(0.016, 12, 10);
const wireGeo = new THREE.TorusGeometry(0.05, 0.006, 6, 16, Math.PI);

// chains for a burned box: links across the door corner to corner
const chainGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  const n = 13, L = 0.8;
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(0.026, 0.008, 6, 12).scale(1.5, 1, 1);
    if (i % 2) g.rotateX(Math.PI / 2);
    g.translate(-L / 2 + (i / (n - 1)) * L, 0, 0);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
})();
const lockGeo = merge([
  new RoundedBoxGeometry(0.11, 0.09, 0.04, 2, 0.012).translate(0, -0.03, 0),
  new THREE.TorusGeometry(0.035, 0.009, 8, 18, Math.PI).translate(0, 0.012, 0),
])!;

export type SafeLook = {
  /** state of this box (wall states; a practice box maps to sealed/peeking/opened-*) */
  state: SceneBoxState;
  kind?: SceneBoxKind;
  /** what the player sees during a peek */
  peekContents: SceneBoxKind | null;
  /** this box is the active one: slide out to the middle and turn */
  hero: boolean;
};

const KIND_TAG: Record<SceneBoxKind, string> = { small: 'CASH', big: 'GOLD', trap: 'EMPTY' };

export const Safe = memo(function Safe({ id, label, home, homeScale = 1, look, mats, onClick, practiceTag }: {
  id: number;
  label: string;
  home: THREE.Vector3;
  homeScale?: number;
  look: SafeLook;
  mats: HeistMaterials;
  onClick?: (id: number) => void;
  /** practice box: show what is inside on a tag above it */
  practiceTag?: SceneBoxKind;
}) {
  const { state, kind, peekContents, hero } = look;
  const root = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const dial = useRef<THREE.Mesh>(null);
  const lever = useRef<THREE.Mesh>(null);
  const chains = useRef<THREE.Group>(null);
  const spill = useRef<THREE.Mesh>(null);
  const contentsRef = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const clickable = !!onClick && state === 'sealed' && !hero;

  const doorMat = useMemo(() => mats.creamDoor.clone(), [mats.creamDoor]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plateTexture(label), roughness: 0.35, metalness: 0.2, transparent: true }), [label]);
  const sootMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sootTexture(), transparent: true, depthWrite: false, roughness: 1, opacity: 0 }), []);
  const splatMat = useMemo(() => new THREE.MeshStandardMaterial({ map: splatTexture(), transparent: true, depthWrite: false, roughness: 0.4, opacity: 0, emissive: new THREE.Color(PAL.alarm), emissiveIntensity: 0.15 }), []);
  const soldMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tagTexture('SOLD'), roughness: 0.8, side: THREE.DoubleSide }), []);
  const practiceMat = useMemo(() => (practiceTag ? new THREE.MeshStandardMaterial({ map: tagTexture(KIND_TAG[practiceTag], practiceTag === 'trap' ? PAL.alarm : '#127a50'), roughness: 0.8, side: THREE.DoubleSide }) : null), [practiceTag]);
  const backGlowMat = useMemo(() => new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffb050', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const spillMat = useMemo(() => new THREE.MeshBasicMaterial({ map: spillTexture(), color: '#ffc070', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), []);

  // what sits inside: the peek contents while peeking, the real kind once opened, nothing once sold
  const shown: SceneBoxKind | null =
    state === 'peeking' ? peekContents ?? kind ?? null
      : state === 'opened-trap' ? 'trap'
        : state === 'opened-treasure' ? (kind === 'big' ? 'big' : 'small')
          : state === 'burned-revealed' ? kind ?? null
            : null;
  const lastShown = useRef<SceneBoxKind | null>(shown);
  if (shown) lastShown.current = shown;
  const contents = state === 'sold' ? null : lastShown.current;

  const st = useRef({
    heroT: hero ? 1 : 0, spin: 0, spinTarget: 0, facing: false, prev: state, since: 0,
    open: 0, dial: 0, lever: 0, chain: state === 'burned' ? 1 : 0, scorch: state === 'burned' || state === 'burned-revealed' ? 1 : 0,
    hover: 0, splat: state === 'opened-trap' ? 1 : 0, land: 0,
  });
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() }), []);

  useFrame((s, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const a = st.current; const now = s.clock.elapsedTime;
    if (a.prev !== state) { a.prev = state; a.since = now; }
    const t = now - a.since;

    // ---- pose: home slot -> pulled out -> hero spot ----
    a.heroT = clamp01(a.heroT + (hero ? dt / 1.0 : -dt / 0.85));
    const pull = ease(a.heroT / 0.3), fly = ease((a.heroT - 0.22) / 0.78);
    const out = tmp.a.copy(home).add(tmp.b.set(0, 0, 0.62 * homeScale));
    const p = tmp.c.copy(home).lerp(out, pull).lerp(HERO.pos, fly);
    // a small arc on the flight so it rises like a prize
    p.y += Math.sin(fly * Math.PI) * 0.25;
    const g = root.current!;
    const sc = THREE.MathUtils.lerp(homeScale, HERO.scale, fly);
    // in the wall the door sits flush (body sunk in its slot); hover pulls it a touch toward you
    a.hover += ((hover && clickable ? 1 : 0) - a.hover) * (1 - Math.exp(-dt * 10));
    g.position.set(p.x, p.y + (a.heroT > 0 ? Math.sin(now * 1.3) * 0.02 * fly : 0), p.z - (D / 2) * homeScale * (1 - pull) + a.hover * 0.08 * homeScale);
    g.scale.setScalar(sc);

    // ---- turning: spins while out, settles to face you when the door opens ----
    const wantOpen = state === 'peeking' || state === 'opened-treasure' || state === 'opened-trap' || state === 'sold' || state === 'burned-revealed';
    if (a.heroT > 0.01) {
      if (wantOpen || !hero) {
        // open (or heading home): finish the turn so the door faces you
        if (!a.facing) { a.facing = true; a.spinTarget = Math.ceil((a.spin + 0.35) / TAU) * TAU; }
        a.spin += (a.spinTarget - a.spin) * (1 - Math.exp(-dt * (hero ? 4 : 6)));
      } else {
        a.facing = false;
        a.spin += dt * 0.7 * fly;
      }
    } else if (Math.abs(a.spin) > 1e-4) {
      // home again: snap to the nearest full turn so the door faces out of the wall
      a.spin = 0; a.facing = false;
    }
    if (spinner.current) {
      spinner.current.rotation.y = a.spin;
      spinner.current.rotation.x = fly * 0.1;
      spinner.current.rotation.z = a.facing ? 0 : Math.sin(now * 0.9) * 0.04 * fly;
    }

    // ---- dial, lever, door ----
    let dialA = 0, leverA = 0, openT = 0;
    if (state === 'peeking') {
      // the slow crack (UI sounds match this, see PEEK_LEAD_MS): it flies out by 0.9 s, the dial clicks right,
      // left, right until 1.35 s, the lever drops, the door creaks ajar, sticks, then swings wide by 2.0 s
      const seg = (x: number, x0: number, x1: number) => ease((x - x0) / (x1 - x0));
      dialA = seg(t, 0.5, 0.8) * 2.6 - seg(t, 0.84, 1.08) * 1.5 + seg(t, 1.12, 1.32) * 0.8;
      dialA = Math.round(dialA / (TAU / 50)) * (TAU / 50); // ticks
      leverA = seg(t, 1.32, 1.46);
      openT = 0.14 * seg(t, 1.46, 1.64) + 0.86 * seg(t, 1.7, 2.0);
    } else if (wantOpen) {
      leverA = 1; openT = ease((t - 0.15) / 0.55);
      if (a.open > openT) openT = a.open; // already open: stay open
    }
    a.dial += (dialA - a.dial) * (1 - Math.exp(-dt * 30));
    a.lever += (leverA - a.lever) * (1 - Math.exp(-dt * 14));
    a.open = wantOpen ? openT : Math.max(0, a.open - dt / 0.45);
    if (dial.current) dial.current.rotation.z = a.dial;
    if (lever.current) lever.current.rotation.z = a.lever * 1.5;
    // out in the middle the door swings wide; in the wall it stops square so it does not cover the next slot
    if (door.current) door.current.rotation.y = -ease(a.open) * THREE.MathUtils.lerp(1.5, 1.95, fly);

    // ---- burn: chains on, scorch; reveal drops the chains ----
    a.chain += ((state === 'burned' ? 1 : 0) - a.chain) * (1 - Math.exp(-dt * 6));
    a.scorch += ((state === 'burned' || state === 'burned-revealed' ? 1 : 0) - a.scorch) * (1 - Math.exp(-dt * 3));
    a.splat += ((state === 'opened-trap' ? 1 : 0) - a.splat) * (1 - Math.exp(-dt * 8));
    if (chains.current) {
      chains.current.visible = a.chain > 0.02;
      chains.current.scale.setScalar(0.6 + 0.4 * a.chain);
      chains.current.position.y = (1 - a.chain) * -0.2;
    }
    sootMat.opacity = a.scorch * 0.95;
    splatMat.opacity = a.splat;
    doorMat.color.copy(DOOR_COL).lerp(SCORCH_COL, a.scorch * 0.6);
    doorMat.emissiveIntensity = a.hover * 0.6 + (clickable ? 0.04 + Math.sin(now * 2.2 + id) * 0.02 : 0);

    // ---- contents land once the door is all the way open: nothing gives them away before ----
    // on a crack they fall in from 2.0 s and hit the floor at 2.2 s, with the UI's chime or sting (PEEK_LEAD_MS)
    const landGo = state === 'peeking' ? t >= 2.0 && a.open > 0.9 : a.open > 0.9;
    a.land = landGo ? Math.min(1, a.land + dt / 0.32) : a.open < 0.05 ? 0 : a.land;
    if (contentsRef.current) {
      const l = a.land;
      // drop in from above with one small bounce
      const drop = l < 0.6 ? 1 - (l / 0.6) ** 2 : Math.abs(Math.sin(((l - 0.6) / 0.4) * Math.PI)) * 0.12;
      contentsRef.current.position.y = -H / 2 + T + drop * 0.16;
      contentsRef.current.scale.setScalar(0.75 + 0.25 * Math.min(1, l / 0.6));
    }

    // ---- light spill when open: plain warm until the contents land, then their colour ----
    const landed = a.land > 0.05;
    const lit = a.open * (contents && landed ? 1 : 0.35);
    const dud = landed && contents === 'trap';
    const blink = dud ? (Math.sin(now * 9) > 0.2 ? 1 : 0.35) : 1;
    spillMat.opacity = lit * (dud ? 0.22 * blink : 0.2) * (0.6 + 0.4 * fly);
    spillMat.color.set(dud ? PAL.alarm : '#ffc070');
    if (spill.current) spill.current.visible = spillMat.opacity > 0.01;
    backGlowMat.opacity = 0; // no glare inside: the contents should read, not a light
    backGlowMat.color.set(dud ? PAL.alarm : '#ffb050');
    if (contentsRef.current) contentsRef.current.visible = landed && !!contents;

    // the shared hero light follows the active safe
    if (hero || a.heroT > 0.01) {
      sceneFx.heroAccWeight = Math.max(sceneFx.heroAccWeight, fly);
      sceneFx.heroPos.copy(g.position);
      if (a.heroT > 0.5) {
        sceneFx.heroAccLight = Math.max(sceneFx.heroAccLight, lit * fly);
        sceneFx.heroLightColor.set(dud ? PAL.alarm : '#ffb54a');
        sceneFx.heroLightPos.set(g.position.x, g.position.y - 0.1, g.position.z + 1.5 * sc);
      }
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => { if (!clickable) return; e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; };
  const outp = () => { setHover(false); document.body.style.cursor = ''; };
  const click = (e: ThreeEvent<MouseEvent>) => { if (!clickable) return; e.stopPropagation(); document.body.style.cursor = ''; onClick?.(id); };

  return (
    <group ref={root}>
      <group ref={spinner}>
        {/* body */}
        <mesh geometry={shellGeo} material={mats.crimson} castShadow receiveShadow />
        <mesh geometry={rimGeo} material={mats.copper} />
        <mesh geometry={trimGeo} material={mats.copper} castShadow />
        <mesh geometry={insetGeo} material={mats.crimsonDeep} />
        <mesh geometry={liningGeo} material={mats.lining} receiveShadow />
        <group ref={contentsRef} position={[0, -H / 2 + T, 0.02]} visible={false}>
          {contents && <Contents kind={contents} mats={mats} />}
        </group>
        <mesh geometry={backGlowGeo} material={backGlowMat} position={[0, 0.02, -D / 2 + T + 0.01]} />
        {state === 'sold' && (
          <group position={[0, 0.12, -0.04]} rotation={[0, 0, -0.12]}>
            <mesh material={mats.copper} position={[-0.06, 0.1, 0]}><cylinderGeometry args={[0.003, 0.003, 0.12, 6]} /></mesh>
            <mesh material={soldMat} position={[0, -0.02, 0]}><planeGeometry args={[0.32, 0.16]} /></mesh>
          </group>
        )}
        {/* splatter on the rim when a dud went off */}
        {/* door on its hinge (left edge) */}
        <group ref={door} position={[-DW / 2, 0, D / 2 - DT / 2 + 0.012]}>
          <group position={[DW / 2, 0, 0]}>
            <mesh geometry={doorGeo} material={doorMat} castShadow onPointerOver={over} onPointerOut={outp} onClick={click} />
            <mesh geometry={doorInsetGeo} material={mats.copper} position={[0, 0, DT / 2 + 0.002]} />
            <mesh geometry={plateGeo} material={plateMat} position={[-0.015, 0.185, DT / 2 + 0.004]} />
            <mesh geometry={bezelGeo} material={mats.copper} position={[-0.015, -0.015, DT / 2 + 0.008]} />
            <mesh ref={dial} geometry={dialGeo} material={[mats.copper, mats.dial, mats.copper]} position={[-0.015, -0.015, DT / 2 + 0.014]} />
            <mesh ref={lever} geometry={leverGeo} material={mats.copper} position={[0.195, 0.07, DT / 2 + 0.012]} />
            {[[-0.235, 0.235], [0.235, 0.235], [-0.235, -0.235], [0.235, -0.235]].map(([x, y], i) => (
              <mesh key={i} geometry={rivetGeo} material={mats.copper} position={[x, y, DT / 2]} />
            ))}
            <mesh geometry={coverGeo} material={sootMat} position={[0, 0, DT / 2 + 0.016]} />
            <mesh geometry={coverGeo} material={splatMat} position={[0, 0, DT / 2 + 0.018]} />
          </group>
          {[0.17, -0.17].map((y) => <mesh key={y} geometry={hingeGeo} material={mats.copperDark} position={[-0.01, y, 0]} />)}
        </group>
        {/* chains and padlock on a burned box */}
        <group ref={chains} position={[0, 0, D / 2 + 0.05]} visible={false}>
          <mesh geometry={chainGeo} material={mats.copperDark} rotation={[0, 0, 0.78]} castShadow />
          <mesh geometry={chainGeo} material={mats.copperDark} rotation={[0, 0, -0.78]} castShadow />
          <mesh geometry={lockGeo} material={mats.copper} position={[0, 0, 0.03]} />
        </group>
        <mesh ref={spill} geometry={spillGeo} material={spillMat} visible={false} />
      </group>
      {practiceMat && (
        <mesh material={practiceMat} position={[0, H / 2 + 0.2, D / 2]} visible={!hero}><planeGeometry args={[0.56, 0.28]} /></mesh>
      )}
    </group>
  );
});

/** What is inside. Origin: centre of the floor of the safe. */
const Contents = memo(function Contents({ kind, mats }: { kind: SceneBoxKind; mats: HeistMaterials }) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => {
    if (led.current) led.current.emissiveIntensity = Math.sin(s.clock.elapsedTime * 9) > 0.2 ? 6 : 0.3;
  });
  if (kind === 'small') {
    const stackMats = [mats.billEdge, mats.billEdge, mats.bill, mats.billEdge, mats.billEdge, mats.billEdge];
    // stacks lie in a heap, the front ones tipped up so their faces show
    const stacks: [number, number, number, number, number][] = [
      [-0.12, 0.03, 0.06, 0.12, 0], [0.08, 0.03, 0.06, -0.1, 0], [-0.03, 0.09, 0.04, 0.05, 0],
      [-0.1, 0.07, -0.1, 0.0, -0.9], [0.1, 0.07, -0.1, 0.2, -0.9], [0.0, 0.15, 0.0, -0.08, -0.25],
    ];
    return (
      <group scale={1.25}>
        {stacks.map(([x, y, z, r, tip], i) => (
          <group key={i} position={[x, y, z]} rotation={[tip, r, 0]}>
            <mesh geometry={stackGeo} material={stackMats} castShadow />
            <mesh geometry={bandGeo} material={mats.band} />
          </group>
        ))}
        <mesh geometry={gemGeo} material={mats.emerald} position={[0.17, 0.035, 0.09]} rotation={[0.2, 0.5, 0.1]} />
        <mesh geometry={gemGeo} material={mats.emerald} position={[0.2, 0.03, -0.02]} rotation={[-0.3, 0.2, 0.4]} />
        {[0, 1, 2, 3].map((i) => <mesh key={i} geometry={coinGeo} material={mats.gold} position={[-0.17 + i * 0.012, 0.004 + i * 0.008, 0.12]} rotation={[0, 0, i * 0.05]} />)}
      </group>
    );
  }
  if (kind === 'big') {
    const bars: [number, number, number][] = [
      [-0.16, 0.025, 0.06], [0, 0.025, 0.06], [0.16, 0.025, 0.06],
      [-0.16, 0.025, -0.08], [0, 0.025, -0.08], [0.16, 0.025, -0.08],
      [-0.08, 0.075, 0.0], [0.08, 0.075, 0.0], [0, 0.125, -0.02],
    ];
    return (
      <group>
        {bars.map(([x, y, z], i) => <mesh key={i} geometry={barGeo} material={i >= 6 ? mats.barStamp : mats.gold} position={[x, y, z]} castShadow />)}
      </group>
    );
  }
  // the dud: a dye pack with a blinking red light and a wire loop
  return (
    <group position={[0, 0, 0.02]} rotation={[0, -0.12, 0]} scale={1.45}>
      <mesh geometry={dyeGeo} position={[0, 0.05, 0]} material={[mats.cream, mats.cream, mats.cream, mats.cream, mats.dye, mats.cream]} castShadow />
      <mesh geometry={ledGeo} position={[0.08, 0.108, 0.03]}>
        <meshStandardMaterial ref={led} color="#5a0a08" emissive={PAL.alarm} emissiveIntensity={4} roughness={0.3} toneMapped={false} />
      </mesh>
      <mesh geometry={wireGeo} material={mats.crimson} position={[-0.06, 0.1, 0]} rotation={[0, Math.PI / 2, 0]} />
      <mesh geometry={wireGeo} material={mats.copper} position={[-0.02, 0.1, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.8} />
    </group>
  );
});
