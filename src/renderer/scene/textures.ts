// Procedural canvas textures: grime/roughness noise, engraved number plates, dials, smoke sprite.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

// Tileable value noise, several octaves.
function fbm(size: number, seed: number, octaves: number, baseCells: number): Float32Array {
  const out = new Float32Array(size * size);
  const r = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells; const y0 = Math.floor(gy); const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells; const x0 = Math.floor(gx); const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
        const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Grey roughness/grime map: base value +- noise, with smudges and fine scratches. */
export function grimeTexture(key: string, base: number, spread: number, seed: number, scratches = 0): THREE.Texture {
  const k = `grime:${key}`;
  const hit = cache.get(k); if (hit) return hit;
  const size = 512;
  const n = fbm(size, seed, 5, 4);
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = Math.max(0, Math.min(1, base + (n[i] - 0.5) * 2 * spread));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (scratches > 0) {
    const r = rng(seed * 7 + 3);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < scratches; i++) {
      const x = r() * size, y = r() * size, a = r() * Math.PI, l = 10 + r() * 80;
      ctx.strokeStyle = r() > 0.5 ? '#ffffff' : '#000000';
      ctx.lineWidth = 0.5 + r();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  cache.set(k, t);
  return t;
}

/** Brushed metal streaks (for steel), grey, horizontal. */
export function brushedTexture(seed: number): THREE.Texture {
  const k = `brushed:${seed}`;
  const hit = cache.get(k); if (hit) return hit;
  const w = 512, h = 512;
  const [c, ctx] = makeCanvas(w, h);
  const r = rng(seed);
  ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const y = r() * h; const v = 90 + r() * 80;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.15 + r() * 0.25})`;
    ctx.lineWidth = 0.6 + r() * 1.2;
    const x = r() * w; const l = 60 + r() * 400;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (r() - 0.5) * 2); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  cache.set(k, t);
  return t;
}

/** Engraved number plate: white plate with black-enamel engraved numeral (map + bump). */
export function plateTexture(n: number): THREE.Texture {
  const k = `plate:${n}`;
  const hit = cache.get(k); if (hit) return hit;
  const [c, ctx] = makeCanvas(256, 160);
  const g = ctx.createLinearGradient(0, 0, 256, 160);
  g.addColorStop(0, '#f4efe2'); g.addColorStop(1, '#d9d1bf');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 160);
  // engraved border line
  ctx.strokeStyle = '#3a3226'; ctx.lineWidth = 4; ctx.strokeRect(12, 12, 232, 136);
  ctx.fillStyle = '#16120c';
  ctx.font = 'bold 104px "Didot","Bodoni MT","Times New Roman",serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 128, 86);
  // two screw heads
  for (const x of [28, 228]) {
    ctx.fillStyle = '#5c5040'; ctx.beginPath(); ctx.arc(x, 80, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e8e0cc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, 77); ctx.lineTo(x + 5, 83); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(k, t);
  return t;
}

/** Polygraph pneumograph dial face. */
export function gaugeDialTexture(): THREE.Texture {
  const k = 'gaugeDial';
  const hit = cache.get(k); if (hit) return hit;
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2, cy = S / 2;
  const g = ctx.createRadialGradient(cx, cy * 0.9, 50, cx, cy, S / 2);
  g.addColorStop(0, '#efe6cf'); g.addColorStop(0.85, '#ddd0b0'); g.addColorStop(1, '#a8987a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // aged blotches
  const n = fbm(256, 99, 4, 4);
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = 256;
  const tctx = tmp.getContext('2d')!; const img = tctx.createImageData(256, 256);
  for (let i = 0; i < n.length; i++) { const v = n[i]; img.data[i * 4] = 120; img.data[i * 4 + 1] = 95; img.data[i * 4 + 2] = 50; img.data[i * 4 + 3] = Math.max(0, (v - 0.55)) * 160; }
  tctx.putImageData(img, 0, 0); ctx.drawImage(tmp, 0, 0, S, S);
  // scale: sweep -135..+135 deg
  const R = S * 0.4;
  const a0 = (-225 * Math.PI) / 180, a1 = (45 * Math.PI) / 180;
  // red zone near both extremes
  ctx.lineWidth = 26; ctx.strokeStyle = 'rgba(150,30,22,0.85)';
  ctx.beginPath(); ctx.arc(cx, cy, R - 10, a1 - 0.42, a1); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R - 10, a0, a0 + 0.42); ctx.stroke();
  ctx.strokeStyle = '#1b160f';
  ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R + 6, a0, a1); ctx.stroke();
  for (let i = 0; i <= 50; i++) {
    const a = a0 + (a1 - a0) * (i / 50);
    const major = i % 5 === 0;
    const l = major ? 44 : 22;
    ctx.lineWidth = major ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
    ctx.lineTo(cx + Math.cos(a) * (R + 6 - l), cy + Math.sin(a) * (R + 6 - l));
    ctx.stroke();
    if (major) {
      ctx.fillStyle = '#1b160f';
      ctx.font = '600 44px "Bodoni MT","Times New Roman",serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lbl = String(i / 5 - 5);
      ctx.fillText(lbl, cx + Math.cos(a) * (R - 78), cy + Math.sin(a) * (R - 78));
    }
  }
  ctx.fillStyle = '#1b160f';
  ctx.textAlign = 'center';
  ctx.font = '600 56px "Bodoni MT","Times New Roman",serif';
  ctx.fillText('PNEUMOGRAPH', cx, cy + R * 0.42);
  ctx.font = 'italic 36px "Times New Roman",serif';
  ctx.fillText('Respiration', cx, cy + R * 0.58);
  ctx.font = '30px "Times New Roman",serif';
  ctx.fillText('KELLER & CIE  ZÜRICH', cx, cy - R * 0.3);
  ctx.fillText('Nº 3471', cx, cy - R * 0.18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  cache.set(k, t);
  return t;
}

export function clockDialTexture(): THREE.Texture {
  const k = 'clockDial';
  const hit = cache.get(k); if (hit) return hit;
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2, cy = S / 2;
  ctx.fillStyle = '#ece6d6'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? 12 : 3;
    const r0 = major ? 180 : 214, r1 = 232;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
    ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    ctx.stroke();
  }
  ctx.font = '600 22px "Helvetica","Arial",sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('MOSER-BAER', cx, cy + 80);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  cache.set(k, t);
  return t;
}

export function softSpriteTexture(): THREE.Texture {
  const k = 'soft';
  const hit = cache.get(k); if (hit) return hit;
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbm(S, 5, 4, 3);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    const fall = Math.max(0, 1 - d); const a = fall * fall * (0.55 + 0.9 * n[y * S + x]);
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  cache.set(k, t);
  return t;
}

/** Frosted glass surface variation (roughness). */
export function frostTexture(): THREE.Texture {
  return grimeTexture('frost', 0.55, 0.12, 31, 0);
}
