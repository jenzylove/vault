// Mutable per-frame scene state shared between components (no React re-renders).
import * as THREE from 'three';

export const sceneFx = {
  /** the hero safe's open door light: world position just in front of its door, 0..1 power, colour */
  heroLightPos: new THREE.Vector3(0, 1.4, 3),
  heroLight: 0,
  heroLightColor: new THREE.Color('#ffb54a'),
  /** world position of the hero safe (coins burst from here), and 0..1 how far out it is */
  heroPos: new THREE.Vector3(0.05, 1.42, 2.75),
  heroWeight: 0,
  /** accumulators the safes write during a frame; the driver moves them into heroLight / heroWeight next frame */
  heroAccLight: 0,
  heroAccWeight: 0,
  fps: 0,
  /** damped Fence alert (0..1), eased from the alert prop every frame */
  alert: 0,
  /** performance.now() of the latest breath catch (from the catchPulse prop) */
  catchAt: -1e9,
  /** 0..1 sharp catch envelope: fast attack, gone after about 0.6 s */
  flare: 0,
  /** 0..1 softer catch envelope for the camera push (no snap, never nauseating) */
  push: 0,
  /** performance.now() of the latest bust, and its 0..1 alarm envelope (about 2.6 s) and shake envelope (about 0.5 s) */
  bustAt: -1e9,
  alarm: 0,
  shake: 0,
  /** 0..1 heartbeat envelope (smoothed) */
  beat: 0,
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

/** Alarm envelope for a bust `ms` ago: snaps on, holds, fades out by 2.6 s. */
export function alarmEnvelope(ms: number): number {
  if (ms < 0 || ms > 2600) return 0;
  if (ms < 60) return ms / 60;
  if (ms < 1600) return 1;
  return 1 - (ms - 1600) / 1000;
}

/** Shake envelope for a bust `ms` ago: hard for a moment, settled by 550 ms. */
export function shakeEnvelope(ms: number): number {
  if (ms < 0 || ms > 550) return 0;
  return Math.exp(-ms / 160) * (1 - ms / 550);
}
