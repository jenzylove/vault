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
  steelD: `${T}metal009_color_1k.jpg`,
  steelN: `${T}metal009_nor_gl_1k.jpg`,
  steelR: `${T}metal009_rough_1k.jpg`,
  prints: `${T}fingerprints002_rough_1k.jpg`,
};

export interface VaultMaterials {
  brass: THREE.MeshStandardMaterial;
  brassDark: THREE.MeshStandardMaterial;
  brassPolished: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  steelBrushed: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  terrazzo: THREE.MeshStandardMaterial;
  velvet: THREE.MeshStandardMaterial;
  blackEnamel: THREE.MeshStandardMaterial;
  void: THREE.MeshBasicMaterial;
  silhouette: THREE.MeshStandardMaterial;
  greenGlass: THREE.MeshStandardMaterial;
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

/** Reflection strength per material (scene.environmentIntensity only covers materials without their own envMap). */
export const ENV_STRENGTH: Partial<Record<keyof VaultMaterials, number>> = {
  brass: 0.6, brassDark: 0.35, brassPolished: 0.5, gold: 1.2, steel: 0.45, steelBrushed: 0.5, greenGlass: 0.2, walnut: 0.22, blackEnamel: 0.3,
};

export function applyEnvStrength(mats: VaultMaterials, env: THREE.Texture | null): void {
  if (!env) return;
  for (const [k, v] of Object.entries(ENV_STRENGTH)) {
    const m = mats[k as keyof VaultMaterials] as THREE.MeshStandardMaterial;
    if (m.envMap !== env) { m.envMap = env; m.envMapIntensity = v as number; m.needsUpdate = true; }
  }
}

/** Scanned fingerprint map is very dark (mean ~0.16): remap it so smudges sit on satin, not on a mirror. */
function remapRoughness(t: THREE.Texture, base: number, gain: number): THREE.Texture {
  const img = t.image as HTMLImageElement;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.min(255, (base + (d.data[i] / 255) * gain) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; }
  ctx.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(c); out.wrapS = out.wrapT = THREE.RepeatWrapping; out.colorSpace = THREE.NoColorSpace; out.anisotropy = 8;
  return out;
}

export function useVaultMaterials(): VaultMaterials {
  const tx = useTexture(TEX_URLS) as Record<keyof typeof TEX_URLS, THREE.Texture>;
  return useMemo(() => {
    // aged brass: real scanned fingerprints/smudges (ambientCG CC0) drive roughness, procedural tarnish drives colour
    const prints = remapRoughness(tx.prints, 0.4, 0.5);
    prints.repeat.set(2.5, 2.5);
    const brassColor = grimeTexture('brassCol', 0.85, 0.1, 13, 0);
    brassColor.colorSpace = THREE.SRGBColorSpace;
    const brass = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#a8844c'), metalness: 1, roughness: 1, roughnessMap: prints, map: brassColor,
    });
    const brassDark = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6a5130'), metalness: 1, roughness: 1.3, roughnessMap: prints, map: brassColor,
    });
    const brassPolished = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b8955a'), metalness: 1, roughness: 0.6, roughnessMap: prints,
    });
    const gold = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f2c05a'), metalness: 1, roughness: 0.22, roughnessMap: grimeTexture('gold', 0.5, 0.25, 41, 40), emissive: new THREE.Color('#ff9a2a'), emissiveIntensity: 0,
    });
    // worn steel: ambientCG Metal009 scan
    const steel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8a8d90'), metalness: 1, roughness: 1.1,
      map: prep(tx.steelD, 2, 2, true), normalMap: prep(tx.steelN, 2, 2, false), roughnessMap: prep(tx.steelR, 2, 2, false),
    });
    const steelBrushed = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#a4a7aa'), metalness: 1, roughness: 0.9,
      map: prep(tx.steelD, 1, 1, true), normalMap: prep(tx.steelN, 1, 1, false), roughnessMap: prep(tx.steelR, 1, 1, false),
    });
    void brushedTexture;
    // lacquered walnut: the scan's roughness, pulled glossier to read as a polished banker's table
    const walnut = new THREE.MeshStandardMaterial({
      map: prep(tx.walnutD, 1.2, 1.2, true), normalMap: prep(tx.walnutN, 1.2, 1.2, false),
      roughnessMap: prep(tx.walnutR, 1.2, 1.2, false), roughness: 0.55, color: new THREE.Color('#7c6a5e'),
      normalScale: new THREE.Vector2(0.4, 0.4),
    });
    const concrete = new THREE.MeshStandardMaterial({
      map: prep(tx.concD, 3, 1.5, true), normalMap: prep(tx.concN, 3, 1.5, false), roughnessMap: prep(tx.concR, 3, 1.5, false),
      color: new THREE.Color('#57585a'),
    });
    const paintedWall = new THREE.MeshStandardMaterial({
      map: prep(tx.concD, 2, 2, true), normalMap: prep(tx.concN, 2, 2, false), roughnessMap: prep(tx.concR, 2, 2, false),
      color: new THREE.Color('#3a423d'),
    });
    const terrazzo = new THREE.MeshStandardMaterial({
      map: prep(tx.terrD, 4, 4, true), normalMap: prep(tx.terrN, 4, 4, false), roughnessMap: prep(tx.terrR, 4, 4, false),
      color: new THREE.Color('#7d7c78'),
    });
    // dark bottle-green banker's felt
    const velvet = new THREE.MeshStandardMaterial({ color: new THREE.Color('#121a15'), roughness: 1, metalness: 0 });
    const blackEnamel = new THREE.MeshStandardMaterial({ color: '#070605', roughness: 0.6, metalness: 0.2 });
    const voidMat = new THREE.MeshBasicMaterial({ color: '#000000' });
    const silhouette = new THREE.MeshStandardMaterial({ color: '#0b0a09', roughness: 1, metalness: 0 });
    const greenGlass = new THREE.MeshStandardMaterial({
      // cased glass with a soft sheen, not a hard mirror stripe along the shade
      color: new THREE.Color('#06351a'), roughness: 0.3, metalness: 0.05,
      emissive: new THREE.Color('#0b4a20'), emissiveIntensity: 0.04, side: THREE.DoubleSide,
    });
    return { brass, brassDark, brassPolished, gold, steel, steelBrushed, walnut, concrete, terrazzo, velvet, blackEnamel, void: voidMat, silhouette, greenGlass, paintedWall };
  }, [tx]);
}
