// Sculpted seated man for the frosted-glass silhouette: suit shoulders, shirt collar, head with nose and ears, fedora.
// Only the outline matters (he is never seen directly), so everything is a few lathed and merged primitives.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x: number, y: number) => new THREE.Vector2(x, y);
function prep(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const n = g.index ? g.toNonIndexed() : g;
  n.applyMatrix4(m);
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal'].includes(k)) n.deleteAttribute(k);
  return n;
}
const M = (p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));

function torso() {
  // suit jacket: waist, chest, padded square shoulders, sloping to the neck
  const prof = [V(0.0, 0), V(0.15, 0), V(0.165, 0.12), V(0.18, 0.3), V(0.185, 0.42), V(0.19, 0.5), V(0.175, 0.535), V(0.12, 0.565), V(0.065, 0.585), V(0.0, 0.59)];
  const body = new THREE.LatheGeometry(prof, 40);
  const parts = [prep(body, M([0, 0, 0], [0, 0, 0], [1.22, 1, 0.62]))];
  // shirt collar and neck
  parts.push(prep(new THREE.CylinderGeometry(0.052, 0.062, 0.1, 24), M([0, 0.62, 0.005])));
  parts.push(prep(new THREE.CylinderGeometry(0.066, 0.07, 0.035, 24, 1, true), M([0, 0.59, 0.005])));
  // collar points and jacket lapels give the neckline its V in profile
  for (const sx of [-1, 1]) {
    parts.push(prep(new THREE.ConeGeometry(0.018, 0.05, 4), M([sx * 0.03, 0.565, 0.065], [0.5, 0, sx * 0.5])));
    parts.push(prep(new THREE.BoxGeometry(0.06, 0.2, 0.012), M([sx * 0.055, 0.43, 0.105], [-0.1, 0, sx * -0.28])));
  }
  return mergeGeometries(parts)!;
}

function head() {
  const parts = [
    prep(new THREE.SphereGeometry(0.095, 32, 24), M([0, 0.1, 0], [0, 0, 0], [0.84, 1.08, 0.97])),
    prep(new THREE.SphereGeometry(0.07, 24, 16), M([0, 0.045, 0.022], [0, 0, 0], [0.95, 0.85, 1.0])), // jaw
    prep(new THREE.ConeGeometry(0.014, 0.034, 10), M([0, 0.095, 0.096], [Math.PI / 2 + 0.25, 0, 0])), // nose
    prep(new THREE.SphereGeometry(0.024, 12, 10), M([-0.081, 0.09, -0.005], [0, 0, 0], [0.4, 1, 0.75])),
    prep(new THREE.SphereGeometry(0.024, 12, 10), M([0.081, 0.09, -0.005], [0, 0, 0], [0.4, 1, 0.75])),
  ];
  // fedora: pinched crown on a brim that curls up at the sides
  const crown = new THREE.LatheGeometry([V(0, 0.105), V(0.06, 0.1), V(0.085, 0.085), V(0.092, 0.03), V(0.098, 0)], 36);
  parts.push(prep(crown, M([0, 0.165, -0.004], [-0.08, 0, 0], [1, 1, 1.1])));
  const brim = new THREE.LatheGeometry([V(0.08, 0.004), V(0.15, 0.0), V(0.172, 0.012), V(0.172, 0.006), V(0.15, -0.006), V(0.08, -0.002)], 48);
  parts.push(prep(brim, M([0, 0.168, -0.004], [-0.08, 0, 0], [0.92, 1, 1.12])));
  return mergeGeometries(parts)!;
}

function limb(r0: number, r1: number, len: number) {
  return prep(new THREE.CylinderGeometry(r0, r1, len, 16, 1, false), M([0, -len / 2, 0]));
}

export const FIG = {
  torso: torso(),
  head: head(),
  upperArm: mergeGeometries([limb(0.058, 0.048, 0.27), prep(new THREE.SphereGeometry(0.06, 16, 12), M([0, 0, 0]))])!,
  foreArm: mergeGeometries([limb(0.047, 0.038, 0.24), prep(new THREE.SphereGeometry(0.048, 12, 10), M([0, 0, 0]))])!,
  hand: prep(new THREE.SphereGeometry(0.045, 14, 10), M([0, 0, 0], [0, 0, 0], [0.8, 1.1, 0.45])),
};
