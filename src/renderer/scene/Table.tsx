// Walnut and steel table, frosted teller screen, green banker's lamp (key light) with haze cone and dust motes.
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, useGLTF } from '@react-three/drei';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TABLE_Y, GLASS_Z, GLASS_HALF_W, GLASS_BOTTOM, GLASS_TOP } from './layout';
import type { VaultMaterials } from './materials';
import { frostTexture, grimeTexture, coinFaceTexture } from './textures';
import { AimedSpot } from './AimedSpot';
import { sceneFx } from './fx';
import { useFrostedGlassMaterial } from './FrostedGlass';

export const LAMP = { x: -0.36, z: -1.04, h: 0.36 };
const LAMP_TARGET: [number, number, number] = [0.0, TABLE_Y, -0.78];

const beamVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vLocal;
uniform float uHeight;
void main(){
  vLocal = position;
  vH = (position.y / uHeight) + 0.5; // 1 at apex, 0 at base
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const beamFrag = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vLocal;
uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  float n000=hash(i), n100=hash(i+vec3(1,0,0)), n010=hash(i+vec3(0,1,0)), n110=hash(i+vec3(1,1,0));
  float n001=hash(i+vec3(0,0,1)), n101=hash(i+vec3(1,0,1)), n011=hash(i+vec3(0,1,1)), n111=hash(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z); }
void main(){
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float core = pow(facing, 2.2);
  float along = smoothstep(0.0, 0.35, vH) * smoothstep(1.0, 0.82, vH);
  float n = noise(vLocal * 9.0 + vec3(0.0, uTime * 0.1, uTime * 0.04)) * 1.1;
  float a = core * along * (0.45 + n * 0.75) * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}`;

const dustVert = /* glsl */ `
attribute float aSeed; uniform float uTime; uniform float uScale; varying float vTw;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.21 + aSeed * 31.0) * 0.012;
  p.y += sin(uTime * 0.13 + aSeed * 17.0) * 0.016 - mod(uTime * 0.004 + aSeed, 1.0) * 0.0;
  p.z += cos(uTime * 0.17 + aSeed * 23.0) * 0.012;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vTw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 60.0);
  gl_PointSize = uScale * (0.6 + fract(aSeed * 7.3)) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const dustFrag = /* glsl */ `
uniform vec3 uColor; uniform float uIntensity; varying float vTw;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); a *= a * vTw * uIntensity; gl_FragColor = vec4(uColor * a, a); }`;

function aimQuaternion(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  // cone geometry apex points +y; we want apex at `from`, axis toward `to` => local -y points to target
  const dir = new THREE.Vector3().subVectors(from, to).normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

export const BankerLamp = memo(function BankerLamp({ mats, heat, beat, quality }: { mats: VaultMaterials; heat: React.MutableRefObject<number>; beat: React.MutableRefObject<number>; quality: 'high' | 'medium' }) {
  const spot = useRef<THREE.SpotLight>(null);
  const bulbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#000', emissive: new THREE.Color('#ffd6a0'), emissiveIntensity: 12 }), []);
  const opalMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4efe4', emissive: new THREE.Color('#ffcf94'), emissiveIntensity: 0.9, side: THREE.BackSide, roughness: 0.8 }), []);
  const apex = useMemo(() => new THREE.Vector3(LAMP.x, TABLE_Y + LAMP.h - 0.03, LAMP.z + 0.02), []);
  const tgt = useMemo(() => new THREE.Vector3(...LAMP_TARGET), []);
  const beamLen = apex.distanceTo(tgt) * 1.12;
  const beamUniforms = useMemo(() => ({ uColor: { value: new THREE.Color('#ffc890') }, uIntensity: { value: 0.12 }, uTime: { value: 0 }, uHeight: { value: beamLen } }), [beamLen]);
  const q = useMemo(() => aimQuaternion(apex, tgt), [apex, tgt]);
  const beamPos = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(tgt, apex).normalize();
    return apex.clone().addScaledVector(dir, beamLen / 2);
  }, [apex, tgt, beamLen]);

  const dust = useMemo(() => {
    const n = quality === 'high' ? 420 : 240;
    const pos = new Float32Array(n * 3); const seed = new Float32Array(n);
    const dir = new THREE.Vector3().subVectors(tgt, apex).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (let i = 0; i < n; i++) {
      const t = 0.12 + 0.9 * Math.sqrt(Math.random()); const r = Math.sqrt(Math.random()) * t * 0.55;
      const a = Math.random() * Math.PI * 2;
      const p = apex.clone().addScaledVector(dir, t * beamLen * 0.95).addScaledVector(side, Math.cos(a) * r * beamLen * 0.8).addScaledVector(up, Math.sin(a) * r * beamLen * 0.5);
      pos.set([p.x, p.y, p.z], i * 3); seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [apex, tgt, beamLen, quality]);
  const dustUniforms = useMemo(() => ({ uTime: { value: 0 }, uScale: { value: 5 }, uColor: { value: new THREE.Color('#ffdcb0') }, uIntensity: { value: 0.7 } }), []);

  const warm = useMemo(() => new THREE.Color('#ffd9ad'), []);
  const hot = useMemo(() => new THREE.Color('#ff6a3a'), []);
  const flareCol = useMemo(() => new THREE.Color('#ff9a3c'), []);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const h = heat.current;
    const fl = sceneFx.flare;
    col.copy(warm).lerp(hot, h * 0.75).lerp(flareCol, fl * 0.8);
    // incandescent shimmer + a tiny dip on each heartbeat; a breath catch surges the filament brighter and warmer
    const flicker = 1 + 0.012 * Math.sin(t * 47) + 0.01 * Math.sin(t * 23.7) - beat.current * 0.07;
    const surge = 1 + fl * 3.6;
    if (spot.current) { spot.current.intensity = 0.85 * flicker * surge; spot.current.color.copy(col); }
    bulbMat.emissive.copy(col); bulbMat.emissiveIntensity = 12 * surge;
    opalMat.emissive.copy(col).multiplyScalar(0.9); opalMat.emissiveIntensity = 0.9 * (1 + fl * 2.5);
    beamUniforms.uTime.value = t;
    beamUniforms.uColor.value.copy(col);
    beamUniforms.uIntensity.value = (0.22 + h * 0.18) * flicker * (1 + fl * 3.2);
    dustUniforms.uTime.value = t;
    dustUniforms.uColor.value.copy(col).lerp(new THREE.Color('#ffffff'), 0.3);
    dustUniforms.uScale.value = st.size.height * 0.006;
  });

  const shadowSize = quality === 'high' ? 1536 : 1024;
  return (
    <group>
      {/* lamp body */}
      <group position={[LAMP.x, TABLE_Y, LAMP.z]} rotation={[0, 0.25, 0]}>
        <mesh position={[0, 0.011, 0]} material={mats.brass} castShadow receiveShadow scale={[1.25, 1, 0.85]}>
          <cylinderGeometry args={[0.07, 0.078, 0.022, 48]} />
        </mesh>
        <mesh position={[0, 0.026, 0]} material={mats.brassPolished} castShadow scale={[1.25, 1, 0.85]}>
          <cylinderGeometry args={[0.05, 0.068, 0.012, 48]} />
        </mesh>
        <mesh position={[0, 0.17, -0.01]} material={mats.brass} castShadow>
          <cylinderGeometry args={[0.0075, 0.0085, 0.29, 16]} />
        </mesh>
        {/* yoke */}
        <mesh position={[0, LAMP.h - 0.005, 0.0]} rotation={[0, 0, Math.PI / 2]} material={mats.brass} castShadow>
          <cylinderGeometry args={[0.005, 0.005, 0.25, 12]} />
        </mesh>
        {[-0.125, 0.125].map((x) => (
          <mesh key={x} position={[x, LAMP.h - 0.025, 0]} material={mats.brass} castShadow>
            <cylinderGeometry args={[0.004, 0.004, 0.04, 10]} />
          </mesh>
        ))}
        {/* green cased glass shade: half cylinder, opening down, tilted toward the player */}
        <group position={[0, LAMP.h, 0.02]} rotation={[0.28, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} material={mats.greenGlass} castShadow>
            <cylinderGeometry args={[0.072, 0.072, 0.26, 64, 1, true, 0, Math.PI]} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} material={opalMat} scale={0.985}>
            <cylinderGeometry args={[0.072, 0.072, 0.258, 64, 1, true, 0, Math.PI]} />
          </mesh>
          {[-0.131, 0.131].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]} material={mats.brassPolished}>
              <circleGeometry args={[0.074, 40, Math.PI / 2, Math.PI]} />
            </mesh>
          ))}
          <mesh position={[0, 0.012, 0]} rotation={[0, 0, Math.PI / 2]} material={bulbMat}>
            <capsuleGeometry args={[0.013, 0.08, 6, 16]} />
          </mesh>
          {/* pull chain */}
          {Array.from({ length: 12 }, (_, i) => (
            <mesh key={i} position={[0.09, -0.02 - i * 0.008, 0.055]} material={mats.brassPolished}>
              <sphereGeometry args={[0.0022, 8, 6]} />
            </mesh>
          ))}
        </group>
      </group>
      <AimedSpot lightRef={spot} position={[apex.x, apex.y, apex.z]} target={LAMP_TARGET} angle={0.92} penumbra={0.75} intensity={0.6} distance={1.9} color="#ffb36b" castShadow shadowSize={shadowSize} />
      {/* haze cone */}
      <mesh position={beamPos} quaternion={q} renderOrder={5}>
        <coneGeometry args={[beamLen * 0.62, beamLen, 64, 1, true]} />
        <shaderMaterial vertexShader={beamVert} fragmentShader={beamFrag} uniforms={beamUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      <points geometry={dust} renderOrder={6}>
        <shaderMaterial vertexShader={dustVert} fragmentShader={dustFrag} uniforms={dustUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </group>
  );
});

function perforatedAlpha(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#000';
  for (let y = 10; y < 256; y += 18) for (let x = 10 + ((y / 18) % 2) * 9; x < 256; x += 18) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
  return new THREE.CanvasTexture(c);
}

export const TellerScreen = memo(function TellerScreen({ mats, quality }: { mats: VaultMaterials; quality: 'high' | 'medium' }) {
  const glass = useFrostedGlassMaterial(frostTexture(), quality);
  const grille = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b5228', metalness: 1, roughness: 0.55, alphaMap: perforatedAlpha(), alphaTest: 0.5, side: THREE.DoubleSide }), []);
  const h = GLASS_TOP - GLASS_BOTTOM; const cy = (GLASS_TOP + GLASS_BOTTOM) / 2; const W = GLASS_HALF_W * 2;
  return (
    <group position={[0, 0, GLASS_Z]}>
      <mesh position={[0, cy, 0]} material={glass}>
        <boxGeometry args={[W, h, 0.008]} />
      </mesh>
      {/* brass channel frame */}
      <RoundedBox args={[W + 0.06, 0.035, 0.035]} radius={0.006} smoothness={3} position={[0, GLASS_TOP + 0.012, 0]} material={mats.brass} castShadow />
      <RoundedBox args={[W + 0.06, 0.03, 0.035]} radius={0.006} smoothness={3} position={[0, GLASS_BOTTOM - 0.01, 0]} material={mats.brass} castShadow />
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[0.035, GLASS_TOP - TABLE_Y + 0.03, 0.04]} radius={0.006} smoothness={3} position={[s * (GLASS_HALF_W + 0.025), (GLASS_TOP + TABLE_Y) / 2, 0]} material={mats.brass} castShadow />
      ))}
      {[-1, 1].map((s) => (
        <RoundedBox key={`f${s}`} args={[0.09, 0.012, 0.12]} radius={0.004} smoothness={2} position={[s * (GLASS_HALF_W + 0.025), TABLE_Y + 0.006, 0]} material={mats.brassDark} castShadow />
      ))}
      {/* speak-through grille */}
      <group position={[0, 1.02, 0.006]} scale={0.75}>
        <mesh material={mats.brassDark}><torusGeometry args={[0.07, 0.008, 12, 64]} /></mesh>
        <mesh material={grille}><circleGeometry args={[0.068, 48]} /></mesh>
      </group>
      {/* deal tray under the screen, where boxes and chits pass */}
      <mesh position={[0, TABLE_Y + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.brassDark} receiveShadow>
        <planeGeometry args={[W - 0.02, 0.3]} />
      </mesh>
    </group>
  );
});

// Green baize writing pad set into the walnut under the ten boxes, edged with a thin brass inlay.
function Baize({ mats }: { mats: VaultMaterials }) {
  const felt = useMemo(() => {
    const nap = grimeTexture('baize', 0.5, 0.5, 91, 0);
    const m = new THREE.MeshStandardMaterial({ color: '#1f3d2c', roughness: 1, metalness: 0, map: nap, bumpMap: nap, bumpScale: 0.6, polygonOffset: true, polygonOffsetFactor: -1 });
    m.map = nap.clone(); m.map.repeat.set(6, 3); m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true;
    return m;
  }, []);
  const W = 1.24, D = 0.44, cz = -0.83;
  const shape = useMemo(() => {
    const s = new THREE.Shape(); const r = 0.03, w = W / 2, d = D / 2;
    s.moveTo(-w + r, -d); s.lineTo(w - r, -d); s.quadraticCurveTo(w, -d, w, -d + r); s.lineTo(w, d - r); s.quadraticCurveTo(w, d, w - r, d);
    s.lineTo(-w + r, d); s.quadraticCurveTo(-w, d, -w, d - r); s.lineTo(-w, -d + r); s.quadraticCurveTo(-w, -d, -w + r, -d);
    return s;
  }, []);
  const inlay = useMemo(() => {
    const s = shape.clone(); const h = new THREE.Path(shape.getPoints(24).map((p) => p.clone().multiplyScalar(0.985)));
    s.holes.push(h);
    return new THREE.ShapeGeometry(s, 24);
  }, [shape]);
  return (
    <group position={[0, TABLE_Y + 0.0003, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh material={felt} receiveShadow><shapeGeometry args={[shape, 24]} /></mesh>
      <mesh geometry={inlay} material={mats.brassPolished} position={[0, 0, 0.0002]} receiveShadow />
    </group>
  );
}

// The banker's gold scale on the player's right: two pans on chains, a few coins weighed on one side.
// Merged into three meshes (brass, walnut, coins) so it costs three draw calls.
function buildScale(): { brass: THREE.BufferGeometry; wood: THREE.BufferGeometry; coins: THREE.BufferGeometry } {
  const brass: THREE.BufferGeometry[] = [];
  const coins: THREE.BufferGeometry[] = [];
  const add = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1)));
    list.push(n);
  };
  const H = 0.2, arm = 0.085, tilt = 0.06; // the loaded pan sits low
  add(brass, new THREE.CylinderGeometry(0.03, 0.04, 0.004, 32), [0, 0.0135, 0]);
  add(brass, new THREE.CylinderGeometry(0.0035, 0.0045, H, 12), [0, H / 2 + 0.012, 0]);
  add(brass, new THREE.ConeGeometry(0.006, 0.018, 12), [0, H + 0.02, 0]);
  add(brass, new THREE.CylinderGeometry(0.0022, 0.0022, arm * 2, 10), [0, H + 0.012, 0], [0, 0, Math.PI / 2 + tilt]);
  add(brass, new THREE.BoxGeometry(0.0015, 0.024, 0.0015), [0, H + 0.024, 0], [0, 0, tilt]);
  for (const side of [-1, 1]) {
    const x = side * arm * Math.cos(tilt), y = H + 0.012 - side * arm * Math.sin(tilt);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(brass, new THREE.CylinderGeometry(0.0006, 0.0006, 0.1, 4), [x + Math.cos(a) * 0.017, y - 0.05, Math.sin(a) * 0.017], [Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32]);
    }
    add(brass, new THREE.CylinderGeometry(0.036, 0.03, 0.006, 32, 1, true), [x, y - 0.1, 0]);
    add(brass, new THREE.CircleGeometry(0.03, 32), [x, y - 0.1025, 0], [-Math.PI / 2, 0, 0]);
    if (side < 0) for (let i = 0; i < 5; i++) add(coins, new THREE.CylinderGeometry(0.0082, 0.0082, 0.0019, 28), [x + (i % 2) * 0.004 - 0.002, y - 0.1015 + i * 0.0019, (i % 3) * 0.002], [0, i, 0]);
  }
  const strip = (gs: THREE.BufferGeometry[]) => gs.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; });
  const wood = new THREE.CylinderGeometry(0.05, 0.056, 0.012, 32).translate(0, 0.006, 0);
  return { brass: mergeGeometries(strip(brass))!, wood, coins: mergeGeometries(strip(coins))! };
}

function GoldScale({ mats }: { mats: VaultMaterials }) {
  const geo = useMemo(buildScale, []);
  const coinMat = useMemo(() => { const m = mats.gold.clone(); m.bumpMap = coinFaceTexture(); m.bumpScale = 1.2; return m; }, [mats.gold]);
  useFrame(() => { if (mats.gold.envMap && coinMat.envMap !== mats.gold.envMap) { coinMat.envMap = mats.gold.envMap; coinMat.envMapIntensity = mats.gold.envMapIntensity; coinMat.needsUpdate = true; } });
  return (
    <group position={[0.6, TABLE_Y, -1.02]} rotation={[0, -0.6, 0]}>
      <mesh geometry={geo.wood} material={mats.walnut} castShadow receiveShadow />
      <mesh geometry={geo.brass} material={mats.brassPolished} castShadow receiveShadow />
      <mesh geometry={geo.coins} material={coinMat} castShadow />
    </group>
  );
}

export const Table = memo(function Table({ mats }: { mats: VaultMaterials }) {
  const { scene } = useGLTF('./assets/models/magnifying_glass_01/magnifying_glass_01_1k.gltf', false, false);
  const magnifier = useMemo(() => { const s = scene.clone(); s.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } }); return s; }, [scene]);
  const zFront = 0.1, zBack = -2.55, depth = zFront - zBack, cz = (zFront + zBack) / 2, W = 1.95;
  return (
    <group>
      <RoundedBox args={[W, 0.05, depth]} radius={0.01} smoothness={3} position={[0, TABLE_Y - 0.025, cz]} material={mats.walnut} receiveShadow castShadow />
      {/* brushed steel edge band */}
      <RoundedBox args={[W + 0.02, 0.06, 0.016]} radius={0.004} smoothness={2} position={[0, TABLE_Y - 0.028, zFront + 0.006]} material={mats.steelBrushed} castShadow />
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[0.016, 0.06, depth + 0.02]} radius={0.004} smoothness={2} position={[s * (W / 2 + 0.006), TABLE_Y - 0.028, cz]} material={mats.steelBrushed} castShadow />
      ))}
      {[[-0.9, 0.0], [0.9, 0.0], [-0.9, -2.45], [0.9, -2.45]].map(([x, z], i) => (
        <mesh key={i} position={[x, (TABLE_Y - 0.05) / 2, z]} material={mats.steelBrushed} castShadow>
          <cylinderGeometry args={[0.025, 0.02, TABLE_Y - 0.05, 20]} />
        </mesh>
      ))}
      <primitive object={magnifier} position={[-0.66, TABLE_Y + 0.013, -1.2]} rotation={[-Math.PI / 2, 0, -2.2]} />
      <Baize mats={mats} />
      <GoldScale mats={mats} />
    </group>
  );
});
useGLTF.preload('./assets/models/magnifying_glass_01/magnifying_glass_01_1k.gltf', false, false);
