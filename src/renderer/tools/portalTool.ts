import type { Graphics } from 'pixi.js';
import { snapPointToGrid } from '../geom/simplify';
import type { Point } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import {
  resolveTargetLayerId,
  type MapTool,
  type ToolContext,
} from './types';

export function createPortalTool(): MapTool {
  let hoverPt: Point | null = null;

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().snapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  return {
    id: 'portal',

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      const vs = viewStore.getState();
      const layerId = resolveTargetLayerId(ctx.map, vs.activeLayerId);
      if (!layerId) {
        return false;
      }
      const mapsList = worldStore.getState().world?.meta.maps ?? [];
      const fallbackTarget =
        mapsList.find((m) => m.id !== ctx.map.id)?.id ?? ctx.map.id;
      const targetMapId = vs.portalTargetMapId ?? fallbackTarget;

      const pos = snapIfNeeded(pt, ctx);
      const id = `portal-${crypto.randomUUID().slice(0, 8)}`;
      ctx.execute('entity.add', {
        mapId: ctx.map.id,
        entity: {
          id,
          type: 'portal',
          layerId,
          origin: 'manual',
          rev: 0,
          x: pos.x,
          y: pos.y,
          targetMapId,
        },
      });
      ctx.setSelectedIds([id]);
      ctx.requestRedraw();
      return true;
    },

    onPointerMove(pt, _e, ctx) {
      hoverPt = snapIfNeeded(pt, ctx);
      ctx.requestRedraw();
    },

    onPointerUp() {},

    onKey() {
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      if (!hoverPt) return;
      const r = Math.max(0.6, 8 / Math.max(0.01, ctx.camera.zoom));
      const strokeW = Math.max(0.05, 1.5 / Math.max(0.01, ctx.camera.zoom));
      gfx
        .moveTo(hoverPt.x, hoverPt.y - r)
        .lineTo(hoverPt.x + r, hoverPt.y)
        .lineTo(hoverPt.x, hoverPt.y + r)
        .lineTo(hoverPt.x - r, hoverPt.y)
        .closePath()
        .fill({ color: 0xa855f7, alpha: 0.35 })
        .stroke({ width: strokeW, color: 0xa855f7, alpha: 0.9 });
    },
  };
}
