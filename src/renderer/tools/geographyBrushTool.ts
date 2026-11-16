import { viewStore } from '../model/viewStore';
import { resolveTargetLayerId, type MapTool } from './types';
import type { Point } from '../model/schema';

export function createGeographyBrushTool(mode: 'land' | 'water'): MapTool {
  let points: Point[] = [];
  let hover: Point | null = null;
  const id = mode === 'land' ? 'landBrush' : 'waterBrush';
  return {
    id,
    onPointerDown(p, e, ctx) {
      if (e.button !== 0) return false;
      points = [p];
      hover = p;
      ctx.requestRedraw();
      return true;
    },
    onPointerMove(p, _e, ctx) {
      hover = p;
      const r = viewStore.getState().geoBrushRadius;
      if (points.length && Math.hypot(p.x - points[points.length - 1]!.x, p.y - points[points.length - 1]!.y) > r / 2.5) {
        points.push(p);
      }
      ctx.requestRedraw();
    },
    onPointerUp(p, _e, ctx) {
      if (!points.length) return;
      points.push(p);
      const v = viewStore.getState();
      const layerId = resolveTargetLayerId(ctx.map, v.activeLayerId);
      if (layerId) {
        ctx.execute('map.paintGeography', {
          mapId: ctx.map.id,
          mode,
          points,
          radius: v.geoBrushRadius,
          layerId,
        });
      }
      points = [];
      ctx.requestRedraw();
    },
    onKey(e, ctx) {
      if (e.key === 'Escape' && points.length) {
        points = [];
        ctx.requestRedraw();
        return true;
      }
      return false;
    },
    drawOverlay(gfx, ctx) {
      const r = viewStore.getState().geoBrushRadius;
      const color = mode === 'land' ? 0x4ade80 : 0x38bdf8;
      if (points.length) {
        const strokePts = hover ? [...points, hover] : points;
        if (strokePts.length === 1) {
          gfx.circle(strokePts[0]!.x, strokePts[0]!.y, r).fill({ color, alpha: 0.22 });
        } else {
          gfx.moveTo(strokePts[0]!.x, strokePts[0]!.y);
          for (let i = 1; i < strokePts.length; i++) {
            gfx.lineTo(strokePts[i]!.x, strokePts[i]!.y);
          }
          gfx.stroke({ color, width: r * 2, alpha: 0.22, cap: 'round', join: 'round' });
        }
      }
      if (hover) {
        gfx
          .circle(hover.x, hover.y, r)
          .fill({ color, alpha: points.length ? 0.08 : 0.22 })
          .stroke({ color: 0xe5e7eb, width: 1.5 / ctx.camera.zoom });
      }
    },
  };
}
