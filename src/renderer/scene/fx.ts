// Mutable per-frame scene state shared between components (no React re-renders).
import * as THREE from 'three';

export const sceneFx = {
  /** ten board boxes plus up to four practice boxes (indices 10 and up) */
  boxGlow: new Array<number>(14).fill(0),
  boxGlowPos: Array.from({ length: 14 }, () => new THREE.Vector3()),
  /** elapsed-time when the banker last pulled a box toward him (burn) */
  pullTime: -1e9,
  pullX: 0,
  /** world position the camera should lean toward (active box), or null */
  focus: new THREE.Vector3(0, 0.8, -0.7),
  focusWeight: 0,
  fps: 0,
  /** frames left during which the key-light shadow map must re-render */
  shadowFrames: 30,
  /** damped banker alert (0..1), eased from the alert prop every frame */
  alert: 0,
  /** performance.now() of the latest breath catch (from the catchPulse prop) */
  catchAt: -1e9,
  /** 0..1 sharp catch envelope: fast attack, gone after about 0.6 s */
  flare: 0,
  /** 0..1 softer catch envelope for the camera push (no snap, never nauseating) */
  push: 0,
};

/** Sharp beat envelope for a catch that happened `ms` ago: 40 ms rise, then decays out by ~600 ms. */
export function flareEnvelope(ms: number): number {
  if (ms < 0 || ms > 900) return 0;
  if (ms < 40) return ms / 40;
  return Math.exp(-(ms - 40) / 170);
}

/** Smooth push envelope: eases in over ~180 ms and back out over ~700 ms. */
export function pushEnvelope(ms: number): number {
  if (ms < 0 || ms > 900) return 0;
  if (ms < 180) { const x = ms / 180; return x * x * (3 - 2 * x); }
  const x = Math.min(1, (ms - 180) / 700);
  return 1 - x * x * (3 - 2 * x);
}
