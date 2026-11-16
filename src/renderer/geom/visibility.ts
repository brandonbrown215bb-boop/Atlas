import type { MultiPolygon } from 'polygon-clipping';
import clipping from './polygonClipping';
import { fromPolygons, toPolygons } from './fog';
import { resolveWallChannels, type Entity, type MapDoc, type Point } from '../model/schema';

export interface Segment {
  a: Point;
  b: Point;
}

export function collectLightBlockers(entities: Entity[]): Segment[] {
  const segs: Segment[] = [];
  for (const e of entities) {
    if (e.type === 'wall') {
      const ch = resolveWallChannels(e);
      if (!ch.blocksLight && !ch.blocksSight) continue;
      for (let i = 1; i < e.points.length; i++) {
        segs.push({ a: e.points[i - 1]!, b: e.points[i]! });
      }
    } else if (e.type === 'door' && !e.open && e.kind !== 'secret') {
      segs.push({ a: e.a, b: e.b });
    }
  }
  return segs;
}

function raySegmentIntersect(origin: Point, dx: number, dy: number, maxDist: number, seg: Segment): number {
  const sx = seg.b.x - seg.a.x;
  const sy = seg.b.y - seg.a.y;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return maxDist;
  const qpx = seg.a.x - origin.x;
  const qpy = seg.a.y - origin.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dy - qpy * dx) / denom;
  if (t >= 0 && t < maxDist && u >= -1e-4 && u <= 1 + 1e-4) {
    return t;
  }
  return maxDist;
}

export function computeLightVisibilityPolygon(
  origin: Point,
  radius: number,
  blockers: Segment[],
): Point[] {
  const near = blockers.filter((s) => {
    const minX = Math.min(s.a.x, s.b.x);
    const maxX = Math.max(s.a.x, s.b.x);
    const minY = Math.min(s.a.y, s.b.y);
    const maxY = Math.max(s.a.y, s.b.y);
    return (
      maxX >= origin.x - radius &&
      minX <= origin.x + radius &&
      maxY >= origin.y - radius &&
      minY <= origin.y + radius
    );
  });

  const angles: number[] = [];
  const step = (Math.PI * 2) / 48;
  for (let i = 0; i < 48; i++) angles.push(-Math.PI + i * step);
  for (const s of near) {
    for (const pt of [s.a, s.b]) {
      const a = Math.atan2(pt.y - origin.y, pt.x - origin.x);
      angles.push(a - 0.0008, a, a + 0.0008);
    }
  }
  angles.sort((a, b) => a - b);

  const ring: Point[] = [];
  for (const ang of angles) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let dist = radius;
    for (const s of near) {
      const hit = raySegmentIntersect(origin, dx, dy, dist, s);
      if (hit < dist) dist = hit;
    }
    ring.push({ x: origin.x + dx * dist, y: origin.y + dy * dist });
  }
  return ring;
}

/** Computes wall-blocked raycast visibility polygons across sampled observer positions. */
export function castLosPolygons(points: readonly Point[], radius: number, map: Pick<MapDoc, 'entities' | 'layers'>): Point[][][] {
  if (!points.length || radius <= 0) return [];
  const activeLayers = new Set(map.layers.filter((l) => l.visible).map((l) => l.id));
  const blockers = collectLightBlockers(Object.values(map.entities).filter((e) => activeLayers.has(e.layerId)));
  const tail = points[points.length - 1]!;
  const ring = computeLightVisibilityPolygon(tail, radius, blockers);
  if (ring.length < 3) return [];
  const poly: MultiPolygon = toPolygons([[ring]]);
  return fromPolygons(clipping.union(poly));
}
