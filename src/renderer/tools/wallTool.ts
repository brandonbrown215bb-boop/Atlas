import type { Graphics } from 'pixi.js';
import { snapPointToGrid } from '../geom/simplify';
import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import { handleDraftHistory } from './draftHistory';
import {
  resolveTargetLayerId,
  type MapTool,
  type ToolContext,
} from './types';

export function createWallTool(): MapTool {
  let points: Point[] = [];
  const removedPoints: Point[] = [];
  let hoverPt: Point | null = null;
  let lastClickTime = 0;
  let lastClickPt: Point | null = null;

  const reset = () => {
    points = [];
    removedPoints.length = 0;
    lastClickTime = 0;
    lastClickPt = null;
  };

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().wallSnapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  const commitWall = (pts: Point[], ctx: ToolContext) => {
    if (pts.length < 2) {
      return;
    }
    const vs = viewStore.getState();
    const layerId = resolveTargetLayerId(ctx.map, vs.activeLayerId);
    if (!layerId) {
      return;
    }
    const id = `wall-${crypto.randomUUID().slice(0, 8)}`;
    ctx.execute('entity.add', {
      mapId: ctx.map.id,
      entity: {
        id,
        type: 'wall',
        layerId,
        origin: 'manual',
        rev: 0,
        points: pts,
        blocksMove: vs.wallBlocksMove,
        blocksSight: vs.wallBlocksSight,
        ...(vs.wallKind !== 'solid' ? { wallKind: vs.wallKind } : {}),
        ...(vs.wallBlocksLight !== vs.wallBlocksSight ? { blocksLight: vs.wallBlocksLight } : {}),
        ...(vs.wallBlocksSound !== vs.wallBlocksMove ? { blocksSound: vs.wallBlocksSound } : {}),
      },
    });
    ctx.setSelectedIds([id]);
  };

  return {
    draftState: () => ({ undo: points.length > 0 || removedPoints.length > 0, redo: removedPoints.length > 0 }),
    id: 'wall',

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      const snapped = snapIfNeeded(pt, ctx);
      hoverPt = snapped;

      const now = Date.now();
      const tol = 8 / Math.max(1e-8, ctx.camera.zoom);
      const isDoubleClick =
        (e.detail !== undefined && e.detail >= 2) ||
        (lastClickPt !== null &&
          now - lastClickTime < 350 &&
          Math.hypot(snapped.x - lastClickPt.x, snapped.y - lastClickPt.y) <= tol);

      lastClickTime = now;
      lastClickPt = snapped;

      if (isDoubleClick && points.length >= 2) {
        const finalPts = [...points];
        reset();
        commitWall(finalPts, ctx);
        ctx.requestRedraw();
        return true;
      }

      const prev = points[points.length - 1];
      if (!prev || prev.x !== snapped.x || prev.y !== snapped.y) {
        removedPoints.length = 0;
        points.push(snapped);
      }
      ctx.requestRedraw();
      return true;
    },

    onPointerMove(pt, _e, ctx) {
      hoverPt = snapIfNeeded(pt, ctx);
      if (points.length > 0 || viewStore.getState().wallSnapToGrid) {
        ctx.requestRedraw();
      }
    },

    onPointerUp() {
      // Wall tool commits on double-click or Enter
    },

    onKey(e, ctx) {
      if (handleDraftHistory(e, points, removedPoints)) {
        lastClickTime = 0;
        lastClickPt = null;
        ctx.requestRedraw();
        return true;
      }
      if (e.key === 'Escape' && (points.length > 0 || removedPoints.length > 0)) {
        reset();
        ctx.requestRedraw();
        return true;
      }
      if (e.key === 'Enter' && points.length >= 2) {
        e.preventDefault();
        const finalPts = [...points];
        reset();
        commitWall(finalPts, ctx);
        ctx.requestRedraw();
        return true;
      }
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      const zoom = Math.max(1e-8, ctx.camera.zoom);
      const strokeW = Math.max(0.2, 2 / zoom);
      const dotR = 4 / zoom;

      if (points.length === 0) {
        if (hoverPt && viewStore.getState().wallSnapToGrid) {
          gfx.circle(hoverPt.x, hoverPt.y, dotR).fill({ color: 0xe5e7eb, alpha: 0.75 });
        }
        return;
      }

      const preview = hoverPt ? [...points, hoverPt] : points;
      if (preview.length >= 2) {
        gfx.moveTo(preview[0]!.x, preview[0]!.y);
        for (let i = 1; i < preview.length; i++) {
          gfx.lineTo(preview[i]!.x, preview[i]!.y);
        }
        gfx.stroke({ width: strokeW, color: 0xe5e7eb, alpha: 0.9 });
      }
      for (const p of points) {
        gfx.circle(p.x, p.y, dotR).fill({ color: 0xfbbf24 });
      }
    },
  };
}
