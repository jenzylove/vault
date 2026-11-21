// Post stack: bloom on true highlights only (bulbs, gold, the open safe), ACES tone mapping, a soft vignette.
import { memo } from 'react';
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export const Effects = memo(function Effects({ quality }: { quality: 'high' | 'medium' }) {
  const high = quality === 'high';
  return (
    <EffectComposer multisampling={high ? 4 : 0} key={quality}>
      <Bloom mipmapBlur luminanceThreshold={0.95} luminanceSmoothing={0.1} intensity={0.55} radius={0.55} levels={high ? 6 : 4} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
});
