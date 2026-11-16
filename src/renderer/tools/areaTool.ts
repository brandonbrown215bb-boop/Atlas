import type { Graphics } from 'pixi.js';
import {
  simplifyRDP,
  smoothChaikin,
  snapPointToGrid,
} from '../geom/simplify';
import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import { handleDraftHistory } from './draftHistory';
import {
  resolveTargetLayerId,
  type MapTool,
  type ToolContext,
} from './types';

export function createAreaTool(): MapTool {
  let points: Point[] = [];
  const removedPoints: Point[] = [];
  let hoverPt: Point | null = null;
  let freehandActive = false;
  let lastClickTime = 0;
  let lastClickPt: Point | null = null;

  const reset = () => {
    points = [];
    removedPoints.length = 0;
    freehandActive = false;
    lastClickTime = 0;
    lastClickPt = null;
  };

  const commitArea = (ring: Point[], ctx: ToolContext) => {
    if (ring.length < 3) {
      return;
    }
    const vs = viewStore.getState();
    const layerId = resolveTargetLayerId(ctx.map, vs.activeLayerId);
    if (!layerId) {
      return;
    }
    const id = `area-${crypto.randomUUID().slice(0, 8)}`;
    ctx.execute('entity.add', {
      mapId: ctx.map.id,
      entity: {
        id,
        type: 'area',
        layerId,
        origin: 'manual',
        rev: 0,
        role: vs.areaRole,
        ...(vs.blueprintMode ? { usage: 'blueprint' as const } : {}),
        rings: [ring],
      },
    });
    ctx.setSelectedIds([id]);
  };

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().snapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  return {
    extentPreview:()=>{if(!points.length)return null;const p=hoverPt?[...points,hoverPt]:points;return {w:Math.max(...p.map(q=>q.x))-Math.min(...p.map(q=>q.x)),h:Math.max(...p.map(q=>q.y))-Math.min(...p.map(q=>q.y))};},
    draftState: () => ({ undo: points.length > 0 || removedPoints.length > 0, redo: removedPoints.length > 0 }),
    id: 'area',

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      const vs = viewStore.getState();
      const snapped = snapIfNeeded(pt, ctx);
      hoverPt = snapped;

      if (vs.drawMode === 'freehand') {
        points = [snapped];
        freehandActive = true;
        ctx.requestRedraw();
        return true;
      }

      const now = Date.now();
      const tol = 8 / Math.max(1e-8, ctx.camera.zoom);
      const isDoubleClick =
        (e.detail !== undefined && e.detail >= 2) ||
        (lastClickPt !== null &&
          now - lastClickTime < 350 &&
          Math.hypot(snapped.x - lastClickPt.x, snapped.y - lastClickPt.y) <= tol);

      lastClickTime = now;
      lastClickPt = snapped;

      if (isDoubleClick && points.length >= 3) {
        const ring = [...points];
        reset();
        commitArea(ring, ctx);
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
      const snapped = snapIfNeeded(pt, ctx);
      hoverPt = snapped;

      if (freehandActive) {
        const minDist = 2 / Math.max(1e-8, ctx.camera.zoom);
        const last = points[points.length - 1];
        if (!last || Math.hypot(snapped.x - last.x, snapped.y - last.y) >= minDist) {
          points.push(snapped);
        }
      }

      if (points.length > 0 || viewStore.getState().snapToGrid) {
        ctx.requestRedraw();
      }
    },

    onPointerUp(_pt, _e, ctx) {
      if (!freehandActive) {
        return;
      }
      const raw = [...points];
      reset();
      if (raw.length >= 3) {
        const eps = 3 / Math.max(1e-8, ctx.camera.zoom);
        const simplified = simplifyRDP(raw, eps, true);
        const smoothed = smoothChaikin(simplified, 2, true);
        if (smoothed.length >= 3) {
          commitArea(smoothed, ctx);
        }
      }
      ctx.requestRedraw();
    },

    onKey(e, ctx) {
      if (handleDraftHistory(e, points, removedPoints)) {
        lastClickTime = 0;
        lastClickPt = null;
        ctx.requestRedraw();
        return true;
      }
      if (e.key === 'Escape') {
        if (points.length > 0 || removedPoints.length > 0 || freehandActive) {
          reset();
          ctx.requestRedraw();
          return true;
        }
        return false;
      }
      if (e.key === 'Enter' && points.length >= 3 && !freehandActive) {
        e.preventDefault();
        const ring = [...points];
        reset();
        commitArea(ring, ctx);
        ctx.requestRedraw();
        return true;
      }
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      const zoom = Math.max(1e-8, ctx.camera.zoom);
      const strokeW = 1.5 / zoom;
      const dotR = 4 / zoom;

      if (points.length === 0) {
        if (hoverPt && viewStore.getState().snapToGrid) {
          gfx.circle(hoverPt.x, hoverPt.y, dotR).fill({ color: 0x38bdf8, alpha: 0.7 });
        }
        return;
      }

      const preview =
        !freehandActive && hoverPt ? [...points, hoverPt] : points;

      if (preview.length >= 3) {
        gfx.moveTo(preview[0]!.x, preview[0]!.y);
        for (let i = 1; i < preview.length; i++) {
          gfx.lineTo(preview[i]!.x, preview[i]!.y);
        }
        gfx.closePath();
        gfx.fill({ color: 0x38bdf8, alpha: 0.18 });
      }

      gfx.moveTo(preview[0]!.x, preview[0]!.y);
      for (let i = 1; i < preview.length; i++) {
        gfx.lineTo(preview[i]!.x, preview[i]!.y);
      }
      if (preview.length >= 3) {
        gfx.closePath();
      }
      gfx.stroke({ width: strokeW, color: 0x38bdf8, alpha: 0.95 });

      if (!freehandActive) {
        for (const p of points) {
          gfx.circle(p.x, p.y, dotR).fill({ color: 0xfbbf24 });
        }
      }
    },
  };
}
