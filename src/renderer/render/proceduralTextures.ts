import { Texture } from 'pixi.js';

export type ProceduralTextureKind =
  | 'parchment'
  | 'watercolor'
  | 'stone'
  | 'wood'
  | 'grass'
  | 'water'
  | 'vignette';

const cache = new Map<ProceduralTextureKind, Texture>();

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function makeCanvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return [canvas, ctx];
}

function paintTileableBlobs(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  minR: number,
  maxR: number,
  seed: number,
  colorAt: (t: number) => string,
): void {
  for (let i = 0; i < count; i++) {
    const x = hash2(i, 1, seed) * size;
    const y = hash2(i, 2, seed) * size;
    const r = minR + hash2(i, 3, seed) * (maxR - minR);
    const col = colorAt(hash2(i, 4, seed));
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
        const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, col);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function buildParchment(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  ctx.fillStyle = '#e8dcc2';
  ctx.fillRect(0, 0, size, size);

  paintTileableBlobs(ctx, size, 48, 22, 68, 101, (t) =>
    t > 0.5 ? 'rgba(182, 154, 112, 0.14)' : 'rgba(250, 242, 222, 0.18)',
  );

  // Subtle paper fibers and ink speckles
  for (let i = 0; i < 420; i++) {
    const x = hash2(i, 11, 202) * size;
    const y = hash2(i, 12, 202) * size;
    const len = 3 + hash2(i, 13, 202) * 9;
    const ang = hash2(i, 14, 202) * Math.PI * 2;
    ctx.strokeStyle =
      hash2(i, 15, 202) > 0.5 ? 'rgba(120, 94, 62, 0.08)' : 'rgba(255, 250, 238, 0.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  return canvas;
}

function buildWatercolor(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  ctx.fillStyle = 'rgba(235, 228, 212, 1)';
  ctx.fillRect(0, 0, size, size);
  paintTileableBlobs(ctx, size, 64, 18, 56, 303, (t) =>
    t > 0.5 ? 'rgba(140, 120, 92, 0.14)' : 'rgba(255, 252, 244, 0.16)',
  );
  return canvas;
}

function buildStone(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  ctx.fillStyle = '#9b8d76';
  ctx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 4 + (r % 2);
    const offset = (r % 2) * (size / cols) * 0.5;
    const colW = size / cols;
    for (let c = -1; c <= cols; c++) {
      const x = c * colW + offset;
      const y = r * rowH;
      const v = hash2(c + 10, r + 10, 404);
      const shade = Math.floor(150 + (v - 0.5) * 28);
      ctx.fillStyle = `rgb(${shade + 12}, ${shade + 2}, ${shade - 16})`;
      ctx.fillRect(x + 1.5, y + 1.5, colW - 3, rowH - 3);
      ctx.strokeStyle = 'rgba(54, 42, 30, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x + 1.5, y + 1.5, colW - 3, rowH - 3);
      ctx.strokeStyle = 'rgba(245, 236, 218, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2.5, y + rowH - 2.5);
      ctx.lineTo(x + 2.5, y + 2.5);
      ctx.lineTo(x + colW - 2.5, y + 2.5);
      ctx.stroke();
    }
  }
  paintTileableBlobs(ctx, size, 28, 16, 44, 405, (t) =>
    t > 0.5 ? 'rgba(58, 44, 28, 0.12)' : 'rgba(245, 232, 205, 0.08)',
  );
  return canvas;
}

function buildWood(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  ctx.fillStyle = '#8b6845';
  ctx.fillRect(0, 0, size, size);

  const planks = 10;
  const plankH = size / planks;
  for (let r = 0; r < planks; r++) {
    const y = r * plankH;
    const v = hash2(r, 1, 505);
    const baseR = Math.floor(142 + (v - 0.5) * 24);
    const baseG = Math.floor(106 + (v - 0.5) * 20);
    const baseB = Math.floor(70 + (v - 0.5) * 14);
    ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
    ctx.fillRect(0, y + 0.8, size, plankH - 1.6);

    // Grain streaks
    ctx.strokeStyle = 'rgba(62, 40, 22, 0.18)';
    ctx.lineWidth = 0.8;
    for (let g = 0; g < 3; g++) {
      const gy = y + (0.25 + g * 0.25) * plankH;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(size * 0.33, gy + (hash2(r, g, 506) - 0.5) * 4, size * 0.66, gy + (hash2(r, g + 5, 506) - 0.5) * 4, size, gy);
      ctx.stroke();
    }

    // Plank seam
    ctx.strokeStyle = 'rgba(42, 28, 16, 0.52)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();

    // End joint
    const jointX = ((r * 83 + 37) % (size - 32)) + 16;
    ctx.beginPath();
    ctx.moveTo(jointX, y);
    ctx.lineTo(jointX, y + plankH);
    ctx.stroke();
  }
  return canvas;
}

function buildGrass(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  ctx.fillStyle = '#7c8a5d';
  ctx.fillRect(0, 0, size, size);

  paintTileableBlobs(ctx, size, 58, 16, 52, 606, (t) =>
    t > 0.5 ? 'rgba(68, 86, 44, 0.20)' : 'rgba(168, 178, 114, 0.18)',
  );

  for (let i = 0; i < 240; i++) {
    const x = hash2(i, 21, 607) * size;
    const y = hash2(i, 22, 607) * size;
    ctx.strokeStyle = hash2(i, 23, 607) > 0.5 ? 'rgba(54, 70, 34, 0.22)' : 'rgba(196, 206, 146, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (hash2(i, 24, 607) - 0.5) * 3, y - 3 - hash2(i, 25, 607) * 3);
    ctx.stroke();
  }
  return canvas;
}

function buildWater(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  ctx.fillStyle = '#3f6975';
  ctx.fillRect(0, 0, size, size);

  paintTileableBlobs(ctx, size, 42, 24, 64, 707, (t) =>
    t > 0.5 ? 'rgba(30, 56, 68, 0.24)' : 'rgba(116, 166, 172, 0.18)',
  );

  // Subtle hand-drawn wave ripples
  ctx.strokeStyle = 'rgba(218, 234, 230, 0.14)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 42; i++) {
    const x = hash2(i, 31, 708) * size;
    const y = hash2(i, 32, 708) * size;
    const w = 12 + hash2(i, 33, 708) * 18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w * 0.5, y - 2.5, x + w, y);
    ctx.stroke();
  }
  return canvas;
}

function buildVignette(size: number): HTMLCanvasElement | null {
  const pair = makeCanvas(size);
  if (!pair) return null;
  const [canvas, ctx] = pair;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, size * 0.28, half, half, size * 0.72);
  grad.addColorStop(0, 'rgba(38, 26, 14, 0)');
  grad.addColorStop(0.65, 'rgba(38, 26, 14, 0.08)');
  grad.addColorStop(1, 'rgba(28, 18, 8, 0.42)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export function getProceduralTexture(kind: ProceduralTextureKind): Texture | null {
  const cached = cache.get(kind);
  if (cached && !cached.destroyed) return cached;

  let canvas: HTMLCanvasElement | null = null;
  if (kind === 'parchment') canvas = buildParchment(256);
  else if (kind === 'watercolor') canvas = buildWatercolor(256);
  else if (kind === 'stone') canvas = buildStone(256);
  else if (kind === 'wood') canvas = buildWood(256);
  else if (kind === 'grass') canvas = buildGrass(256);
  else if (kind === 'water') canvas = buildWater(256);
  else if (kind === 'vignette') canvas = buildVignette(256);

  if (!canvas) return null;
  const tex = Texture.from(canvas);
  tex.source.addressMode = kind === 'vignette' ? 'clamp-to-edge' : 'repeat';
  cache.set(kind, tex);
  return tex;
}
