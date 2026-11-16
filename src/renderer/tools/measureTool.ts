import type { Graphics } from 'pixi.js';
import { viewStore, type MeasurementRoute } from '../model/viewStore';
import type { MapTool, ToolContext } from './types';
import { dailyTravelJitterBand, horizonDistanceMetres, travelMarkers } from '../geom/measure';

function strokeDashedCircle(gfx: Graphics, cx: number, cy: number, r: number, color: number, width: number, alpha: number, segments = 48): void {
  if (!(r > 0)) return;
  for (let i = 0; i < segments; i += 2) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    gfx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r)
      .lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
  }
  gfx.stroke({ color, width, alpha, cap: 'round' });
}

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
      const state = viewStore.getState();
      const route = getMeasurement(ctx);
      const origin = route?.points[0];
      if (!route || !origin) {
        if (state.showHorizonRing) {
          const cx = ctx.map.bounds.x + ctx.map.bounds.w / 2;
          const cy = ctx.map.bounds.y + ctx.map.bounds.h / 2;
          const zoom = Math.max(1e-8, ctx.camera.zoom);
          gfx.position.set(cx, cy);
          strokeDashedCircle(gfx, 0, 0, horizonDistanceMetres(5.5), 0x38bdf8, 1.5 / zoom, 0.72, 48);
          const speedMph = Number(state.measureSpeedMph);
          if (Number.isFinite(speedMph) && speedMph > 0) {
            const band = dailyTravelJitterBand(speedMph, state.measureSchedule?.hoursPerDay ?? 8);
            strokeDashedCircle(gfx, 0, 0, band.minMetres, 0xfbbf24, 1.25 / zoom, 0.48, 56);
            strokeDashedCircle(gfx, 0, 0, band.maxMetres, 0xfbbf24, 1.25 / zoom, 0.48, 56);
          }
        }
        return;
      }
      const zoom = Math.max(1e-8, ctx.camera.zoom);
      // Keep GPU coordinates near zero even when measuring across a world map.
      gfx.position.set(origin.x, origin.y);
      gfx.moveTo(0, 0);
      for (const point of route.points.slice(1)) gfx.lineTo(point.x - origin.x, point.y - origin.y);
      if (!route.finished && route.hover) gfx.lineTo(route.hover.x - origin.x, route.hover.y - origin.y);
      gfx.stroke({ color: 0xfbbf24, width: 2 / zoom, cap: 'round', join: 'round' });
      for (const point of route.points) gfx.circle(point.x - origin.x, point.y - origin.y, 4 / zoom).fill({ color: 0xfbbf24 });
      if (state.showHorizonRing) {
        const lastPt = (!route.finished && route.hover) ? route.hover : route.points[route.points.length - 1]!;
        const hx = lastPt.x - origin.x, hy = lastPt.y - origin.y;
        const horizonR = horizonDistanceMetres(5.5);
        strokeDashedCircle(gfx, hx, hy, horizonR, 0x38bdf8, 1.5 / zoom, 0.72, 48);
        const speedMph = Number(state.measureSpeedMph);
        if (Number.isFinite(speedMph) && speedMph > 0) {
          const band = dailyTravelJitterBand(speedMph, state.measureSchedule?.hoursPerDay ?? 8);
          strokeDashedCircle(gfx, 0, 0, band.minMetres, 0xfbbf24, 1.25 / zoom, 0.48, 56);
          strokeDashedCircle(gfx, 0, 0, band.maxMetres, 0xfbbf24, 1.25 / zoom, 0.48, 56);
        }
      }
      if (state.measureMarkers || state.showHorizonRing) {
        try {
          const points = [...route.points, ...(!route.finished && route.hover ? [route.hover] : [])];
          for (const p of travelMarkers(points, Number(state.measureSpeedMph), state.measureDeparture, state.measureSchedule ?? undefined)) {
            const x = p.x - origin.x, y = p.y - origin.y, r = (p.kind === 'camp' ? 7 : 4.2) / zoom;
            if (p.kind === 'camp') gfx.moveTo(x, y-r).lineTo(x+r, y+r).lineTo(x-r, y+r).closePath().fill({color:0xfb923c}).stroke({color:0x1c140c,width:1.5/zoom});
            else gfx.circle(x, y, r * 0.85).fill({color:0xfef3c7}).stroke({color:0x3b2a1a,width:1.4/zoom});
          }
        } catch { /* Incomplete travel controls have no markers. The bar shows the error. */ }
      }
    },
  };
}
