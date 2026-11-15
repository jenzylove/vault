// Shared PBR materials. Real CC0 scans (Poly Haven) for wood, concrete, terrazzo, steel; procedural grime for brass.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { brushedTexture, grimeTexture } from './textures';

const T = './assets/tex/';

export const TEX_URLS = {
  walnutD: `${T}american_walnut_veneer_diff_2k.jpg`,
  walnutN: `${T}american_walnut_veneer_nor_gl_2k.jpg`,
  walnutR: `${T}american_walnut_veneer_rough_2k.jpg`,
  concD: `${T}concrete_wall_008_diff_1k.jpg`,
  concN: `${T}concrete_wall_008_nor_gl_1k.jpg`,
  concR: `${T}concrete_wall_008_rough_1k.jpg`,
  terrD: `${T}terrazzo_tiles_diff_1k.jpg`,
  terrN: `${T}terrazzo_tiles_nor_gl_1k.jpg`,
  terrR: `${T}terrazzo_tiles_rough_1k.jpg`,
};

export interface VaultMaterials {
  brass: THREE.MeshPhysicalMaterial;
  brassDark: THREE.MeshPhysicalMaterial;
  brassPolished: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshPhysicalMaterial;
  steel: THREE.MeshStandardMaterial;
  steelBrushed: THREE.MeshStandardMaterial;
  walnut: THREE.MeshPhysicalMaterial;
  concrete: THREE.MeshStandardMaterial;
  terrazzo: THREE.MeshStandardMaterial;
  velvet: THREE.MeshPhysicalMaterial;
  blackEnamel: THREE.MeshStandardMaterial;
  void: THREE.MeshBasicMaterial;
  silhouette: THREE.MeshStandardMaterial;
  greenGlass: THREE.MeshPhysicalMaterial;
  paintedWall: THREE.MeshStandardMaterial;
}

function prep(t: THREE.Texture, rx: number, ry: number, srgb: boolean): THREE.Texture {
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(rx, ry);
  c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  c.anisotropy = 8;
  c.needsUpdate = true;
  return c;
}

export function useVaultMaterials(): VaultMaterials {
  const tx = useTexture(TEX_URLS) as Record<keyof typeof TEX_URLS, THREE.Texture>;
  return useMemo(() => {
    const brassRough = grimeTexture('brass', 0.34, 0.16, 11, 160);
    const brassRoughDark = grimeTexture('brassDark', 0.48, 0.2, 12, 80);
    const brassColor = grimeTexture('brassCol', 0.9, 0.12, 13, 0);
    brassColor.colorSpace = THREE.SRGBColorSpace;

    const brass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#c9a35a'), metalness: 1, roughness: 1,
      roughnessMap: brassRough, map: brassColor, clearcoat: 0.25, clearcoatRoughness: 0.35,
    });
    const brassDark = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8a6a34'), metalness: 1, roughness: 1, roughnessMap: brassRoughDark, map: brassColor,
    });
    const brassPolished = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e0bf74'), metalness: 1, roughness: 0.16, clearcoat: 0.6, clearcoatRoughness: 0.1,
    });
    const gold = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffc65a'), metalness: 1, roughness: 0.2, emissive: new THREE.Color('#ff9a2a'), emissiveIntensity: 0,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6c7074'), metalness: 0.85, roughness: 1, roughnessMap: grimeTexture('steel', 0.5, 0.18, 21, 120),
      bumpMap: grimeTexture('steelBump', 0.5, 0.3, 22, 0), bumpScale: 0.4,
    });
    const brushed = brushedTexture(3);
    const steelBrushed = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8d9195'), metalness: 1, roughness: 1, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.3,
    });
    const walnut = new THREE.MeshPhysicalMaterial({
      map: prep(tx.walnutD, 1.2, 1.2, true), normalMap: prep(tx.walnutN, 1.2, 1.2, false),
      roughnessMap: prep(tx.walnutR, 1.2, 1.2, false), roughness: 0.85, color: new THREE.Color('#8a6a55'),
      clearcoat: 0.55, clearcoatRoughness: 0.22, normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const concrete = new THREE.MeshStandardMaterial({
      map: prep(tx.concD, 3, 1.5, true), normalMap: prep(tx.concN, 3, 1.5, false), roughnessMap: prep(tx.concR, 3, 1.5, false),
      color: new THREE.Color('#5e5953'),
    });
    const paintedWall = new THREE.MeshStandardMaterial({
      map: prep(tx.concD, 2, 2, true), normalMap: prep(tx.concN, 2, 2, false), roughnessMap: prep(tx.concR, 2, 2, false),
      color: new THREE.Color('#3c463e'),
    });
    const terrazzo = new THREE.MeshStandardMaterial({
      map: prep(tx.terrD, 4, 4, true), normalMap: prep(tx.terrN, 4, 4, false), roughnessMap: prep(tx.terrR, 4, 4, false),
      color: new THREE.Color('#8d877c'),
    });
    const velvet = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#3d0b10'), roughness: 1, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color('#a3394a'),
    });
    const blackEnamel = new THREE.MeshStandardMaterial({ color: '#070605', roughness: 0.6, metalness: 0.2 });
    const voidMat = new THREE.MeshBasicMaterial({ color: '#000000' });
    const silhouette = new THREE.MeshStandardMaterial({ color: '#0b0a09', roughness: 1, metalness: 0 });
    const greenGlass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#06351a'), roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      emissive: new THREE.Color('#0b4a20'), emissiveIntensity: 0.04, side: THREE.DoubleSide,
    });
    return { brass, brassDark, brassPolished, gold, steel, steelBrushed, walnut, concrete, terrazzo, velvet, blackEnamel, void: voidMat, silhouette, greenGlass, paintedWall };
  }, [tx]);
}
