import { pickGrid, vetLine, type RollCall } from "./roll-call";

// Draws the Roll Call share image on a canvas. Sizes are the design's 432×540 numbers times 2.5 (1080×1350).
// No dependencies: canvas text and a manual grayscale pass (ctx.filter is missing in Safari).

const S = 2.5;
export const WIDTH = 1080;
export const HEIGHT = 1350;
const INK = "#1b3f37",
  CORAL = "#f07060",
  DEEP = "#b8473a",
  MINT = "#d6e6dc",
  WHITE = "#ffffff";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const RULE = 2 * S;
const HEADER_H = 106 * S,
  STATS_H = 60 * S,
  VET_H = 40 * S;

// Tile text by column count (README: 13px at 2 columns, then 11 → 10 → 9px), with the design's paddings.
function tileText(cols: number, rows: number) {
  if (cols === 2) return rows === 1 ? { size: 13, padX: 10, padY: 8, lh: 1.25 } : { size: 11, padX: 10, padY: 6, lh: 1.25 };
  if (cols === 3) return { size: 10, padX: 8, padY: 6, lh: 1.25 };
  if (cols === 4) return { size: 9, padX: 7, padY: 5, lh: 1.25 };
  return { size: 9, padX: 5, padY: 5, lh: 1.2 };
}

type Ctx = CanvasRenderingContext2D;

function spaced(ctx: Ctx, text: string, x: number, y: number, spacing: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

/** Greedy word wrap into at most `max` lines; the last line gets an ellipsis if text is left over. */
function wrap(ctx: Ctx, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = words[i];
      if (lines.length === max - 1) {
        line = words.slice(i).join(" ");
        break;
      }
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => ellipsize(ctx, l, width));
}

function ellipsize(ctx: Ctx, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function hline(ctx: Ctx, x1: number, x2: number, y: number) {
  ctx.fillStyle = INK;
  ctx.fillRect(x1, y, x2 - x1, RULE);
}
function vline(ctx: Ctx, x: number, y1: number, y2: number) {
  ctx.fillStyle = INK;
  ctx.fillRect(x, y1, RULE, y2 - y1);
}

/** object-fit: cover into the box, printed in grayscale. */
function drawPhoto(ctx: Ctx, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.round(w));
  tmp.height = Math.max(1, Math.round(h));
  const t = tmp.getContext("2d")!;
  const scale = Math.max(tmp.width / img.width, tmp.height / img.height);
  const dw = img.width * scale,
    dh = img.height * scale;
  t.drawImage(img, (tmp.width - dw) / 2, (tmp.height - dh) / 2, dw, dh);
  const data = t.getImageData(0, 0, tmp.width, tmp.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const g = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = g;
  }
  t.putImageData(data, 0, 0);
  ctx.drawImage(tmp, x, y);
}

/** Draws the image. `images` maps a tile's photoUrl to a decoded image; tiles without one get a plain mint fill. */
export function drawRollCall(
  canvas: HTMLCanvasElement,
  roll: RollCall,
  images: Map<string, CanvasImageSource & { width: number; height: number }>,
) {
  const grid = pickGrid(roll.cats.length);
  if (!grid) throw new Error("No cats to draw.");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Header
  const L = RULE,
    R = WIDTH - RULE,
    top = RULE;
  ctx.fillStyle = INK;
  ctx.font = `${10 * S}px ${SANS}`;
  spaced(ctx, roll.dateLabel.toUpperCase(), L + 16 * S, top + 16 * S + 9 * S, 0.12 * 10 * S);
  ctx.font = `800 ${26 * S}px ${SERIF}`;
  const hl = 26 * 1.05 * S;
  roll.headline.forEach((line, i) => ctx.fillText(line, L + 16 * S, top + 16 * S + 12 * S + 6 * S + hl * (i + 0.8)));
  hline(ctx, L, R, top + HEADER_H - RULE);

  // Vertical budget: the grid takes whatever the stats row and vet strip leave.
  const vet = vetLine(roll.needVet);
  const statsH = roll.stats.length ? STATS_H : 0,
    vetH = vet ? VET_H : 0;
  const gridTop = top + HEADER_H,
    gridBottom = HEIGHT - RULE - statsH - vetH;
  const cw = (R - L) / grid.cols,
    ch = (gridBottom - gridTop) / grid.rows;

  // Tile text metrics are shared by every tile so photos line up across a row.
  const tt = tileText(grid.cols, grid.rows);
  const fs = tt.size * S,
    lh = fs * tt.lh;
  const textW = cw - 2 * tt.padX * S - RULE;
  const tiles = roll.cats.slice(0, grid.shown);
  ctx.font = `700 ${fs}px ${SANS}`;
  const labelLines = tiles.map((t) => wrap(ctx, t.label, textW, 2));
  const maxLabel = Math.max(...labelLines.map((l) => l.length));
  const textH = 2 * tt.padY * S + (maxLabel + 1) * lh;

  for (let i = 0; i < grid.cells; i++) {
    const col = i % grid.cols,
      row = Math.floor(i / grid.cols);
    const x = L + col * cw,
      y = gridTop + row * ch;
    const tile = tiles[i];
    if (!tile && !(grid.more && i === grid.cells - 1)) {
      ctx.fillStyle = MINT; // leftover cell: a plain block, never a stretched tile
      ctx.fillRect(x, y, cw, ch);
    } else if (!tile) {
      ctx.fillStyle = MINT;
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = INK;
      const more = `+${grid.more} more`;
      let size = 24 * S;
      do ctx.font = `800 ${size}px ${SERIF}`;
      while (ctx.measureText(more).width > cw - 16 * S && (size -= S) > 8 * S);
      ctx.textAlign = "center";
      ctx.fillText(more, x + cw / 2, y + ch / 2 + size / 3);
      ctx.textAlign = "left";
    } else {
      const photoH = ch - textH;
      ctx.fillStyle = MINT;
      ctx.fillRect(x, y, cw, photoH);
      const img = tile.photoUrl ? images.get(tile.photoUrl) : undefined;
      if (img) drawPhoto(ctx, img, x, y, cw, photoH);
      ctx.font = `700 ${fs}px ${SANS}`;
      ctx.fillStyle = INK;
      const tx = x + tt.padX * S;
      let ty = y + photoH + tt.padY * S + fs;
      for (const line of labelLines[i]) {
        ctx.fillText(line, tx, ty);
        ty += lh;
      }
      ctx.font = `400 ${fs}px ${SANS}`;
      ctx.fillStyle = DEEP;
      ctx.fillText(ellipsize(ctx, tile.status, textW), tx, ty);
    }
  }
  // Rules between tiles
  for (let c = 1; c < grid.cols; c++) vline(ctx, L + c * cw - RULE / 2, gridTop, gridBottom);
  for (let r = 1; r < grid.rows; r++) hline(ctx, L, R, gridTop + r * ch - RULE / 2);

  // Stats
  if (statsH) {
    const sy = gridBottom;
    hline(ctx, L, R, sy);
    const sw = (R - L) / roll.stats.length;
    roll.stats.forEach((s, i) => {
      const x = L + i * sw;
      if (i > 0) vline(ctx, x - RULE / 2, sy, sy + statsH);
      ctx.fillStyle = INK;
      ctx.font = `800 ${24 * S}px ${SERIF}`;
      ctx.fillText(String(s.value), x + 12 * S, sy + RULE + 10 * S + 22 * S);
      ctx.font = `400 ${10 * S}px ${SANS}`;
      ctx.fillText(s.label, x + 12 * S, sy + RULE + 10 * S + 24 * S + 11 * S);
    });
  }

  // Vet strip
  if (vet) {
    const vy = HEIGHT - RULE - VET_H;
    ctx.fillStyle = CORAL;
    ctx.fillRect(L, vy, R - L, VET_H);
    hline(ctx, L, R, vy);
    ctx.fillStyle = INK;
    ctx.font = `700 ${14 * S}px ${SANS}`;
    ctx.fillText(vet, L + 16 * S, vy + RULE + 10 * S + 14 * S);
  }

  // Card border
  ctx.strokeStyle = INK;
  ctx.lineWidth = RULE;
  ctx.strokeRect(RULE / 2, RULE / 2, WIDTH - RULE, HEIGHT - RULE);
}

async function loadImage(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("photo failed");
  const bitmap = await createImageBitmap(await res.blob());
  return bitmap;
}

/** Fetches the tile photos (a missing one just stays mint) and returns the finished PNG. */
export async function renderRollCallPng(roll: RollCall): Promise<Blob> {
  const grid = pickGrid(roll.cats.length);
  if (!grid) throw new Error("No cats to draw.");
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    roll.cats.slice(0, grid.shown).map(async (c) => {
      if (!c.photoUrl) return;
      try {
        images.set(c.photoUrl, await loadImage(c.photoUrl));
      } catch {
        /* leave the tile mint */
      }
    }),
  );
  const canvas = document.createElement("canvas");
  drawRollCall(canvas, roll, images);
  images.forEach((b) => b.close());
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}
