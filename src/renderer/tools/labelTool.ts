import type { Graphics } from 'pixi.js';
import { snapPointToGrid } from '../geom/simplify';
import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import {
  resolveTargetLayerId,
  type MapTool,
  type ToolContext,
} from './types';

export function createLabelTool(): MapTool {
  let hoverPt: Point | null = null;

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().snapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  return {
    id: 'label',

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      const vs = viewStore.getState();
      const layerId = resolveTargetLayerId(ctx.map, vs.activeLayerId);
      if (!layerId) {
        return false;
      }
      const pos = snapIfNeeded(pt, ctx);
      const id = `label-${crypto.randomUUID().slice(0, 8)}`;
      ctx.execute('entity.add', {
        mapId: ctx.map.id,
        entity: {
          id,
          type: 'label',
          layerId,
          origin: 'manual',
          rev: 0,
          text: vs.labelText || 'Label',
          x: pos.x,
          y: pos.y,
          size: Math.max(1, vs.labelSize),
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
      if (!hoverPt) {
        return;
      }
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      const r = 4 / zoom;
      gfx.circle(hoverPt.x, hoverPt.y, r).fill({ color: 0xfbbf24, alpha: 0.8 });
    },
  };
}
