// Shared world layout (metres). Player sits at +z looking toward -z.
import * as THREE from 'three';

export const TABLE_Y = 0.76;
export const CAMERA_POS = new THREE.Vector3(0, 1.17, 0.12);
export const CAMERA_TARGET = new THREE.Vector3(0, 0.9, -1.4);

export const BOX = { w: 0.078, h: 0.052, d: 0.104, lid: 0.011, wall: 0.0035 };
export const ARC_R = 0.98;
export const ARC_DEG = 28;

export const GLASS_Z = -1.52;
export const GLASS_HALF_W = 0.52;
export const GLASS_BOTTOM = TABLE_Y + 0.095;
export const GLASS_TOP = 1.6;
export const BANKER_Z = -2.12;

export const ROOM = { back: -4.6, left: -3.6, right: 3.6, ceil: 3.3 };

export function boxSlot(i: number, count = 10): { pos: THREE.Vector3; rotY: number } {
  const t = count === 1 ? 0.5 : i / (count - 1);
  const a = THREE.MathUtils.degToRad(-ARC_DEG + 2 * ARC_DEG * t);
  return {
    pos: new THREE.Vector3(CAMERA_POS.x + Math.sin(a) * ARC_R, TABLE_Y, CAMERA_POS.z - Math.cos(a) * ARC_R),
    rotY: -a,
  };
}
