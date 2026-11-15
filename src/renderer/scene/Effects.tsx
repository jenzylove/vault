// Post stack: N8AO, depth of field (focus follows the active box), subtle bloom, ACES, vignette, film grain.
import { memo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, N8AO, Bloom, DepthOfField, ToneMapping, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode, DepthOfFieldEffect } from 'postprocessing';
import { sceneFx } from './fx';

const REST_FOCUS = new THREE.Vector3(0, 0.8, -0.86);

export const Effects = memo(function Effects({ quality }: { quality: 'high' | 'medium' }) {
  const dof = useRef<DepthOfFieldEffect>(null);
  const focus = useRef(REST_FOCUS.clone());
  useFrame((_, dt) => {
    const want = sceneFx.focusWeight > 0 ? sceneFx.focus : REST_FOCUS;
    focus.current.lerp(want, 1 - Math.exp(-dt * 3));
    if (dof.current?.target) dof.current.target.copy(focus.current);
  });
  const high = quality === 'high';
  return (
    <EffectComposer multisampling={high ? 2 : 0} key={quality}>
      <N8AO aoRadius={0.28} distanceFalloff={0.6} intensity={high ? 2.6 : 2.0} quality={high ? 'medium' : 'performance'} halfRes={!high} depthAwareUpsampling color="black" />
      <DepthOfField ref={dof} target={[0, 0.8, -0.86]} worldFocusRange={0.42} bokehScale={high ? 3.2 : 2.0} resolutionScale={high ? 0.75 : 0.5} />
      <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.55} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.22} darkness={0.78} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.12} />
    </EffectComposer>
  );
});
