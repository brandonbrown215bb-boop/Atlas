import type { Graphics } from 'pixi.js';
import { snapPointToGrid } from '../geom/simplify';
import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import type { MapTool, ToolContext } from './types';

export function createDevelopAreaTool(): MapTool {
  let dragStart: Point | null = null;
  let dragCurrent: Point | null = null;

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().snapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  return {
    id: 'developArea',

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) return false;
      const snapped = snapIfNeeded(pt, ctx);
      dragStart = snapped;
      dragCurrent = snapped;
      ctx.requestRedraw();
      return true;
    },

    onPointerMove(pt, _e, ctx) {
      if (!dragStart) return;
      dragCurrent = snapIfNeeded(pt, ctx);
      ctx.requestRedraw();
    },

    onPointerUp(pt, _e, ctx) {
      if (!dragStart) return;
      const end = snapIfNeeded(pt, ctx);
      const x = Math.min(dragStart.x, end.x);
      const y = Math.min(dragStart.y, end.y);
      const w = Math.abs(end.x - dragStart.x);
      const h = Math.abs(end.y - dragStart.y);
      dragStart = null;
      dragCurrent = null;
      if (w > 0.5 && h > 0.5) {
        viewStore.getState().setPendingDevelopRect({
          mapId: ctx.map.id,
          rect: { x, y, w, h },
        });
      }
      ctx.requestRedraw();
    },

    onKey(e, ctx) {
      if (e.key === 'Escape') {
        dragStart = null;
        dragCurrent = null;
        viewStore.getState().setPendingDevelopRect(null);
        ctx.requestRedraw();
        return true;
      }
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      const pending = viewStore.getState().pendingDevelopRect;
      const rect =
        dragStart && dragCurrent
          ? {
              x: Math.min(dragStart.x, dragCurrent.x),
              y: Math.min(dragStart.y, dragCurrent.y),
              w: Math.abs(dragCurrent.x - dragStart.x),
              h: Math.abs(dragCurrent.y - dragStart.y),
            }
          : pending?.mapId === ctx.map.id
            ? pending.rect
            : null;
      if (!rect || rect.w <= 0 || rect.h <= 0) return;

      const strokeW = Math.max(0.05, 2 / Math.max(0.01, ctx.camera.zoom));
      gfx
        .rect(rect.x, rect.y, rect.w, rect.h)
        .fill({ color: 0x10b981, alpha: 0.14 })
        .stroke({ width: strokeW, color: 0x10b981, alpha: 0.95 });
    },
  };
}
