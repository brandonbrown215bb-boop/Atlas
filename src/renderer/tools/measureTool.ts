import type { Graphics } from 'pixi.js';
import { viewStore, type MeasurementRoute } from '../model/viewStore';
import type { MapTool, ToolContext } from './types';

export function getMeasurement(ctx: Pick<ToolContext, 'panelId' | 'worldId' | 'map'>): MeasurementRoute | null {
  const route = viewStore.getState().measurements[ctx.panelId];
  return route?.worldId === ctx.worldId && route.mapId === ctx.map.id ? route : null;
}

export function createMeasureTool(): MapTool {
  return {
    id: 'measure',
    onPointerDown(pt, event, ctx) {
      if (event.button !== 0) return false;
      const previous = getMeasurement(ctx);
      const points = previous && !previous.finished ? [...previous.points] : [];
      const last = points.at(-1);
      if (!last || last.x !== pt.x || last.y !== pt.y) points.push(pt);
      viewStore.getState().setMeasurement(ctx.panelId, {
        worldId: ctx.worldId, mapId: ctx.map.id, points, hover: null,
        finished: points.length >= 2 && (event.detail ?? 0) >= 2,
      });
      ctx.requestRedraw();
      return true;
    },
    onPointerMove(pt, _event, ctx) {
      const route = getMeasurement(ctx);
      if (!route || route.finished) return;
      viewStore.getState().setMeasurement(ctx.panelId, { ...route, hover: pt });
      ctx.requestRedraw();
    },
    onPointerUp() {},
    onKey(event, ctx) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const route = getMeasurement(ctx);
      if (!route) return false;
      if (event.key === 'Escape') {
        viewStore.getState().setMeasurement(ctx.panelId, null);
      } else if (event.key === 'Backspace') {
        const points = route.points.slice(0, -1);
        viewStore.getState().setMeasurement(ctx.panelId, points.length ? { ...route, points, hover: null, finished: false } : null);
      } else if (event.key === 'Enter' && route.points.length >= 2) {
        viewStore.getState().setMeasurement(ctx.panelId, { ...route, hover: null, finished: true });
      } else return false;
      event.preventDefault();
      ctx.requestRedraw();
      return true;
    },
    drawOverlay(gfx: Graphics, ctx) {
      const route = getMeasurement(ctx);
      const origin = route?.points[0];
      if (!route || !origin) return;
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      // Keep GPU coordinates near zero even when measuring across a world map.
      gfx.position.set(origin.x, origin.y);
      gfx.moveTo(0, 0);
      for (const point of route.points.slice(1)) gfx.lineTo(point.x - origin.x, point.y - origin.y);
      if (!route.finished && route.hover) gfx.lineTo(route.hover.x - origin.x, route.hover.y - origin.y);
      gfx.stroke({ color: 0xfbbf24, width: 2 / zoom, cap: 'round', join: 'round' });
      for (const point of route.points) gfx.circle(point.x - origin.x, point.y - origin.y, 4 / zoom).fill({ color: 0xfbbf24 });
    },
  };
}
