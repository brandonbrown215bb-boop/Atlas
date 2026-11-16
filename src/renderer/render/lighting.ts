import type { Graphics } from 'pixi.js';
import type { MultiPolygon } from 'polygon-clipping';
import clipping from '../geom/polygonClipping';
import { fromPolygons, rectRing, toPolygons, type Rect } from '../geom/fog';
import { collectLightBlockers, computeLightVisibilityPolygon } from '../geom/visibility';
import type { Entity, MapDoc } from '../model/schema';

export { collectLightBlockers, computeLightVisibilityPolygon };

export type LightingMode = 'ambient' | 'lights';

export function drawRoomLightingOverlay(
  gfx: Graphics,
  map: MapDoc,
  rect: Rect,
  mode: LightingMode,
): void {
  gfx.clear();
  if (map.kind !== 'interior') return;
  const entities = Object.values(map.entities);

  if (mode === 'ambient') {
    // Subtle corner & wall ambient occlusion shading for interior depth
    const aoWidth = Math.max(0.28, map.grid.size * 0.42);
    for (const e of entities) {
      if (e.type !== 'wall' || !e.blocksMove) continue;
      for (let i = 0; i < e.points.length; i++) {
        const p = e.points[i]!;
        if (i === 0) gfx.moveTo(p.x, p.y);
        else gfx.lineTo(p.x, p.y);
      }
      gfx.stroke({ width: aoWidth, color: 0x160e07, alpha: 0.14, cap: 'square', join: 'miter' });
    }
    return;
  }

  const lights = entities.filter((e): e is Extract<Entity, { type: 'light' }> => e.type === 'light');
  const blockers = collectLightBlockers(entities);
  const litPolys: MultiPolygon[] = [];

  for (const light of lights) {
    const poly = computeLightVisibilityPolygon(light, light.radius, blockers);
    if (poly.length >= 3) {
      litPolys.push(toPolygons([[poly]]));
    }
  }

  const fullRect = toPolygons([[rectRing(rect)]]);
  const darkArea = litPolys.length
    ? fromPolygons(clipping.difference(fullRect, clipping.union(...(litPolys as [MultiPolygon, ...MultiPolygon[]]))))
    : [[rectRing(rect)]];

  for (const poly of darkArea) {
    for (let i = 0; i < poly.length; i++) {
      const ring = poly[i]!;
      for (let j = 0; j < ring.length; j++) {
        const pt = ring[j]!;
        if (j === 0) gfx.moveTo(pt.x, pt.y);
        else gfx.lineTo(pt.x, pt.y);
      }
      gfx.closePath();
      if (i === 0) gfx.fill({ color: 0x0b0d16, alpha: 0.46 });
      else gfx.cut();
    }
  }

  // Warm soft rim glow inside lit visibility zones
  for (let idx = 0; idx < lights.length; idx++) {
    const light = lights[idx]!;
    const poly = computeLightVisibilityPolygon(light, light.radius * 0.72, blockers);
    if (poly.length < 3) continue;
    for (let j = 0; j < poly.length; j++) {
      const pt = poly[j]!;
      if (j === 0) gfx.moveTo(pt.x, pt.y);
      else gfx.lineTo(pt.x, pt.y);
    }
    gfx.closePath();
    gfx.fill({ color: Number.parseInt(light.color.replace('#', ''), 16) || 0xffb347, alpha: 0.1 });
  }
}
