// Procedural canvas textures for the heist vault. Everything is drawn here: no downloads.
import * as THREE from 'three';

export const PAL = {
  velvet: '#6b0f1a',
  deep: '#3a0710',
  crimson: '#a3172a',
  cream: '#f4e8d3',
  copper: '#c8743f',
  emerald: '#1fa06d',
  gold: '#f2b84b',
  alarm: '#ff4a3d',
};

const cache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Diamond tufted velvet: two cells across, puffy centres, sunk buttons at the corners. Repeat it in world units. */
export function velvetTexture(): THREE.Texture {
  const t = canvasTex('velvet', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = PAL.velvet; ctx.fillRect(0, 0, w, h);
    const r = rng(7);
    // puffy diamonds: light centre, darker folds toward the buttons (rows every half cell, offset by half a cell)
    const cell = w / 2;
    for (let iy = -1; iy <= 5; iy++) for (let ix = -1; ix <= 2; ix++) {
      const cx = ix * cell + (iy % 2 ? cell / 2 : 0), cy = iy * cell / 2;
      const g = ctx.createRadialGradient(cx, cy - 6, 2, cx, cy, cell * 0.5);
      g.addColorStop(0, '#841a28'); g.addColorStop(0.6, '#6e1220'); g.addColorStop(1, '#560c18');
      ctx.fillStyle = g; ctx.strokeStyle = 'rgba(40,4,10,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - cell / 2); ctx.lineTo(cx + cell / 2, cy); ctx.lineTo(cx, cy + cell / 2); ctx.lineTo(cx - cell / 2, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // buttons at the side corners of every diamond
    for (let iy = 0; iy <= 4; iy++) for (let ix = -1; ix <= 2; ix++) {
      const bx = ix * cell + (iy % 2 ? 0 : cell / 2), by = iy * cell / 2;
      const g = ctx.createRadialGradient(bx - 2, by - 2, 0, bx, by, 9);
      g.addColorStop(0, '#4a0a14'); g.addColorStop(0.6, '#3e0810'); g.addColorStop(1, 'rgba(40,4,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
    }
    // nap speckle
    for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,180,180' : '20,0,4'},${0.04 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1, 1); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Cream and crimson checker floor with a little marble veining. */
export function floorTexture(): THREE.Texture {
  const t = canvasTex('floor', 512, 512, (ctx, w, h) => {
    const n = 4, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#8c1424' : '#efe2c9'; ctx.fillRect(x * s, y * s, s, s);
    }
    const r = rng(3);
    ctx.globalAlpha = 0.12; ctx.strokeStyle = '#6b4a3a'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      ctx.beginPath(); let x = r() * w, y = r() * h; ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 60; y += r() * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(80,30,20,0.25)'; ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Cream wallpaper with soft warm stripes (the Fence's booth). */
export function wallpaperTexture(): THREE.Texture {
  const t = canvasTex('wallpaper', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#efdcbf'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { ctx.fillStyle = 'rgba(163,23,42,0.16)'; ctx.fillRect(x, 0, 10, h); ctx.fillStyle = 'rgba(200,116,63,0.18)'; ctx.fillRect(x + 14, 0, 2, h); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Enamel number plate: cream oval, crimson numerals, copper rim. */
export function plateTexture(label: string): THREE.Texture {
  return canvasTex('plate' + label, 128, 64, (ctx, w, h) => {
    ctx.fillStyle = PAL.copper; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.crimson; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2 - 7, h / 2 - 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.cream; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 46px Georgia, "Times New Roman", serif'; ctx.fillText(label, w / 2, h / 2 + 3);
  });
}

/** Combination dial face: copper with cream ticks and numbers. */
export function dialTexture(): THREE.Texture {
  return canvasTex('dial', 256, 256, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    const g = ctx.createRadialGradient(cx - 30, cy - 30, 10, cx, cy, 128);
    g.addColorStop(0, '#f0b080'); g.addColorStop(0.6, PAL.copper); g.addColorStop(1, '#7a3a1c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 127, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.deep; ctx.beginPath(); ctx.arc(cx, cy, 104, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.cream; ctx.fillStyle = PAL.cream; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 50; i++) {
      const a = (i / 50) * Math.PI * 2 - Math.PI / 2, long = i % 5 === 0;
      ctx.lineWidth = long ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (long ? 74 : 86), cy + Math.sin(a) * (long ? 74 : 86)); ctx.lineTo(cx + Math.cos(a) * 100, cy + Math.sin(a) * 100); ctx.stroke();
      if (i % 10 === 0) { ctx.font = '700 22px Georgia, serif'; ctx.fillText(String(i), cx + Math.cos(a) * 56, cy + Math.sin(a) * 56); }
    }
  });
}

/** Banknote: emerald paper, cream oval portrait window, crimson numerals. */
export function billTexture(): THREE.Texture {
  return canvasTex('bill', 256, 128, (ctx, w, h) => {
    ctx.fillStyle = PAL.emerald; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d9f2e2'; ctx.lineWidth = 4; ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#e8f6ea'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 34, 40, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f6a46'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2 + 6, 18, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8f6ea'; ctx.font = '700 30px Georgia, serif'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText('100', 18, 34); ctx.textAlign = 'right'; ctx.fillText('100', w - 18, h - 30);
  });
}

/** Paper band around a cash stack. */
export function bandTexture(): THREE.Texture {
  return canvasTex('band', 128, 32, (ctx, w, h) => {
    ctx.fillStyle = PAL.cream; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PAL.crimson; ctx.font = '700 18px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$10,000', w / 2, h / 2 + 1);
  });
}

/** Gold bar stamp. */
export function barTexture(): THREE.Texture {
  return canvasTex('bar', 128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b88a3a'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#a87a2a'; ctx.font = '700 18px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('FINE GOLD', w / 2, h / 2 - 8); ctx.font = '13px Georgia, serif'; ctx.fillText('999.9', w / 2, h / 2 + 12);
  });
}

/** Dye pack label. */
export function dyeTexture(): THREE.Texture {
  return canvasTex('dye', 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e6dcc8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PAL.alarm; ctx.fillRect(0, h - 26, w, 26);
    ctx.fillStyle = '#3a0710'; ctx.font = '800 44px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EMPTY', w / 2, h / 2 - 10);
    ctx.fillStyle = PAL.cream; ctx.font = '700 15px Arial, sans-serif'; ctx.fillText('NOTHING INSIDE', w / 2, h - 13);
  });
}

/** Soft soot for a scorched door (transparent). */
export function sootTexture(): THREE.Texture {
  return canvasTex('soot', 256, 256, (ctx, w, h) => {
    const r = rng(11);
    for (let i = 0; i < 40; i++) {
      const x = w * (0.2 + r() * 0.6), y = h * (0.25 + r() * 0.75), rad = 30 + r() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(30,12,8,${0.25 + r() * 0.2})`); g.addColorStop(1, 'rgba(30,12,8,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // ember edge glints
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(255,${90 + r() * 60},40,${0.3 + r() * 0.4})`; ctx.fillRect(w * (0.1 + r() * 0.8), h * (0.5 + r() * 0.5), 2, 2); }
  });
}

/** Red dye splatter (transparent). */
export function splatTexture(): THREE.Texture {
  return canvasTex('splat', 256, 256, (ctx, w, h) => {
    const r = rng(5);
    ctx.fillStyle = '#e3203a';
    for (let i = 0; i < 18; i++) {
      const x = w * (0.2 + r() * 0.6), y = h * (0.2 + r() * 0.6), rad = 10 + r() * 34;
      ctx.globalAlpha = 0.7 + r() * 0.3; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 6; k++) { const a = r() * Math.PI * 2, d = rad + r() * 40; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 2 + r() * 6, 0, Math.PI * 2); ctx.fill(); }
    }
  });
}

/** Hanging tag with a word (cream card, crimson ink). */
export function tagTexture(word: string, ink: string = PAL.crimson): THREE.Texture {
  return canvasTex('tag' + word + ink, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = PAL.cream; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = ink; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#c9b89a'; ctx.beginPath(); ctx.arc(28, h / 2, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.font = `800 ${word.length > 5 ? 40 : 54}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(word, w / 2 + 14, h / 2 + 3);
  });
}

/** Marquee sign lettering on deep velvet. */
export function signTexture(text: string): THREE.Texture {
  return canvasTex('sign' + text, 512, 128, (ctx, w, h) => {
    ctx.fillStyle = PAL.deep; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PAL.cream; ctx.font = '800 72px Georgia, "Times New Roman", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

/** Meter face: cream with a crimson zone. */
export function meterTexture(): THREE.Texture {
  return canvasTex('meter', 256, 256, (ctx, w, h) => {
    const cx = w / 2, cy = h * 0.62;
    ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(w / 2, h / 2, 127, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(163,23,42,0.85)';
    ctx.beginPath(); ctx.arc(cx, cy, 86, -Math.PI * 0.25, -Math.PI * 0.08); ctx.stroke();
    ctx.strokeStyle = PAL.deep; ctx.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI * 0.92 + (i / 10) * Math.PI * 0.84;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70); ctx.lineTo(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96); ctx.stroke();
    }
    ctx.fillStyle = PAL.deep; ctx.font = '700 22px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('BREATH', cx, cy + 38);
  });
}

/** Radial soft glow (for additive sprites and light spill). */
export function glowTexture(): THREE.Texture {
  return canvasTex('glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

/** Fade for the light spill cone: bright at the door (top of the canvas), gone at the far end. */
export function spillTexture(): THREE.Texture {
  return canvasTex('spill', 16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
