import type { Graphics } from 'pixi.js';
import {
  simplifyRDP,
  smoothChaikin,
  snapPointToGrid,
} from '../geom/simplify';
import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import {
  resolveTargetLayerId,
  type MapTool,
  type ToolContext,
} from './types';

export function createPathTool(): MapTool {
  let points: Point[] = [];
  let hoverPt: Point | null = null;
  let freehandActive = false;
  let lastClickTime = 0;
  let lastClickPt: Point | null = null;

  const reset = () => {
    points = [];
    freehandActive = false;
    lastClickTime = 0;
    lastClickPt = null;
  };

  const commitPath = (pts: Point[], ctx: ToolContext) => {
    if (pts.length < 2) {
      return;
    }
    const vs = viewStore.getState();
    const layerId = resolveTargetLayerId(ctx.map, vs.activeLayerId);
    if (!layerId) {
      return;
    }
    const id = `path-${crypto.randomUUID().slice(0, 8)}`;
    ctx.execute('entity.add', {
      mapId: ctx.map.id,
      entity: {
        id,
        type: 'path',
        layerId,
        origin: 'manual',
        rev: 0,
        role: vs.pathRole,
        points: pts,
        width: Math.max(0.05, vs.pathWidth),
        closed: vs.pathClosed,
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
    id: 'path',

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
      const tol = 8 / Math.max(0.0005, ctx.camera.zoom);
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
        commitPath(finalPts, ctx);
        ctx.requestRedraw();
        return true;
      }

      const prev = points[points.length - 1];
      if (!prev || prev.x !== snapped.x || prev.y !== snapped.y) {
        points.push(snapped);
      }
      ctx.requestRedraw();
      return true;
    },

    onPointerMove(pt, _e, ctx) {
      const snapped = snapIfNeeded(pt, ctx);
      hoverPt = snapped;

      if (freehandActive) {
        const minDist = 2 / Math.max(0.0005, ctx.camera.zoom);
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
      const closed = viewStore.getState().pathClosed;
      reset();
      if (raw.length >= 2) {
        const eps = 3 / Math.max(0.0005, ctx.camera.zoom);
        const simplified = simplifyRDP(raw, eps, closed);
        const smoothed = smoothChaikin(simplified, 2, closed);
        if (smoothed.length >= 2) {
          commitPath(smoothed, ctx);
        }
      }
      ctx.requestRedraw();
    },

    onKey(e, ctx) {
      if (e.key === 'Escape') {
        if (points.length > 0 || freehandActive) {
          reset();
          ctx.requestRedraw();
          return true;
        }
        return false;
      }
      if (e.key === 'Enter' && points.length >= 2 && !freehandActive) {
        e.preventDefault();
        const finalPts = [...points];
        reset();
        commitPath(finalPts, ctx);
        ctx.requestRedraw();
        return true;
      }
      if (e.key === 'Backspace' && points.length > 0 && !freehandActive) {
        e.preventDefault();
        points.pop();
        ctx.requestRedraw();
        return true;
      }
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      const strokeW = Math.max(1.5 / zoom, viewStore.getState().pathWidth);
      const dotR = 4 / zoom;

      if (points.length === 0) {
        if (hoverPt && viewStore.getState().snapToGrid) {
          gfx.circle(hoverPt.x, hoverPt.y, dotR).fill({ color: 0xfbbf24, alpha: 0.7 });
        }
        return;
      }

      const preview =
        !freehandActive && hoverPt ? [...points, hoverPt] : points;

      if (preview.length >= 2) {
        gfx.moveTo(preview[0]!.x, preview[0]!.y);
        for (let i = 1; i < preview.length; i++) {
          gfx.lineTo(preview[i]!.x, preview[i]!.y);
        }
        if (viewStore.getState().pathClosed && preview.length >= 3) {
          gfx.closePath();
        }
        gfx.stroke({
          width: strokeW,
          color: 0xfbbf24,
          alpha: 0.7,
          cap: 'round',
          join: 'round',
        });
      }

      if (!freehandActive) {
        for (const p of points) {
          gfx.circle(p.x, p.y, dotR).fill({ color: 0x38bdf8 });
        }
      }
    },
  };
}
