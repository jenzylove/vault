// SpotLight whose target lives in the scene graph (so its matrixWorld updates).
import { useMemo } from 'react';
import * as THREE from 'three';

export function AimedSpot({ target, castShadow, shadowSize = 1024, lightRef, ...props }: {
  position: [number, number, number]; target: [number, number, number]; angle: number; penumbra: number; intensity: number;
  distance?: number; color?: string; castShadow?: boolean; shadowSize?: number; lightRef?: React.Ref<THREE.SpotLight>;
}) {
  const obj = useMemo(() => new THREE.Object3D(), []);
  obj.position.set(...target);
  return (
    <>
      <primitive object={obj} />
      <spotLight ref={lightRef} {...props} decay={2} target={obj} castShadow={castShadow}
        shadow-mapSize-width={shadowSize} shadow-mapSize-height={shadowSize} shadow-bias={-0.0002} shadow-normalBias={0.01} />
    </>
  );
}
