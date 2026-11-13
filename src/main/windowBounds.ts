export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayArea {
  workArea: Rect;
}

const MIN_VISIBLE_PX = 50;

function intersectionArea(a: Rect, b: Rect): { width: number; height: number } {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Ensures a window's bounds are visible on at least one current display.
 * If off every monitor, moves and clamps the window onto `primaryWorkArea`.
 */
export function clampBoundsToDisplays(
  bounds: Rect,
  displays: readonly DisplayArea[],
  primaryWorkArea: Rect,
): Rect {
  const isVisibleOnAny = displays.some((d) => {
    const inter = intersectionArea(bounds, d.workArea);
    return inter.width >= MIN_VISIBLE_PX && inter.height >= MIN_VISIBLE_PX;
  });

  if (isVisibleOnAny) {
    return bounds;
  }

  const width = Math.min(Math.max(200, bounds.width), primaryWorkArea.width);
  const height = Math.min(Math.max(150, bounds.height), primaryWorkArea.height);
  const x = primaryWorkArea.x + Math.floor((primaryWorkArea.width - width) / 2);
  const y = primaryWorkArea.y + Math.floor((primaryWorkArea.height - height) / 2);

  return { x, y, width, height };
}
