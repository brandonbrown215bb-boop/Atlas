import type { Graphics } from 'pixi.js';
import type { MapDoc } from '../model/schema';
import { fogCover, type Rect } from '../geom/fog';

export function drawFog(gfx: Graphics, map: MapDoc, rect: Rect, alpha: number) {
  gfx.clear();
  gfx.position.set(rect.x, rect.y);
  for (const polygon of fogCover(map, rect)) {
    for (let i=0; i<polygon.length; i++) {
      const ring=polygon[i]!;
      if (!ring.length) continue;
      gfx.poly(ring.flatMap(p => [p.x-rect.x,p.y-rect.y]));
      if (i===0) gfx.fill({color:0x000000,alpha});
      else gfx.cut();
    }
  }
}
