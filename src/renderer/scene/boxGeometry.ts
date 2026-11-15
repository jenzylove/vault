// Merged, shared geometry for the brass safe deposit box (few draw calls per box, built once for all ten).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX } from './layout';

const { w: W, h: H, d: D, wall: WALL } = BOX;
export const LID_T = 0.0055;
export const FLOOR = H * 0.45; // raised felt tray so contents sit near the rim
export const HINGE_R = 0.0028;
export const HINGE_Y = H + 0.0012;
export const HINGE_Z = -D / 2 - 0.0012;
export const PLATE = { w: 0.03, h: 0.017, y: H * 0.34 };
export const KEY_Y = H * 0.74;

function prep(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.applyMatrix4(m);
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
  return n;
}
const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

function keyholeShape(scale = 1): THREE.Shape {
  const s = new THREE.Shape();
  const r = 0.0013 * scale;
  s.absarc(0, 0.0011 * scale, r, -Math.PI * 0.32, Math.PI * 1.32, false);
  s.lineTo(-0.0011 * scale, -0.0028 * scale);
  s.lineTo(0.0011 * scale, -0.0028 * scale);
  s.closePath();
  return s;
}

/** brass body: walls with bevels, base skirt, two outer hinge knuckles, escutcheon with a real keyhole opening, plate rivets */
function buildBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4) => parts.push(prep(g, m));
  add(new RoundedBoxGeometry(W, WALL, D, 2, 0.001), T(0, WALL / 2, 0));
  add(new RoundedBoxGeometry(W, H, WALL, 2, 0.0012), T(0, H / 2, D / 2 - WALL / 2));
  add(new RoundedBoxGeometry(W, H, WALL, 2, 0.0012), T(0, H / 2, -D / 2 + WALL / 2));
  add(new RoundedBoxGeometry(WALL, H, D, 2, 0.0012), T(-W / 2 + WALL / 2, H / 2, 0));
  add(new RoundedBoxGeometry(WALL, H, D, 2, 0.0012), T(W / 2 - WALL / 2, H / 2, 0));
  // moulded base skirt and a rim bead just under the lid line
  add(new RoundedBoxGeometry(W + 0.004, 0.0045, D + 0.004, 2, 0.0016), T(0, 0.00225, 0));
  const bw = 0.0024;
  add(new RoundedBoxGeometry(W + 0.0016, 0.0022, bw, 2, 0.0008), T(0, H - 0.0016, D / 2 - bw / 2 + 0.0008));
  add(new RoundedBoxGeometry(W + 0.0016, 0.0022, bw, 2, 0.0008), T(0, H - 0.0016, -D / 2 + bw / 2 - 0.0008));
  add(new RoundedBoxGeometry(bw, 0.0022, D + 0.0016, 2, 0.0008), T(W / 2 - bw / 2 + 0.0008, H - 0.0016, 0));
  add(new RoundedBoxGeometry(bw, 0.0022, D + 0.0016, 2, 0.0008), T(-W / 2 + bw / 2 - 0.0008, H - 0.0016, 0));
  // outer hinge knuckles + leaves
  for (const x of [-0.026, 0.026]) {
    add(new THREE.CylinderGeometry(HINGE_R, HINGE_R, 0.011, 20), T(x + (x > 0 ? 0.0035 : -0.0035), HINGE_Y, HINGE_Z, 0, 0, Math.PI / 2));
    add(new THREE.BoxGeometry(0.011, 0.007, 0.0008), T(x + (x > 0 ? 0.0035 : -0.0035), HINGE_Y - 0.004, -D / 2 - 0.0004));
  }
  // escutcheon: raised plate with a keyhole cut through it (dark recess sits behind)
  const esc = new THREE.Shape();
  esc.absellipse(0, 0, 0.0058, 0.0075, 0, Math.PI * 2, false, 0);
  esc.holes.push(keyholeShape(1) as unknown as THREE.Path);
  add(new THREE.ExtrudeGeometry(esc, { depth: 0.0008, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 24 }), T(0, KEY_Y, D / 2 + 0.0002));
  // plate rivets
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    add(new THREE.SphereGeometry(0.0009, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), T(x * (PLATE.w / 2 - 0.0022), PLATE.y + y * (PLATE.h / 2 - 0.0022), D / 2 + 0.0011, Math.PI / 2, 0, 0));
  }
  return mergeGeometries(parts)!;
}

/** keyhole recess: a dark well behind the escutcheon opening */
function buildVoid(): THREE.BufferGeometry {
  const well = new THREE.ExtrudeGeometry(keyholeShape(1.02), { depth: 0.003, bevelEnabled: false });
  return prep(well, T(0, KEY_Y, D / 2 - 0.0028));
}

function buildFelt(): THREE.BufferGeometry {
  const iw = W - 2 * WALL, id = D - 2 * WALL, hh = H - FLOOR;
  const parts = [
    prep(new THREE.PlaneGeometry(iw, id), T(0, FLOOR, 0, -Math.PI / 2)),
    prep(new THREE.PlaneGeometry(iw, hh), T(0, FLOOR + hh / 2, -id / 2 + 0.0003)),
    prep(new THREE.PlaneGeometry(iw, hh), T(0, FLOOR + hh / 2, id / 2 - 0.0003, 0, Math.PI)),
    prep(new THREE.PlaneGeometry(id, hh), T(-iw / 2 + 0.0003, FLOOR + hh / 2, 0, 0, Math.PI / 2)),
    prep(new THREE.PlaneGeometry(id, hh), T(iw / 2 - 0.0003, FLOOR + hh / 2, 0, 0, -Math.PI / 2)),
  ];
  return mergeGeometries(parts)!;
}

/** lid in hinge space (origin on the hinge axis): thin plate, raised field, middle knuckle, front lip */
function buildLid(): THREE.BufferGeometry {
  const zc = -HINGE_Z; // plate centre measured from hinge
  const y0 = -(HINGE_Y - H) + LID_T / 2;
  const parts = [
    prep(new RoundedBoxGeometry(W + 0.0026, LID_T, D + 0.0026, 2, 0.0014), T(0, y0, zc)),
    prep(new RoundedBoxGeometry(W - 0.016, 0.0016, D - 0.018, 2, 0.0006), T(0, y0 + LID_T / 2 + 0.0006, zc)),
    prep(new THREE.CylinderGeometry(HINGE_R, HINGE_R, 0.03, 20), T(0, 0, 0, 0, 0, Math.PI / 2)),
    prep(new THREE.BoxGeometry(0.03, 0.0008, 0.006), T(0, -0.0006, 0.003)),
    prep(new RoundedBoxGeometry(0.018, 0.0055, 0.0032, 2, 0.0012), T(0, y0 - 0.0015, zc + D / 2 + 0.0026)),
  ];
  return mergeGeometries(parts)!;
}

function buildLidFelt(): THREE.BufferGeometry {
  const y0 = -(HINGE_Y - H) - 0.0002;
  return prep(new THREE.PlaneGeometry(W - 2 * WALL, D - 2 * WALL), T(0, y0, -HINGE_Z, Math.PI / 2));
}

let cache: { body: THREE.BufferGeometry; void: THREE.BufferGeometry; felt: THREE.BufferGeometry; lid: THREE.BufferGeometry; lidFelt: THREE.BufferGeometry; plate: THREE.BufferGeometry } | null = null;
export function boxGeometries() {
  if (!cache) cache = { body: buildBody(), void: buildVoid(), felt: buildFelt(), lid: buildLid(), lidFelt: buildLidFelt(), plate: new RoundedBoxGeometry(PLATE.w, PLATE.h, 0.0009, 1, 0.0004) };
  return cache;
}

// ---------- contents ----------
export const barGeo = (() => {
  const g = new THREE.BoxGeometry(0.03, 0.0095, 0.0145, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.86); p.setZ(i, p.getZ(i) * 0.8); }
  g.computeVertexNormals();
  return g;
})();
export const barStampGeo = new THREE.PlaneGeometry(0.0245, 0.0108);
export const coinGeo = new THREE.CylinderGeometry(0.0082, 0.0082, 0.0019, 40);

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private turns: number, private height: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.r, t * this.height, Math.sin(a) * this.r);
  }
}
export const springGeo = new THREE.TubeGeometry(new Helix(0.0045, 6, 0.012), 160, 0.0007, 6, false);

/** one steel jaw: a half ring lying flat (z>0 side) with teeth pointing inward; pivot is the x axis */
export const jawGeo = (() => {
  const R = 0.019, n = 9;
  const parts: THREE.BufferGeometry[] = [prep(new THREE.TorusGeometry(R, 0.0013, 6, 24, Math.PI), T(0, 0, 0, -Math.PI / 2, 0, 0))];
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    parts.push(prep(new THREE.ConeGeometry(0.0013, 0.0045, 5), T(x * 0.9, 0.0015, z * 0.9, 0, 0, 0).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-z, 0, x).normalize(), -0.4))));
  }
  return mergeGeometries(parts)!;
})();
