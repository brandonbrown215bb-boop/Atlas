import type { Graphics } from 'pixi.js';
import { snapPointToGrid } from '../geom/simplify';
import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import {
  resolveTargetLayerId,
  type MapTool,
  type ToolContext,
} from './types';

export function createLightTool(): MapTool {
  let hoverPt: Point | null = null;

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().snapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  return {
    id: 'light',

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
      const id = `light-${crypto.randomUUID().slice(0, 8)}`;
      ctx.execute('entity.add', {
        mapId: ctx.map.id,
        entity: {
          id,
          type: 'light',
          layerId,
          origin: 'manual',
          rev: 0,
          x: pos.x,
          y: pos.y,
          radius: Math.max(0.1, vs.lightRadius),
          color: vs.lightColor,
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
      const strokeW = 1.5 / zoom;
      const vs = viewStore.getState();
      const colorNum = /^#[0-9a-fA-F]{6}$/.test(vs.lightColor)
        ? Number.parseInt(vs.lightColor.slice(1), 16)
        : 0xfde047;
      gfx
        .circle(hoverPt.x, hoverPt.y, Math.max(0.1, vs.lightRadius))
        .fill({ color: colorNum, alpha: 0.14 })
        .stroke({ width: strokeW, color: colorNum, alpha: 0.8 });
    },
  };
}
