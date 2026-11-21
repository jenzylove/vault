/** Shareable end card rendered to a PNG on a canvas: the take, the job, and your tell. */
import { shareLine } from '../engine';
import { loadFonts } from './fonts';

export interface ShareInput {
  pile: number;
  /** the job's name, e.g. "The Heist" */
  job: string;
  clean: boolean;
  busted: boolean;
  bankerCorrect: number;
  bankerCalls: number;
  daily: string | null; // ISO day when this was the daily vault
  /** The big line; defaults to how often he read you. */
  line?: string;
}

const VELVET = '#6b0f1a';
const VELVET_DEEP = '#3a0710';
const CREAM = '#f4e8d3';
const COPPER = '#c8743f';
const LOOT = '#1fa06d';
const ALARM = '#ff4a3d';

export async function renderShareCard(d: ShareInput): Promise<Blob> {
  await loadFonts();
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  const bg = g.createRadialGradient(W * 0.5, H * 0.35, 60, W * 0.5, H * 0.5, W * 0.8);
  bg.addColorStop(0, VELVET);
  bg.addColorStop(1, VELVET_DEEP);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // velvet nap
  for (let x = 0; x < W; x += 6) { g.fillStyle = x % 12 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.02)'; g.fillRect(x, 0, 3, H); }

  // cream ticket
  const r = 28, x0 = 60, y0 = 60, w = W - 120, h = H - 120;
  g.fillStyle = CREAM;
  g.beginPath(); g.roundRect(x0, y0, w, h, r); g.fill();
  g.strokeStyle = COPPER; g.lineWidth = 3; g.setLineDash([10, 8]);
  g.beginPath(); g.roundRect(x0 + 16, y0 + 16, w - 32, h - 32, r - 10); g.stroke();
  g.setLineDash([]);

  g.textAlign = 'center';
  g.fillStyle = VELVET;
  g.font = '700 22px "Heist Sans", sans-serif';
  spaced(g, (d.daily ? `THE VAULT   ·   DAILY HEIST ${d.daily}` : `THE VAULT   ·   ${d.job.toUpperCase()}`), W / 2, 130, 5);

  g.fillStyle = d.busted ? ALARM : VELVET;
  g.font = '400 150px "Heist Display", Georgia, serif';
  g.fillText(d.busted ? 'BUSTED' : d.pile.toLocaleString('en-US'), W / 2, 290);
  g.font = '700 26px "Heist Sans", sans-serif';
  g.fillStyle = d.clean ? LOOT : COPPER;
  spaced(g, d.busted ? 'THE FENCE CAUGHT ON TO YOU' : d.clean ? 'TAKE   ·   CLEAN JOB' : 'TAKE', W / 2, 340, 4);

  g.fillStyle = VELVET_DEEP;
  const line = d.line ?? shareLine(d.bankerCorrect, d.bankerCalls);
  let size = 54;
  g.font = `400 ${size}px "Heist Display", Georgia, serif`;
  while (size > 28 && g.measureText(line).width > W - 220) { size -= 2; g.font = `400 ${size}px "Heist Display", Georgia, serif`; }
  g.fillText(line, W / 2, 440);

  g.fillStyle = VELVET; g.globalAlpha = 0.7;
  g.font = '500 22px "Heist Sans", sans-serif';
  g.fillText('Crack the safe. The Fence reads your breath through the camera.', W / 2, 512);
  g.globalAlpha = 1;

  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('canvas toBlob failed'))), 'image/png'));
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number): void {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width + track);
  const total = widths.reduce((a, w) => a + w, 0) - track;
  let cx = x - total / 2;
  const align = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => { g.fillText(ch, cx, y); cx += widths[i] as number; });
  g.textAlign = align;
}
