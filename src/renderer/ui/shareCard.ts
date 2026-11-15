/** Shareable end card rendered to a PNG on a canvas: pile, bank, and how often he read you. */
import { shareLine } from '../engine';
import { loadFonts } from './fonts';

export interface ShareInput {
  pile: number;
  bankNo: number;
  rank: string;
  bankerCorrect: number;
  bankerCalls: number;
  daily: string | null; // ISO day when this was the daily vault
  won: boolean;
}

const INK = '#0c0a07';
const BRASS = '#c9a45c';
const BRASS_HI = '#ead7a6';
const PAPER = '#efe6d2';

export async function renderShareCard(d: ShareInput): Promise<Blob> {
  await loadFonts();
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  const bg = g.createRadialGradient(W * 0.5, H * 0.38, 40, W * 0.5, H * 0.5, W * 0.75);
  bg.addColorStop(0, '#2a2014');
  bg.addColorStop(0.55, '#130f0a');
  bg.addColorStop(1, INK);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // lamp cone and fine grain
  const cone = g.createLinearGradient(0, 0, 0, H);
  cone.addColorStop(0, 'rgba(234,215,166,0.10)');
  cone.addColorStop(1, 'rgba(234,215,166,0)');
  g.fillStyle = cone;
  g.beginPath(); g.moveTo(W * 0.42, 0); g.lineTo(W * 0.58, 0); g.lineTo(W * 0.86, H); g.lineTo(W * 0.14, H); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,240,210,0.03)';
  for (let i = 0; i < 2500; i++) g.fillRect(Math.random() * W, Math.random() * H, 1, 1);

  // double brass rule
  g.strokeStyle = BRASS; g.globalAlpha = 0.55; g.lineWidth = 1;
  g.strokeRect(36, 36, W - 72, H - 72);
  g.globalAlpha = 0.25; g.strokeRect(46, 46, W - 92, H - 92);
  g.globalAlpha = 1;

  g.textAlign = 'center';
  g.fillStyle = BRASS;
  g.font = '500 22px "Vault Sans", sans-serif';
  const top = d.daily ? `THE VAULT   ·   DAILY VAULT ${d.daily}` : `THE VAULT   ·   BANK ${d.bankNo}`;
  spaced(g, top, W / 2, 104, 5);

  g.fillStyle = BRASS_HI;
  g.font = 'italic 500 150px "Vault Display", Georgia, serif';
  g.fillText(d.pile.toLocaleString('en-US'), W / 2, 270);
  g.fillStyle = PAPER; g.globalAlpha = 0.7;
  g.font = '500 24px "Vault Sans", sans-serif';
  spaced(g, d.won ? `BANKED   ·   BEAT THE ${d.rank.toUpperCase()}` : `BANKED   ·   AGAINST THE ${d.rank.toUpperCase()}`, W / 2, 322, 4);
  g.globalAlpha = 1;

  g.strokeStyle = BRASS; g.globalAlpha = 0.5;
  g.beginPath(); g.moveTo(W / 2 - 60, 372); g.lineTo(W / 2 + 60, 372); g.stroke();
  g.globalAlpha = 1;

  g.fillStyle = PAPER;
  g.font = '500 58px "Vault Display", Georgia, serif';
  g.fillText(shareLine(d.bankerCorrect, d.bankerCalls), W / 2, 456);

  g.fillStyle = BRASS; g.globalAlpha = 0.75;
  g.font = '400 22px "Vault Sans", sans-serif';
  g.fillText('A banker reads your breath while you peek inside the box.', W / 2, 536);
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
