import type { Graphics } from 'pixi.js';
import {
  resolveWallChannels,
  type AreaEntity,
  type DoorEntity,
  type Point,
  type PortalEntity,
  type RoofShape,
  type WallEntity,
} from '../model/schema';

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function drawDashedPolyline(
  gfx: Graphics,
  points: Point[],
  origin: Point,
  dashLen: number,
  gapLen: number,
  closed = false,
): void {
  const segs: Array<[Point, Point]> = [];
  for (let i = 1; i < points.length; i++) {
    segs.push([points[i - 1]!, points[i]!]);
  }
  if (closed && points.length >= 3) {
    segs.push([points[points.length - 1]!, points[0]!]);
  }
  const period = Math.max(0.01, dashLen + gapLen);
  let carry = 0;
  for (const [a, b] of segs) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    let dist = 0;
    const minStep = Math.max(1e-5, period * 1e-3);
    while (dist < len - 1e-7) {
      const phase = (dist + carry) % period;
      if (phase < dashLen) {
        const end = Math.min(len, dist + Math.max(minStep, dashLen - phase));
        gfx
          .moveTo(a.x - origin.x + ux * dist, a.y - origin.y + uy * dist)
          .lineTo(a.x - origin.x + ux * end, a.y - origin.y + uy * end);
        if (end <= dist) break;
        dist = end;
      } else {
        const end = Math.min(len, dist + Math.max(minStep, period - phase));
        if (end <= dist) break;
        dist = end;
      }
    }
    carry = (carry + len) % period;
  }
}

export function drawBuildingRoof(
  gfx: Graphics,
  entity: AreaEntity,
  outer: Point[],
  origin: Point,
  strokeUnit: number,
  roofMode: 'detailed' | 'simple' | 'hidden',
): void {
  if (roofMode === 'hidden') {
    // Architectural hidden-roof outline revealing underlying space
    gfx.poly(outer.flatMap((p) => [p.x - origin.x, p.y - origin.y]));
    gfx.fill({ color: 0xe6dcc8, alpha: 0.14 });
    drawDashedPolyline(
      gfx,
      outer,
      origin,
      Math.max(0.6, strokeUnit * 3),
      Math.max(0.45, strokeUnit * 2.2),
      true,
    );
    gfx.stroke({ width: strokeUnit * 1.1, color: 0x3b2c1d, alpha: 0.72 });
    return;
  }
  if (roofMode === 'simple') {
    // Crisp flat tactical silhouette with a clean diagonal ridge crease
    return;
  }

  // Detailed architectural roofs (gable, hip, spire, and general N-gon polygonal fan shading)
  const h = hashString(entity.id);
  const chosen: RoofShape =
    entity.roofShape ?? (outer.length > 4 ? 'hip' : h % 3 === 0 ? 'hip' : 'gable');

  if (outer.length === 4 && chosen !== 'spire') {
    let [a, b, c, d] = outer as [Point, Point, Point, Point];
    if (Math.hypot(b.x - a.x, b.y - a.y) < Math.hypot(d.x - a.x, d.y - a.y)) {
      [a, b, c, d] = [b, c, d, a];
    }
    const lenMajor = Math.hypot(b.x - a.x, b.y - a.y);
    const lenMinor = Math.hypot(d.x - a.x, d.y - a.y);
    const r1 = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
    const r2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    if (chosen === 'hip' && lenMajor > lenMinor * 1.15) {
      const inset = Math.min(0.32, (lenMinor * 0.45) / Math.max(1e-4, lenMajor));
      const h1 = { x: a.x * (1 - inset) + b.x * inset, y: a.y * (1 - inset) + b.y * inset };
      const h1d = { x: d.x * (1 - inset) + c.x * inset, y: d.y * (1 - inset) + c.y * inset };
      const h2 = { x: b.x * (1 - inset) + a.x * inset, y: b.y * (1 - inset) + a.y * inset };
      const h2c = { x: c.x * (1 - inset) + d.x * inset, y: c.y * (1 - inset) + d.y * inset };
      const ridge1 = { x: (h1.x + h1d.x) / 2, y: (h1.y + h1d.y) / 2 };
      const ridge2 = { x: (h2.x + h2c.x) / 2, y: (h2.y + h2c.y) / 2 };
      const facets: Array<[Point[], number]> = [
        [[a, b, ridge2, ridge1], 0.2],
        [[d, ridge1, ridge2, c], -0.22],
        [[a, ridge1, d], 0.08],
        [[b, c, ridge2], -0.14],
      ];
      for (const [pts, light] of facets) {
        gfx.poly(pts.flatMap((p) => [p.x - origin.x, p.y - origin.y]));
        gfx.fill({ color: light >= 0 ? 0xfff4dc : 0x1a110a, alpha: Math.abs(light) });
      }
      gfx
        .moveTo(a.x - origin.x, a.y - origin.y)
        .lineTo(ridge1.x - origin.x, ridge1.y - origin.y)
        .lineTo(d.x - origin.x, d.y - origin.y)
        .moveTo(b.x - origin.x, b.y - origin.y)
        .lineTo(ridge2.x - origin.x, ridge2.y - origin.y)
        .lineTo(c.x - origin.x, c.y - origin.y)
        .moveTo(ridge1.x - origin.x, ridge1.y - origin.y)
        .lineTo(ridge2.x - origin.x, ridge2.y - origin.y)
        .stroke({ width: strokeUnit * 1.15, color: 0x2b1e12, alpha: 0.72, cap: 'round' });
      return;
    }

    const r1Lit = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0;
    const lit = r1Lit ? [a, b, r2, r1] : [d, c, r2, r1];
    const shaded = r1Lit ? [r1, r2, c, d] : [r1, r2, b, a];
    gfx.poly(lit.flatMap((p) => [p.x - origin.x, p.y - origin.y]));
    gfx.fill({ color: 0xfff4dc, alpha: 0.2 });
    gfx.poly(shaded.flatMap((p) => [p.x - origin.x, p.y - origin.y]));
    gfx.fill({ color: 0x1a110a, alpha: 0.24 });
    gfx
      .moveTo(r1.x - origin.x, r1.y - origin.y)
      .lineTo(r2.x - origin.x, r2.y - origin.y)
      .stroke({ width: strokeUnit * 1.35, color: 0x2b1e12, alpha: 0.78, cap: 'round' });
    gfx
      .moveTo(r1.x - origin.x, r1.y - origin.y)
      .lineTo(r2.x - origin.x, r2.y - origin.y)
      .stroke({ width: strokeUnit * 0.55, color: 0xf6ead0, alpha: 0.48, cap: 'round' });
    return;
  }

  // N-gon / octagonal / wing / keep polygonal centroid fan shading with NW sun vector
  const cx = outer.reduce((s, p) => s + p.x, 0) / outer.length;
  const cy = outer.reduce((s, p) => s + p.y, 0) / outer.length;
  const ctr = { x: cx, y: cy };
  for (let i = 0; i < outer.length; i++) {
    const p1 = outer[i]!;
    const p2 = outer[(i + 1) % outer.length]!;
    const mx = (p1.x + p2.x) / 2 - cx;
    const my = (p1.y + p2.y) / 2 - cy;
    const len = Math.hypot(mx, my) || 1;
    // NW sun vector dot product (-0.707, -0.707)
    const dot = ((-mx / len) * 0.707 + (-my / len) * 0.707);
    gfx.poly([p1.x - origin.x, p1.y - origin.y, p2.x - origin.x, p2.y - origin.y, cx - origin.x, cy - origin.y]);
    gfx.fill({ color: dot >= 0 ? 0xfff4dc : 0x1a110a, alpha: 0.06 + Math.abs(dot) * 0.18 });
    gfx
      .moveTo(p1.x - origin.x, p1.y - origin.y)
      .lineTo(ctr.x - origin.x, ctr.y - origin.y)
      .stroke({ width: strokeUnit * 0.85, color: 0x2b1e12, alpha: 0.55 });
  }
  gfx.circle(cx - origin.x, cy - origin.y, strokeUnit * 1.4).fill({ color: 0x2b1e12, alpha: 0.65 });
}

export function isSpecialWall(entity: WallEntity): boolean {
  const k = resolveWallChannels(entity).wallKind;
  return k === 'invisible' || k === 'ethereal' || k === 'terrain' || k === 'window';
}

export function drawWallStyled(
  gfx: Graphics,
  entity: WallEntity,
  origin: Point,
  strokeUnit: number,
  selected: boolean,
  hatchExternal: boolean | ((pt: Point) => boolean) = false,
  pass: 'all' | 'shadow' | 'casing' | 'core' = 'all',
): void {
  const ch = resolveWallChannels(entity);
  const wallW = Math.max(0.28, strokeUnit * 2.8);
  const drawPts = (ox: number, oy: number) => {
    for (let i = 0; i < entity.points.length; i++) {
      const p = entity.points[i]!;
      if (i === 0) gfx.moveTo(p.x - ox, p.y - oy);
      else gfx.lineTo(p.x - ox, p.y - oy);
    }
  };
  const strokeBedrockHatches = (
    stride: number,
    outerLen: number,
    lineWidth: number,
    alpha: number,
    slantMag: number,
  ) => {
    const isFloor = typeof hatchExternal === 'function' ? hatchExternal : undefined;
    const clampedLen = outerLen * 0.68;
    const probeDist = Math.max(0.4, wallW * 1.1);
    const endPad = Math.max(stride * 0.42, wallW * 0.85);
    const clearOfFloor = (wx: number, wy: number, sx: number, sy: number, nx: number, ny: number): boolean => {
      if (!isFloor) return true;
      if (isFloor({ x: wx + nx * probeDist, y: wy + ny * probeDist })) return false;
      if (isFloor({ x: wx + sx * (clampedLen * 0.55), y: wy + sy * (clampedLen * 0.55) })) return false;
      if (isFloor({ x: wx + sx * clampedLen, y: wy + sy * clampedLen })) return false;
      const lat = wallW * 0.35;
      if (isFloor({ x: wx + sx * clampedLen - ny * lat, y: wy + sy * clampedLen + nx * lat })) return false;
      if (isFloor({ x: wx + sx * clampedLen + ny * lat, y: wy + sy * clampedLen - nx * lat })) return false;
      return true;
    };
    let acc = 0;
    for (let i = 1; i < entity.points.length; i++) {
      const a = entity.points[i - 1]!, b = entity.points[i]!;
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < endPad * 1.6) continue;
      const tx = (b.x - a.x) / segLen, ty = (b.y - a.y) / segLen;
      const nx = -ty, ny = tx;
      for (let d = endPad; d <= segLen - endPad + 1e-4; d += stride) {
        acc += 1;
        const wx = a.x + tx * d, wy = a.y + ty * d;
        const mx = wx - origin.x, my = wy - origin.y;
        const groupFlip = Math.floor(acc / 3) % 2 === 0 ? 1 : -1;
        const dxOut = nx + tx * slantMag * groupFlip;
        const dyOut = ny + ty * slantMag * groupFlip;
        const okPlus = clearOfFloor(wx, wy, dxOut, dyOut, nx, ny);
        const okMinus = clearOfFloor(wx, wy, -dxOut, -dyOut, -nx, -ny);
        const touchesPlusFloor = isFloor ? isFloor({ x: wx + nx * probeDist, y: wy + ny * probeDist }) : false;
        const touchesMinusFloor = isFloor ? isFloor({ x: wx - nx * probeDist, y: wy - ny * probeDist }) : false;
        if (okPlus && touchesMinusFloor && !touchesPlusFloor) {
          gfx.moveTo(mx + nx * wallW * 0.35, my + ny * wallW * 0.35)
            .lineTo(mx + dxOut * clampedLen, my + dyOut * clampedLen);
        } else if (okMinus && touchesPlusFloor && !touchesMinusFloor) {
          gfx.moveTo(mx - nx * wallW * 0.35, my - ny * wallW * 0.35)
            .lineTo(mx - dxOut * clampedLen, my - dyOut * clampedLen);
        } else if (!isFloor && okPlus && okMinus) {
          gfx.moveTo(mx - dxOut * (clampedLen * 0.5), my - dyOut * (clampedLen * 0.5))
            .lineTo(mx + dxOut * (clampedLen * 0.5), my + dyOut * (clampedLen * 0.5));
        }
      }
    }
    gfx.stroke({ width: lineWidth, color: 0x16110b, alpha, cap: 'round' });
  };

  if (ch.wallKind === 'invisible' || ch.wallKind === 'ethereal') {
    const col = selected ? 0xfbbf24 : ch.wallKind === 'invisible' ? 0x38bdf8 : 0xc084fc;
    drawDashedPolyline(gfx, entity.points, origin, wallW * 1.3, wallW * 0.9, false);
    gfx.stroke({ width: wallW * 0.55, color: col, alpha: 0.85, cap: 'butt' });
    return;
  }

  if (ch.wallKind === 'terrain') {
    const col = selected ? 0xfbbf24 : 0x5c4028;
    // Soft rock wall shadow + continuous organic cavern wall contour + spaced cliff hachures
    drawPts(origin.x - wallW * 0.28, origin.y - wallW * 0.28);
    gfx.stroke({ width: wallW * 1.15, color: 0x1a120a, alpha: 0.24, cap: 'round', join: 'round' });
    if (hatchExternal && !selected) {
      strokeBedrockHatches(Math.max(0.6, wallW * 1.9), wallW * 2.3, Math.max(0.06, wallW * 0.22), 0.55, 0.45);
    }
    drawPts(origin.x, origin.y);
    gfx.stroke({ width: wallW * 0.85, color: col, alpha: 0.94, cap: 'round', join: 'round' });
    let accum = 0;
    const tickStride = Math.max(0.7, wallW * 3.2);
    for (let i = 1; i < entity.points.length; i++) {
      const a = entity.points[i - 1]!, b = entity.points[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      accum += len;
      if (accum < tickStride || len < 1e-4) continue;
      accum = 0;
      const mx = (a.x + b.x) / 2 - origin.x, my = (a.y + b.y) / 2 - origin.y;
      const nx = -(b.y - a.y) / len * wallW * 0.68, ny = (b.x - a.x) / len * wallW * 0.68;
      gfx.moveTo(mx - nx, my - ny).lineTo(mx + nx, my + ny);
    }
    gfx.stroke({ width: wallW * 0.3, color: col, alpha: 0.72, cap: 'round' });
    return;
  }

  if (ch.wallKind === 'window') {
    if (!selected) {
      const sOff = wallW * 0.4;
      drawPts(origin.x - sOff, origin.y - sOff);
      gfx.stroke({ width: wallW * 1.1, color: 0x1a120a, alpha: 0.28, cap: 'square', join: 'miter' });
    }
    drawPts(origin.x, origin.y);
    gfx.stroke({ width: wallW, color: selected ? 0xfbbf24 : 0x2b2016, cap: 'square', join: 'miter' });
    drawPts(origin.x, origin.y);
    gfx.stroke({ width: wallW * 0.48, color: 0xbae6fd, alpha: 0.92, cap: 'butt', join: 'miter' });
    return;
  }

  // Standard solid stone/plaster wall with crisp merged mitered corners (supports separate 3-pass rendering for clean T/L joins)
  if (!selected && (pass === 'all' || pass === 'shadow')) {
    const sOff = wallW * 0.45;
    drawPts(origin.x - sOff, origin.y - sOff);
    gfx.stroke({ width: wallW * 1.15, color: 0x1a120a, alpha: 0.36, cap: 'square', join: 'miter' });
    if (hatchExternal) {
      strokeBedrockHatches(Math.max(0.55, wallW * 1.55), wallW * 2.7, Math.max(0.06, wallW * 0.24), 0.62, 0.55);
    }
  }
  if (pass === 'all' || pass === 'casing') {
    drawPts(origin.x, origin.y);
    gfx.stroke({
      width: wallW,
      color: selected ? 0xfbbf24 : 0x2b2016,
      cap: 'square',
      join: 'miter',
    });
  }
  if (!selected && (pass === 'all' || pass === 'core')) {
    drawPts(origin.x, origin.y);
    gfx.stroke({
      width: wallW * 0.52,
      color: 0xd9ccb2,
      cap: 'square',
      join: 'miter',
    });
  }
}

export function drawDoorStyled(
  gfx: Graphics,
  entity: DoorEntity,
  strokeUnit: number,
  selected: boolean,
): void {
  const dx = entity.b.x - entity.a.x;
  const dy = entity.b.y - entity.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = -dy / len;
  const ny = dx / len;
  const w = Math.max(0.24, strokeUnit * 2.5);

  // Timber frame / stone jamb blocks
  gfx
    .moveTo(-nx * w * 0.65, -ny * w * 0.65)
    .lineTo(nx * w * 0.65, ny * w * 0.65)
    .moveTo(dx - nx * w * 0.65, dy - ny * w * 0.65)
    .lineTo(dx + nx * w * 0.65, dy + ny * w * 0.65)
    .stroke({ width: Math.max(0.16, w * 0.42), color: 0x2b2016 });

  if (entity.material === 'iron' && entity.kind !== 'secret') {
    gfx.moveTo(0, 0).lineTo(dx, dy).stroke({
      width: w * (entity.open ? .44 : .75), color: selected ? 0xfbbf24 : 0x495253,
      alpha: entity.open ? .55 : 1,
    });
    if (!entity.open) {
      for (const t of [.12, .27, .42, .58, .73, .88]) {
        gfx.moveTo(dx * t - nx * w * .6, dy * t - ny * w * .6)
          .lineTo(dx * t + nx * w * .6, dy * t + ny * w * .6)
          .stroke({ width: Math.min(len * .07, w * .3), color: selected ? 0xfbbf24 : 0x252d2d });
      }
    }
  } else if (entity.open && entity.kind !== 'secret') {
    // Open battlemap door: worn stone threshold strip + folded plank leaf tucked beside hinge jamb (no blueprint swing arc)
    gfx
      .moveTo(0, 0)
      .lineTo(dx, dy)
      .stroke({ width: w * 0.45, color: 0x6b5845, alpha: 0.45, cap: 'butt' });
    const swing = entity.swing ?? 1;
    const hingeA = entity.hinge !== 'b';
    const hx = hingeA ? 0 : dx;
    const hy = hingeA ? 0 : dy;
    const ux = (hingeA ? dx : -dx) / len;
    const uy = (hingeA ? dy : -dy) / len;
    const lx = -uy * swing * len * 0.72;
    const ly = ux * swing * len * 0.72;
    gfx
      .moveTo(hx, hy)
      .lineTo(hx + lx, hy + ly)
      .stroke({ width: w * 0.9, color: selected ? 0xfbbf24 : 0x2b2016, cap: 'butt' });
    if (!selected) {
      gfx
        .moveTo(hx, hy)
        .lineTo(hx + lx, hy + ly)
        .stroke({ width: w * 0.56, color: 0x9c5e34, cap: 'butt' });
    }
  } else {
    gfx
      .moveTo(0, 0)
      .lineTo(dx, dy)
      .stroke({ width: w * 1.25, color: selected ? 0xfbbf24 : 0x2b2016, cap: 'butt' });
    if (!selected) {
      gfx
        .moveTo(0, 0)
        .lineTo(dx, dy)
        .stroke({ width: w * 0.78, color: entity.kind === 'secret' ? 0xb88b5a : 0x8f552e, cap: 'butt' });
      if (entity.kind !== 'secret') {
        // Twin dark iron strap hinges on door leaf
        for (const t of [0.22, 0.78]) {
          gfx
            .moveTo(dx * t - nx * w * 0.36, dy * t - ny * w * 0.36)
            .lineTo(dx * t + nx * w * 0.36, dy * t + ny * w * 0.36)
            .stroke({ width: Math.max(0.08, w * 0.16), color: 0x2b2016 });
        }
      }
    }
  }

  if (entity.locked && entity.kind !== 'secret') {
    gfx
      .circle(dx / 2, dy / 2, Math.max(0.18, strokeUnit * 2.2))
      .fill({ color: 0xe6c15c })
      .stroke({ width: Math.max(0.06, strokeUnit * 0.7), color: 0x2b2016 });
  }

  if (entity.oneWay && !entity.open && entity.kind !== 'secret') {
    const dir = entity.oneWay === 'ab' ? 1 : -1;
    const mx = dx / 2;
    const my = dy / 2;
    const barOff = w * 0.85 * -dir;
    const ux = dx / len;
    const uy = dy / len;
    const halfBar = Math.min(len * 0.34, w * 1.45);
    // Timber drop-bar on the pushable/barred side
    gfx
      .moveTo(mx + nx * barOff - ux * halfBar, my + ny * barOff - uy * halfBar)
      .lineTo(mx + nx * barOff + ux * halfBar, my + ny * barOff + uy * halfBar)
      .stroke({ width: Math.max(0.14, w * 0.42), color: selected ? 0xfbbf24 : 0xd97706, cap: 'round' });
    // Small chevron pointing in the openable travel direction
    const tip = w * 1.15 * dir;
    const base = w * 0.35 * dir;
    const wing = Math.max(0.16, w * 0.55);
    gfx
      .moveTo(mx + nx * base - ux * wing, my + ny * base - uy * wing)
      .lineTo(mx + nx * tip, my + ny * tip)
      .lineTo(mx + nx * base + ux * wing, my + ny * base + uy * wing)
      .stroke({ width: Math.max(0.1, w * 0.28), color: selected ? 0xfbbf24 : 0x2b2016, cap: 'round', join: 'round' });
  }

  if (entity.kind === 'secret') {
    const r = Math.max(0.25, strokeUnit * 3.5);
    gfx
      .circle(dx / 2, dy / 2, r)
      .fill({ color: 0xa855f7, alpha: 0.9 })
      .stroke({ width: strokeUnit * 0.8, color: 0x2b2016 });
  }
}

export function drawConnectorSymbol(
  gfx: Graphics,
  entity: PortalEntity,
  strokeUnit: number,
  zoom: number,
  selected: boolean,
): void {
  const kind = entity.connectorKind ?? 'portal';
  const col = selected ? 0xfbbf24 : 0x2b1e12;
  const r = Math.max(0.45, Math.min(1.4, 9 / Math.max(0.01, zoom)));

  if (kind === 'portal') {
    const pr = Math.max(0.6, 8 / Math.max(0.01, zoom));
    gfx
      .moveTo(0, -pr)
      .lineTo(pr, 0)
      .lineTo(0, pr)
      .lineTo(-pr, 0)
      .closePath()
      .fill({ color: 0xa855f7, alpha: 0.35 })
      .stroke({ width: strokeUnit * 1.5, color: selected ? 0xfbbf24 : 0xa855f7 });
    return;
  }

  if (kind === 'stairsUp' || kind === 'stairsDown') {
    const dir = kind === 'stairsUp' ? -1 : 1;
    gfx.rect(-r, -r * 0.8, r * 2, r * 1.6).fill({ color: 0xc2b093, alpha: 0.92 }).stroke({ width: strokeUnit * 1.1, color: col });
    for (let s = -2; s <= 2; s++) {
      const y = s * r * 0.28;
      const treadW = r * (0.72 + ((dir > 0 ? 2 - s : 2 + s) / 4) * 0.24);
      gfx.moveTo(-treadW, y).lineTo(treadW, y).stroke({ width: strokeUnit * 0.8, color: col, alpha: 0.82 });
    }
    gfx
      .moveTo(0, -dir * r * 0.52)
      .lineTo(-r * 0.32, dir * r * 0.28)
      .lineTo(r * 0.32, dir * r * 0.28)
      .closePath()
      .fill({ color: dir < 0 ? 0x22684c : 0x8f3328, alpha: 0.9 });
    return;
  }

  if (kind === 'spiralStairs') {
    gfx.circle(0, 0, r).fill({ color: 0xc2b093, alpha: 0.92 }).stroke({ width: strokeUnit * 1.1, color: col });
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      gfx.moveTo(0, 0).lineTo(Math.cos(a) * r, Math.sin(a) * r).stroke({ width: strokeUnit * 0.75, color: col, alpha: 0.78 });
    }
    gfx.circle(0, 0, r * 0.25).fill({ color: 0x3b2c1d });
    return;
  }

  if (kind === 'ladder') {
    gfx.circle(0, 0, r * 0.85).fill({ color: 0x1e150e, alpha: 0.48 }).stroke({ width: strokeUnit * 1.1, color: col });
    gfx
      .moveTo(-r * 0.32, -r * 0.72).lineTo(-r * 0.32, r * 0.72)
      .moveTo(r * 0.32, -r * 0.72).lineTo(r * 0.32, r * 0.72)
      .stroke({ width: strokeUnit * 1.1, color: 0x9c5e34 });
    for (let s = -2; s <= 2; s++) {
      gfx.moveTo(-r * 0.32, s * r * 0.26).lineTo(r * 0.32, s * r * 0.26).stroke({ width: strokeUnit * 0.9, color: 0xd6b78b });
    }
    return;
  }

  if (kind === 'slope') {
    gfx.rect(-r, -r * 0.75, r * 2, r * 1.5).fill({ color: 0xb7aa95, alpha: 0.88 }).stroke({ width: strokeUnit, color: col });
    for (const off of [-r * 0.45, 0, r * 0.45]) {
      gfx.moveTo(off - r * 0.22, -r * 0.4).lineTo(off + r * 0.2, 0).lineTo(off - r * 0.22, r * 0.4)
        .stroke({ width: strokeUnit * 0.9, color: col, alpha: 0.72 });
    }
    return;
  }

  if (kind === 'chute') {
    gfx.circle(0, 0, r * 0.85).fill({ color: 0x16110c, alpha: 0.88 }).stroke({ width: strokeUnit * 1.3, color: 0x5c4732 });
    gfx.circle(0, 0, r * 0.45).fill({ color: 0x050403, alpha: 0.95 });
    return;
  }

  if (kind === 'balcony') {
    gfx.rect(-r * 1.1, -r * 0.55, r * 2.2, r * 1.1).fill({ color: 0xcabaa0, alpha: 0.82 }).stroke({ width: strokeUnit * 1.1, color: col });
    for (let i = -3; i <= 3; i++) {
      gfx.circle(i * r * 0.28, r * 0.45, strokeUnit * 1.2).fill({ color: col });
    }
    return;
  }

  if (kind === 'pit' || kind === 'chimney') {
    gfx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7).fill({ color: 0x0d0b09, alpha: 0.9 }).stroke({ width: strokeUnit * 1.2, color: col });
    gfx.moveTo(-r * 0.85, -r * 0.85).lineTo(r * 0.85, r * 0.85).moveTo(r * 0.85, -r * 0.85).lineTo(-r * 0.85, r * 0.85)
      .stroke({ width: strokeUnit * 0.8, color: kind === 'chimney' ? 0xc2b093 : 0x5c4732, alpha: 0.72 });
    return;
  }

  if (kind === 'secretStair') {
    gfx.rect(-r, -r * 0.8, r * 2, r * 1.6).fill({ color: 0xc2b093, alpha: 0.55 }).stroke({ width: strokeUnit * 1.1, color: 0xa855f7 });
    for (let s = -1; s <= 1; s++) gfx.moveTo(-r * 0.7, s * r * 0.35).lineTo(r * 0.7, s * r * 0.35).stroke({ width: strokeUnit * 0.8, color: 0x7e22ce });
    return;
  }

  if (kind === 'elevator' || kind === 'hatch') {
    gfx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7).fill({ color: kind === 'elevator' ? 0x7a654a : 0x8f5d38, alpha: 0.9 }).stroke({ width: strokeUnit * 1.2, color: col });
    gfx.rect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1).stroke({ width: strokeUnit * 0.8, color: 0x2b1e12 });
    gfx.circle(r * 0.3, 0, strokeUnit * 1.2).fill({ color: 0xe6c15c });
    return;
  }

  if (kind === 'waterfall' || kind === 'siphon') {
    gfx.circle(0, 0, r * 0.9).fill({ color: 0x2e6f8c, alpha: 0.78 }).stroke({ width: strokeUnit * 1.1, color: 0x164254 });
    for (const dx of [-0.35, 0, 0.35]) {
      gfx.moveTo(dx * r, -r * 0.55).lineTo(dx * r, r * 0.55).stroke({ width: strokeUnit * 0.9, color: 0xd0f0f5, alpha: 0.82 });
    }
    return;
  }

  if (kind === 'teleport' || kind === 'passwall') {
    gfx.circle(0, 0, r * 0.9).fill({ color: kind === 'teleport' ? 0x38bdf8 : 0xf59e0b, alpha: 0.25 }).stroke({ width: strokeUnit * 1.2, color: kind === 'teleport' ? 0x0284c7 : 0xd97706 });
    gfx.circle(0, 0, r * 0.45).stroke({ width: strokeUnit, color: col });
    return;
  }

  // Rubble choke
  const stones = [[-0.45, -0.25, 0.38], [0.25, -0.3, 0.35], [-0.15, 0.25, 0.42], [0.42, 0.22, 0.32], [0, 0, 0.34]];
  for (const [sx, sy, sr] of stones) {
    gfx.circle(sx! * r, sy! * r, sr! * r).fill(0x887d6d).stroke({ width: strokeUnit * 0.8, color: col });
  }
}
