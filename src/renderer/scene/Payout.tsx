// Payout: a burst of gold coins that leaps out of the safe and pours toward the bottom right of the screen.
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { sceneFx } from './fx';

const MAX = 72;
const coinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.014, 22).rotateX(Math.PI / 2);
const DUR = 1.25;

/** How many coins a payout of `amount` throws (more cash, more coins). */
export function coinCount(amount: number): number {
  return Math.max(8, Math.min(MAX, Math.round(6 + Math.max(0, amount) / 25)));
}

export const Payout = memo(function Payout({ payout }: { payout?: { at: number; amount: number } }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffc24a', metalness: 1, roughness: 0.2, emissive: new THREE.Color('#ffa020'), emissiveIntensity: 0.45 }), []);
  const { camera } = useThree();
  const burst = useRef({ at: -1e9, n: 0, seen: -1e9, start: new THREE.Vector3() });
  const seeds = useMemo(() => Array.from({ length: MAX }, (_, i) => ({
    delay: i * 0.018 + Math.random() * 0.05,
    sx: (Math.random() - 0.5) * 0.5, sy: Math.random() * 0.3, sz: Math.random() * 0.3,
    apexX: (Math.random() - 0.3) * 1.6, apexY: 0.7 + Math.random() * 0.9,
    tx: (Math.random() - 0.5) * 0.25, ty: (Math.random() - 0.5) * 0.18,
    spin: 6 + Math.random() * 10, axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
  })), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), tgt: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);

  useEffect(() => {
    if (!payout || payout.at <= burst.current.seen) return;
    const b = burst.current;
    b.seen = payout.at; b.at = payout.at; b.n = coinCount(payout.amount);
    b.start.copy(sceneFx.heroWeight > 0.3 ? sceneFx.heroPos : new THREE.Vector3(0.05, 1.4, 2.6));
  }, [payout]);

  useFrame(() => {
    const m = mesh.current; if (!m) return;
    const b = burst.current;
    const t = (performance.now() - b.at) / 1000;
    // idle: one coin scaled to nothing, so the shader is compiled at load and the first payout never stalls
    if (t < 0 || t > DUR + 1.2 || b.n === 0) {
      if (m.count !== 1) { m.count = 1; m.setMatrixAt(0, tmp.m.makeScale(0, 0, 0)); m.instanceMatrix.needsUpdate = true; }
      return;
    }
    m.count = b.n;
    // target: just above the bottom right corner, a little in front of the camera
    camera.getWorldDirection(tmp.f);
    tmp.r.crossVectors(tmp.f, camera.up).normalize();
    tmp.u.crossVectors(tmp.r, tmp.f).normalize();
    const cam = camera as THREE.PerspectiveCamera;
    const dist = 2.6, halfH = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), halfW = halfH * cam.aspect;
    tmp.tgt.copy(camera.position).addScaledVector(tmp.f, dist).addScaledVector(tmp.r, halfW * 0.82).addScaledVector(tmp.u, -halfH * 0.78);
    for (let i = 0; i < b.n; i++) {
      const sd = seeds[i];
      const k = Math.max(0, Math.min(1, (t - sd.delay) / DUR));
      const e = k * k * (3 - 2 * k);
      // quadratic bezier: safe mouth -> apex above -> corner
      tmp.a.set(b.start.x + sd.sx, b.start.y + sd.sy, b.start.z + 0.4 + sd.sz);
      tmp.b.set(b.start.x + sd.apexX, b.start.y + sd.apexY, b.start.z + 1.2);
      const u = 1 - e;
      tmp.p.set(
        u * u * tmp.a.x + 2 * u * e * tmp.b.x + e * e * (tmp.tgt.x + sd.tx),
        u * u * tmp.a.y + 2 * u * e * tmp.b.y + e * e * (tmp.tgt.y + sd.ty),
        u * u * tmp.a.z + 2 * u * e * tmp.b.z + e * e * tmp.tgt.z,
      );
      const visible = t >= sd.delay && k < 1;
      const pop = Math.min(1, (t - sd.delay) * 8);
      const sc = visible ? pop * (1 - Math.max(0, (k - 0.85) / 0.15)) * (0.7 + 0.3 * (1 - e)) : 0;
      tmp.q.setFromAxisAngle(sd.axis, (t - sd.delay) * sd.spin);
      tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(Math.max(0.0001, sc)));
      m.setMatrixAt(i, tmp.m);
    }
    m.instanceMatrix.needsUpdate = true;
    mat.emissiveIntensity = 0.45 + Math.sin(t * 20) * 0.1;
  });

  return <instancedMesh ref={mesh} args={[coinGeo, mat, MAX]} frustumCulled={false} count={1} />;
});
