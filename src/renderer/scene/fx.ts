// Mutable per-frame scene state shared between components (no React re-renders).
import * as THREE from 'three';

export const sceneFx = {
  boxGlow: new Array<number>(10).fill(0),
  boxGlowPos: Array.from({ length: 10 }, () => new THREE.Vector3()),
  /** elapsed-time when the banker last pulled a box toward him (burn) */
  pullTime: -1e9,
  pullX: 0,
  /** world position the camera should lean toward (active box), or null */
  focus: new THREE.Vector3(0, 0.8, -0.7),
  focusWeight: 0,
  fps: 0,
  /** frames left during which the key-light shadow map must re-render */
  shadowFrames: 30,
};
