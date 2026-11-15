// Post stack: bloom on true highlights only (bulbs, gold glints, the banker's lamp), ACES, vignette, grain.
import { memo } from 'react';
import { EffectComposer, N8AO, Bloom, ToneMapping, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';

const DEV_FLAGS = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams();
const on = (k: string) => DEV_FLAGS.get(k) !== '0';
void on;

export const Effects = memo(function Effects({ quality }: { quality: 'high' | 'medium' }) {
  const high = quality === 'high';
  return (
    <EffectComposer multisampling={0} key={quality}>
      {/* N8AO cost ~10 ms on Iris Xe at 1440x900; opt-in only via ?ao=1 in dev */}
      {high && DEV_FLAGS.get('ao') === '1' ? <N8AO aoRadius={0.28} distanceFalloff={0.6} intensity={2.4} quality="performance" halfRes={false} color="black" /> : <></>}
      {on('bloom') ? <Bloom mipmapBlur luminanceThreshold={1.1} luminanceSmoothing={0.05} intensity={0.6} radius={0.6} levels={high ? 6 : 4} /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.22} darkness={0.72} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.1} />
    </EffectComposer>
  );
});
