// Shared materials for the heist vault: red velvet, cream enamel, copper hardware; gold and emerald only for loot.
import { useMemo } from 'react';
import * as THREE from 'three';
import { PAL, velvetTexture, floorTexture, wallpaperTexture, billTexture, bandTexture, barTexture, dyeTexture, dialTexture } from './heistTextures';

export interface HeistMaterials {
  velvet: THREE.MeshStandardMaterial;   // tufted wall velvet (world-unit UVs)
  velvetPlain: THREE.MeshStandardMaterial;
  lining: THREE.MeshStandardMaterial;   // deep velvet inside a safe
  cream: THREE.MeshStandardMaterial;
  creamDoor: THREE.MeshStandardMaterial;
  crimson: THREE.MeshStandardMaterial;  // lacquered safe body
  crimsonDeep: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  copperDark: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  wallpaper: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  bill: THREE.MeshStandardMaterial;
  billEdge: THREE.MeshStandardMaterial;
  band: THREE.MeshStandardMaterial;
  barStamp: THREE.MeshStandardMaterial;
  emerald: THREE.MeshStandardMaterial;
  dye: THREE.MeshStandardMaterial;
  dial: THREE.MeshStandardMaterial;
  ledRed: THREE.MeshStandardMaterial;
  recess: THREE.MeshStandardMaterial;   // dark slot behind a safe that has slid out
}

export function useHeistMaterials(): HeistMaterials {
  return useMemo(() => {
    const vel = velvetTexture().clone(); vel.needsUpdate = true; vel.repeat.set(1 / 0.9, 1 / 0.9);
    const floor = floorTexture().clone(); floor.needsUpdate = true; floor.repeat.set(14 / 1.8, 8 / 1.8);
    const wp = wallpaperTexture().clone(); wp.needsUpdate = true; wp.repeat.set(2, 2);
    const bar = barTexture();
    return {
      velvet: new THREE.MeshStandardMaterial({ map: vel, color: '#ffffff', roughness: 0.92, metalness: 0 }),
      velvetPlain: new THREE.MeshStandardMaterial({ color: PAL.velvet, roughness: 0.9, metalness: 0 }),
      lining: new THREE.MeshStandardMaterial({ color: '#5a0c18', roughness: 1, metalness: 0, emissive: new THREE.Color('#3a0710'), emissiveIntensity: 0.3, side: THREE.BackSide }),
      cream: new THREE.MeshStandardMaterial({ color: PAL.cream, roughness: 0.55, metalness: 0 }),
      creamDoor: new THREE.MeshStandardMaterial({ color: '#f1e2c6', roughness: 0.32, metalness: 0.05, emissive: new THREE.Color('#ffb060'), emissiveIntensity: 0 }),
      crimson: new THREE.MeshPhysicalMaterial({ color: PAL.crimson, roughness: 0.38, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 }),
      crimsonDeep: new THREE.MeshPhysicalMaterial({ color: '#6b0f1a', roughness: 0.5, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
      copper: new THREE.MeshStandardMaterial({ color: PAL.copper, roughness: 0.3, metalness: 1 }),
      copperDark: new THREE.MeshStandardMaterial({ color: '#8a4526', roughness: 0.45, metalness: 1 }),
      floor: new THREE.MeshStandardMaterial({ map: floor, roughness: 0.35, metalness: 0 }),
      wallpaper: new THREE.MeshStandardMaterial({ map: wp, roughness: 0.85, metalness: 0 }),
      gold: new THREE.MeshStandardMaterial({ color: '#ffc24a', roughness: 0.18, metalness: 1, emissive: new THREE.Color('#ff9a1a'), emissiveIntensity: 0.25 }),
      bill: new THREE.MeshStandardMaterial({ map: billTexture(), color: '#d8eedd', roughness: 0.8, metalness: 0 }),
      billEdge: new THREE.MeshStandardMaterial({ color: '#8fd1aa', roughness: 0.9, metalness: 0 }),
      band: new THREE.MeshStandardMaterial({ map: bandTexture(), roughness: 0.7, metalness: 0 }),
      barStamp: new THREE.MeshStandardMaterial({ color: '#ffc24a', map: bar, roughness: 0.25, metalness: 1, emissive: new THREE.Color('#ff9a1a'), emissiveIntensity: 0.25 }),
      emerald: new THREE.MeshStandardMaterial({ color: PAL.emerald, roughness: 0.08, metalness: 0.3, emissive: new THREE.Color('#0d7a4c'), emissiveIntensity: 0.35, flatShading: true }),
      dye: new THREE.MeshStandardMaterial({ map: dyeTexture(), roughness: 0.6, metalness: 0 }),
      dial: new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.35, metalness: 0.6 }),
      ledRed: new THREE.MeshStandardMaterial({ color: '#5a0a08', emissive: new THREE.Color(PAL.alarm), emissiveIntensity: 0, roughness: 0.3 }),
      recess: new THREE.MeshStandardMaterial({ color: '#2a050c', roughness: 1, metalness: 0, side: THREE.BackSide }),
    };
  }, []);
}
