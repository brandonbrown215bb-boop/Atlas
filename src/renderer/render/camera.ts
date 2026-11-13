import type { MapKind, Point } from '../model/schema';

export interface CameraState {
  /** Screen X offset of map origin (0, 0) in CSS pixels. */
  x: number;
  /** Screen Y offset of map origin (0, 0) in CSS pixels. */
  y: number;
  /** Pixels per metre. */
  zoom: number;
}

export const ZOOM_LIMITS: Record<MapKind, { min: number; max: number }> = {
  world: { min: 0.0005, max: 1 / 50 },
  region: { min: 0.002, max: 1 / 5 },
  settlement: { min: 0.02, max: 1 / 0.25 },
  site: { min: 0.2, max: 1 / 0.01 },
  interior: { min: 0.2, max: 1 / 0.01 },
};

export function clampZoom(zoom: number, kind: MapKind): number {
  const { min, max } = ZOOM_LIMITS[kind];
  return Math.min(max, Math.max(min, zoom));
}

export function screenToMap(cam: CameraState, sx: number, sy: number): Point {
  return {
    x: (sx - cam.x) / cam.zoom,
    y: (sy - cam.y) / cam.zoom,
  };
}

export function mapToScreen(cam: CameraState, mx: number, my: number): Point {
  return {
    x: mx * cam.zoom + cam.x,
    y: my * cam.zoom + cam.y,
  };
}

export function zoomAtCursor(
  cam: CameraState,
  sx: number,
  sy: number,
  factor: number,
  kind: MapKind,
): CameraState {
  const nextZoom = clampZoom(cam.zoom * factor, kind);
  const worldPt = screenToMap(cam, sx, sy);
  return {
    zoom: nextZoom,
    x: sx - worldPt.x * nextZoom,
    y: sy - worldPt.y * nextZoom,
  };
}

export function fitBoundsCamera(
  bounds: { x: number; y: number; w: number; h: number },
  viewW: number,
  viewH: number,
  kind: MapKind,
): CameraState {
  const safeW = Math.max(1, viewW);
  const safeH = Math.max(1, viewH);
  const rawZoom = Math.min(safeW / bounds.w, safeH / bounds.h) * 0.9;
  const zoom = clampZoom(rawZoom, kind);
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return {
    zoom,
    x: safeW / 2 - cx * zoom,
    y: safeH / 2 - cy * zoom,
  };
}
