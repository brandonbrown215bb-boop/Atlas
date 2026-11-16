import type { Graphics } from 'pixi.js';
import type { MapDoc } from '../model/schema';
import { fogCover, fogMemoryCover, type Rect } from '../geom/fog';

function paintPolys(
  gfx: Graphics,
  polys: ReturnType<typeof fogCover>,
  rect: Rect,
  color: number,
  alpha: number,
  featherAlpha: number,
) {
  for (const polygon of polys) {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i]!;
      if (!ring.length) continue;
      gfx.poly(ring.flatMap(p => [p.x - rect.x, p.y - rect.y]));
      if (i === 0) gfx.fill({ color, alpha });
      else gfx.cut();
    }
    if (featherAlpha > 0 && polygon[0]?.length) {
      gfx.poly(polygon[0]!.flatMap(p => [p.x - rect.x, p.y - rect.y]));
      gfx.stroke({ color, alpha: featherAlpha, width: Math.min(1.1, Math.max(0.4, rect.w * 0.008)), join: 'round' });
    }
  }
}

export function drawFog(gfx: Graphics, map: MapDoc, rect: Rect, alpha: number) {
  gfx.clear();
  gfx.position.set(rect.x, rect.y);
  // Tier 2: Explored memory (dimmed architectural outline beyond active line of sight)
  paintPolys(gfx, fogMemoryCover(map, rect), rect, 0x0b0e17, alpha * 0.68, alpha * 0.14);
  // Tier 3: Unexplored shroud
  paintPolys(gfx, fogCover(map, rect), rect, 0x000000, alpha, alpha * 0.22);
}
