// Shared world layout (metres). The player stands in front of the vault wall, looking toward -z.
// Left: a wall of ten safe deposit doors set in red velvet. Right: The Fence in his lit booth window.
// The active safe slides out of the wall to the middle of the screen and turns like a prize.
import * as THREE from 'three';

export const WALL_Z = 0; // front face of the velvet wall
export const CAMERA_POS = new THREE.Vector3(0.05, 1.72, 6.6);
export const CAMERA_TARGET = new THREE.Vector3(0.05, 1.5, 0);

/** One safe deposit box: door face size and body depth (wall scale). */
export const SAFE = { w: 0.6, h: 0.6, d: 0.5, gap: 0.05 };
/** Slot cell pitch on the wall. */
export const CELL = 0.8;
export const GRID = { cols: 5, rows: 2, x0: -1.1, rowY: [2.2, 1.38] as const };

/** The hero pose: middle of the screen, in front of the wall, scaled up. */
export const HERO = { pos: new THREE.Vector3(0.0, 1.36, 2.3), scale: 1.32 };

/** The Fence's booth window, cut into the wall on the right. */
export const BOOTH = { x: 2.42, w: 1.6, bottom: 0.98, top: 2.82, back: -1.35 };

/** Practice safes stand on a cream plinth in front of the wall, under the grid. */
export const PRACTICE = { y: 0.42, z: 1.15, gap: 0.78, scale: 0.72 };

export function slotPos(i: number): THREE.Vector3 {
  const col = i % GRID.cols, row = Math.floor(i / GRID.cols) % GRID.rows;
  return new THREE.Vector3(GRID.x0 + (col - (GRID.cols - 1) / 2) * CELL, GRID.rowY[row], WALL_Z);
}

export function practicePos(i: number, n: number): THREE.Vector3 {
  return new THREE.Vector3(GRID.x0 + (i - (n - 1) / 2) * PRACTICE.gap, PRACTICE.y, PRACTICE.z);
}
