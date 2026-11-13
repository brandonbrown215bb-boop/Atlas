import type { MapDoc, MapKind } from '../model/schema';
import { clampZoom, ZOOM_LIMITS, type CameraState } from '../render/camera';
import type { RectBounds } from './clipInherit';

export function childMapParentRect(child: MapDoc): RectBounds | null {
  if (!child.parent || child.kind === 'interior') {
    return null;
  }
  return {
    x: child.parent.x,
    y: child.parent.y,
    w: child.bounds.w,
    h: child.bounds.h,
  };
}

export function shouldDrawChildInline(
  parentCam: CameraState,
  childRect: RectBounds,
  viewW: number,
  viewH: number,
): boolean {
  const screenW = childRect.w * parentCam.zoom;
  const screenH = childRect.h * parentCam.zoom;
  if (Math.max(screenW, screenH) <= 64) {
    return false;
  }
  const left = childRect.x * parentCam.zoom + parentCam.x;
  const top = childRect.y * parentCam.zoom + parentCam.y;
  const right = left + screenW;
  const bottom = top + screenH;
  return right > 0 && left < viewW && bottom > 0 && top < viewH;
}

export function parentToChildCamera(
  parentCam: CameraState,
  childParent: { x: number; y: number },
  childKind: MapKind,
): CameraState {
  const zoom = clampZoom(parentCam.zoom, childKind);
  return {
    zoom,
    x: parentCam.x + childParent.x * parentCam.zoom,
    y: parentCam.y + childParent.y * parentCam.zoom,
  };
}

export function childToParentCamera(
  childCam: CameraState,
  childParent: { x: number; y: number },
  parentKind: MapKind,
): CameraState {
  const zoom = clampZoom(childCam.zoom, parentKind);
  return {
    zoom,
    x: childCam.x - childParent.x * childCam.zoom,
    y: childCam.y - childParent.y * childCam.zoom,
  };
}

export function findZoomInChild(
  parentCam: CameraState,
  parentKind: MapKind,
  children: readonly MapDoc[],
  viewW: number,
  viewH: number,
): MapDoc | null {
  const safeW = Math.max(1, viewW);
  const safeH = Math.max(1, viewH);
  const viewArea = safeW * safeH;
  const nearParentMax = parentCam.zoom >= ZOOM_LIMITS[parentKind].max * 0.85;

  let best: { child: MapDoc; coverage: number } | null = null;
  for (const child of children) {
    const rect = childMapParentRect(child);
    if (!rect) continue;
    const left = Math.max(0, rect.x * parentCam.zoom + parentCam.x);
    const top = Math.max(0, rect.y * parentCam.zoom + parentCam.y);
    const right = Math.min(safeW, (rect.x + rect.w) * parentCam.zoom + parentCam.x);
    const bottom = Math.min(safeH, (rect.y + rect.h) * parentCam.zoom + parentCam.y);
    if (right <= left || bottom <= top) continue;
    const coverage = ((right - left) * (bottom - top)) / viewArea;
    const qualifies = coverage >= 0.65 || (nearParentMax && coverage >= 0.45);
    if (qualifies && (!best || coverage > best.coverage)) {
      best = { child, coverage };
    }
  }
  return best?.child ?? null;
}

export function shouldZoomOutToParent(
  childCam: CameraState,
  child: MapDoc,
  viewW: number,
  viewH: number,
): boolean {
  if (!child.parent || child.kind === 'interior') {
    return false;
  }
  const safeW = Math.max(1, viewW);
  const safeH = Math.max(1, viewH);
  const screenW = child.bounds.w * childCam.zoom;
  const screenH = child.bounds.h * childCam.zoom;
  if (screenW < safeW * 0.55 && screenH < safeH * 0.55) {
    return true;
  }
  return childCam.zoom <= ZOOM_LIMITS[child.kind].min * 1.05;
}
