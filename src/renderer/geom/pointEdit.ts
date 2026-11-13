import polygonClipping, {
  type Polygon as PcPolygon,
  type Ring as PcRing,
} from 'polygon-clipping';
import type { Entity, Point } from '../model/schema';
import { distanceToSegment } from './hitTest';

export interface VertexHit {
  ringIndex: number;
  pointIndex: number;
  point: Point;
}

export interface SegmentHit {
  ringIndex: number;
  insertIndex: number;
  projected: Point;
}

export function isPointEditableEntity(entity: Entity): boolean {
  return (
    entity.type === 'area' ||
    entity.type === 'path' ||
    entity.type === 'wall' ||
    entity.type === 'door'
  );
}

export function getEntityPointLists(entity: Entity): Point[][] {
  switch (entity.type) {
    case 'area':
      return entity.rings.map((r) => [...r]);
    case 'path':
    case 'wall':
      return [[...entity.points]];
    case 'door':
      return [[entity.a, entity.b]];
    default:
      return [];
  }
}

export function findNearestVertex(
  entity: Entity,
  pt: Point,
  tolerance: number,
): VertexHit | null {
  const lists = getEntityPointLists(entity);
  let best: VertexHit | null = null;
  let bestDist = tolerance;

  for (let r = 0; r < lists.length; r++) {
    const list = lists[r]!;
    for (let i = 0; i < list.length; i++) {
      const v = list[i]!;
      const d = Math.hypot(pt.x - v.x, pt.y - v.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { ringIndex: r, pointIndex: i, point: v };
      }
    }
  }
  return best;
}

function projectOntoSegment(pt: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function findNearestSegment(
  entity: Entity,
  pt: Point,
  tolerance: number,
): SegmentHit | null {
  if (entity.type === 'door') {
    return null;
  }
  const lists = getEntityPointLists(entity);
  const isClosed =
    entity.type === 'area' || (entity.type === 'path' && entity.closed);

  let best: SegmentHit | null = null;
  let bestDist = tolerance;

  for (let r = 0; r < lists.length; r++) {
    const list = lists[r]!;
    if (list.length < 2) continue;
    const segCount = isClosed ? list.length : list.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = list[i]!;
      const b = list[(i + 1) % list.length]!;
      const d = distanceToSegment(pt, a, b);
      if (d <= bestDist) {
        bestDist = d;
        best = {
          ringIndex: r,
          insertIndex: i + 1,
          projected: projectOntoSegment(pt, a, b),
        };
      }
    }
  }
  return best;
}

export function moveVertexPatch(
  entity: Entity,
  ringIndex: number,
  pointIndex: number,
  newPt: Point,
): Record<string, unknown> {
  if (entity.type === 'area') {
    const rings = entity.rings.map((ring, rIdx) =>
      rIdx === ringIndex
        ? ring.map((p, pIdx) => (pIdx === pointIndex ? newPt : p))
        : ring,
    );
    return { rings };
  }
  if (entity.type === 'path' || entity.type === 'wall') {
    const points = entity.points.map((p, pIdx) =>
      pIdx === pointIndex ? newPt : p,
    );
    return { points };
  }
  if (entity.type === 'door') {
    return pointIndex === 0 ? { a: newPt } : { b: newPt };
  }
  return {};
}

export function insertVertexPatch(
  entity: Entity,
  ringIndex: number,
  insertIndex: number,
  newPt: Point,
): Record<string, unknown> | null {
  if (entity.type === 'area') {
    const rings = entity.rings.map((ring, rIdx) => {
      if (rIdx !== ringIndex) return ring;
      const next = [...ring];
      next.splice(insertIndex, 0, newPt);
      return next;
    });
    return { rings };
  }
  if (entity.type === 'path' || entity.type === 'wall') {
    const next = [...entity.points];
    next.splice(insertIndex, 0, newPt);
    return { points: next };
  }
  return null;
}

export function deleteVertexPatch(
  entity: Entity,
  ringIndex: number,
  pointIndex: number,
): Record<string, unknown> | null {
  if (entity.type === 'area') {
    const targetRing = entity.rings[ringIndex];
    if (!targetRing) return null;
    if (targetRing.length <= 3) {
      if (ringIndex === 0) {
        return null; // Outer ring needs at least 3 points
      }
      // Remove degenerate hole ring
      const rings = entity.rings.filter((_, idx) => idx !== ringIndex);
      return { rings };
    }
    const rings = entity.rings.map((ring, rIdx) =>
      rIdx === ringIndex ? ring.filter((_, idx) => idx !== pointIndex) : ring,
    );
    return { rings };
  }
  if (entity.type === 'path' || entity.type === 'wall') {
    if (entity.points.length <= 2) {
      return null;
    }
    return {
      points: entity.points.filter((_, idx) => idx !== pointIndex),
    };
  }
  return null;
}

function toPcRing(ring: readonly Point[]): PcRing {
  if (ring.length === 0) return [];
  const pairs: PcRing = ring.map((p) => [p.x, p.y]);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first.x !== last.x || first.y !== last.y) {
    pairs.push([first.x, first.y]);
  }
  return pairs;
}

function fromPcRing(ring: PcRing): Point[] {
  const pts = ring.map(([x, y]) => ({ x, y }));
  if (pts.length >= 2) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
      pts.pop();
    }
  }
  return pts;
}

/**
 * Performs boolean union or difference on an area's rings using polygon-clipping.
 * Returns an array of resulting polygons (each polygon is Point[][] with rings[0] outer and rings[1..] holes).
 */
export function booleanAreaRings(
  subjectRings: readonly (readonly Point[])[],
  clipRing: readonly Point[],
  op: 'union' | 'difference',
): Point[][][] {
  const subjectPoly: PcPolygon = subjectRings.map(toPcRing);
  const clipPoly: PcPolygon = [toPcRing(clipRing)];
  const result =
    op === 'union'
      ? polygonClipping.union(subjectPoly, clipPoly)
      : polygonClipping.difference(subjectPoly, clipPoly);

  const output: Point[][][] = [];
  for (const poly of result) {
    const rings = poly
      .map(fromPcRing)
      .filter((r) => r.length >= 3);
    if (rings.length > 0) {
      output.push(rings);
    }
  }
  return output;
}
