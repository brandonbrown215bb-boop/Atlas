import type { MapDoc, Point } from '../model/schema';
import { distanceToSegment } from './hitTest';

export interface WallDoorPlacement {
  wallId: string;
  layerId: string;
  a: Point;
  b: Point;
  center: Point;
}

export function findDoorPlacementOnWall(
  map: MapDoc,
  pt: Point,
  tolerance: number,
  doorWidth: number,
): WallDoorPlacement | null {
  const unlockedVisibleLayers = new Set(
    map.layers.filter((l) => l.visible && !l.locked).map((l) => l.id),
  );

  let bestDist = tolerance;
  let bestWallId: string | null = null;
  let bestLayerId: string | null = null;
  let bestA: Point | null = null;
  let bestB: Point | null = null;

  for (const entity of Object.values(map.entities)) {
    if (entity.type !== 'wall' || !unlockedVisibleLayers.has(entity.layerId)) {
      continue;
    }
    for (let i = 0; i < entity.points.length - 1; i++) {
      const p0 = entity.points[i]!;
      const p1 = entity.points[i + 1]!;
      const d = distanceToSegment(pt, p0, p1);
      if (d <= bestDist) {
        bestDist = d;
        bestWallId = entity.id;
        bestLayerId = entity.layerId;
        bestA = p0;
        bestB = p1;
      }
    }
  }

  if (!bestWallId || !bestLayerId || !bestA || !bestB) {
    return null;
  }

  const dx = bestB.x - bestA.x;
  const dy = bestB.y - bestA.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < 1e-6) {
    return null;
  }

  const ux = dx / segLen;
  const uy = dy / segLen;
  const projT = Math.max(
    0,
    Math.min(segLen, (pt.x - bestA.x) * ux + (pt.y - bestA.y) * uy),
  );
  const halfW = Math.min(doorWidth / 2, segLen / 2);
  const clampedT = Math.max(halfW, Math.min(segLen - halfW, projT));

  const center = {
    x: bestA.x + clampedT * ux,
    y: bestA.y + clampedT * uy,
  };
  const a = {
    x: center.x - halfW * ux,
    y: center.y - halfW * uy,
  };
  const b = {
    x: center.x + halfW * ux,
    y: center.y + halfW * uy,
  };

  return {
    wallId: bestWallId,
    layerId: bestLayerId,
    a,
    b,
    center,
  };
}
