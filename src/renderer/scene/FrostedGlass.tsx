// Cheap frosted glass: only the banker's booth (layer 1) is rendered into a small mipmapped target,
// which the pane samples in screen space with a blurred, frost-jittered lookup. Replaces three's
// full-scene transmission pass (which re-drew every object in the room each frame).
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { sceneFx } from './fx';

export const BEHIND_GLASS_LAYER = 1;

const vert = /* glsl */ `
varying vec4 vClip; varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vNormalW = normalize(mat3(modelMatrix) * normal);
  vClip = projectionMatrix * viewMatrix * w;
  gl_Position = vClip;
}`;
const frag = /* glsl */ `
uniform sampler2D uScene; uniform sampler2D uFrost; uniform float uLod; uniform vec3 uTint; uniform vec3 uMilk; uniform float uMilkAmt;
uniform float uSharp; uniform float uGain; uniform vec3 uWarm;
varying vec4 vClip; varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  // uSharp (0..1): the banker pressing close to the pane, so less blur and less scatter
  float spread = 1.0 - uSharp * 0.75;
  float lod = uLod * (1.0 - uSharp * 0.6);
  vec2 f = (texture2D(uFrost, vUv * vec2(3.0, 2.2)).rg - 0.5) * 0.012 * spread;
  vec3 c = vec3(0.0);
  c += textureLod(uScene, suv + f, lod).rgb * 0.4;
  c += textureLod(uScene, suv + f + vec2(0.006, 0.004) * spread, lod + 0.6).rgb * 0.15;
  c += textureLod(uScene, suv + f - vec2(0.006, 0.004) * spread, lod + 0.6).rgb * 0.15;
  c += textureLod(uScene, suv + f + vec2(-0.005, 0.006) * spread, lod + 0.6).rgb * 0.15;
  c += textureLod(uScene, suv + f + vec2(0.005, -0.006) * spread, lod + 0.6).rgb * 0.15;
  // milky scatter: frosted glass lifts the blacks and catches room light
  float grain = texture2D(uFrost, vUv * 9.0).r;
  // uGain/uWarm: his lamp flaring behind the pane; scaling the light keeps his shadow dark, so the edge pops
  c = c * uTint * uWarm * uGain + uMilk * uMilkAmt * (1.0 - uSharp * 0.7) * (0.85 + grain * 0.3);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(V, vNormalW)), 4.0);
  c += vec3(0.05, 0.055, 0.06) * fres;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function useFrostedGlassMaterial(frost: THREE.Texture, quality: 'high' | 'medium') {
  const { gl, scene, camera, size } = useThree();
  const fbo = useMemo(() => {
    const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    return t;
  }, []);
  useEffect(() => {
    const s = quality === 'high' ? 0.5 : 0.35;
    fbo.setSize(Math.max(64, Math.round(size.width * s)), Math.max(64, Math.round(size.height * s)));
  }, [fbo, size.width, size.height, quality]);
  useEffect(() => () => fbo.dispose(), [fbo]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      uScene: { value: fbo.texture }, uFrost: { value: frost }, uLod: { value: quality === 'high' ? 3.2 : 2.6 },
      uTint: { value: new THREE.Color('#dfe6e1') }, uMilk: { value: new THREE.Color('#9aa39f') }, uMilkAmt: { value: 0.035 },
      uSharp: { value: 0 }, uGain: { value: 1 }, uWarm: { value: new THREE.Color(1, 1, 1) },
    },
  }), [fbo, frost, quality]);

  const frame = useRef(0);
  useFrame(() => {
    const n = ++frame.current;
    // suspicion presses him to the pane (sharper); a breath catch flashes the pane bright and warm for ~0.4 s
    const a = sceneFx.alert, fl = sceneFx.flare;
    const u = mat.uniforms;
    u.uSharp.value = Math.min(1, a * a * 0.75 + fl * 0.9);
    u.uGain.value = 1 + a * 0.25 + fl * 1.6;
    (u.uWarm.value as THREE.Color).setRGB(1, 1 - fl * 0.12, 1 - fl * 0.38);
    // lights must be visible to the booth pass too
    if (n % 30 === 1) scene.traverse((o) => { if ((o as THREE.Light).isLight) o.layers.enable(BEHIND_GLASS_LAYER); });
    // the booth changes slowly; refresh it every other frame on medium
    if (quality === 'medium' && n % 2 === 1) return;
    const prevMask = camera.layers.mask;
    const prevTarget = gl.getRenderTarget();
    camera.layers.set(BEHIND_GLASS_LAYER);
    gl.setRenderTarget(fbo);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(prevTarget);
    camera.layers.mask = prevMask;
  });
  return mat;
}

/** Put a subtree (and lights) on the behind-glass layer as well as the default one. */
export function enableBehindGlass(root: THREE.Object3D) {
  root.traverse((o) => o.layers.enable(BEHIND_GLASS_LAYER));
}
