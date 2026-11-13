import type { Entity, MapDoc, Point } from '../model/schema';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxesIntersect(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function mergeBBoxes(boxes: readonly BBox[]): BBox | null {
  if (boxes.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxFromPoints(points: readonly Point[], pad = 0): BBox | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

export function getEntityBounds(entity: Entity): BBox | null {
  switch (entity.type) {
    case 'image': {
      const cos = Math.cos(entity.rotation);
      const sin = Math.sin(entity.rotation);
      const corners: Point[] = [
        { x: entity.x, y: entity.y },
        { x: entity.x + entity.w * cos, y: entity.y + entity.w * sin },
        {
          x: entity.x + entity.w * cos - entity.h * sin,
          y: entity.y + entity.w * sin + entity.h * cos,
        },
        { x: entity.x - entity.h * sin, y: entity.y + entity.h * cos },
      ];
      return bboxFromPoints(corners);
    }
    case 'area': {
      const outer = entity.rings[0];
      return outer ? bboxFromPoints(outer) : null;
    }
    case 'path':
      return bboxFromPoints(entity.points, entity.width / 2);
    case 'wall':
      return bboxFromPoints(entity.points, 0.25);
    case 'door':
      return bboxFromPoints([entity.a, entity.b], 0.25);
    case 'prop': {
      const r = 0.75 * entity.scale;
      return {
        minX: entity.x - r,
        minY: entity.y - r,
        maxX: entity.x + r,
        maxY: entity.y + r,
      };
    }
    case 'light': {
      const r = Math.max(0.5, entity.radius);
      return {
        minX: entity.x - r,
        minY: entity.y - r,
        maxX: entity.x + r,
        maxY: entity.y + r,
      };
    }
    case 'label': {
      const halfW = Math.max(1, entity.text.length * 0.4);
      const halfH = 0.75;
      return {
        minX: entity.x - halfW * 0.1,
        minY: entity.y - halfH * 0.2,
        maxX: entity.x + halfW,
        maxY: entity.y + halfH,
      };
    }
    case 'portal': {
      const r = 0.75;
      return {
        minX: entity.x - r,
        minY: entity.y - r,
        maxX: entity.x + r,
        maxY: entity.y + r,
      };
    }
    case 'place':
      return null;
  }
}

export function getSelectionBounds(entities: readonly Entity[]): BBox | null {
  const boxes: BBox[] = [];
  for (const e of entities) {
    const b = getEntityBounds(e);
    if (b) {
      boxes.push(b);
    }
  }
  return mergeBBoxes(boxes);
}

export function distanceToSegment(pt: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(pt.x - a.x, pt.y - a.y);
  }
  let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

function pointInRing(pt: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    const intersect =
      pi.y > pt.y !== pj.y > pt.y &&
      pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(
  pt: Point,
  rings: readonly (readonly Point[])[],
): boolean {
  const outer = rings[0];
  if (!outer || outer.length < 3 || !pointInRing(pt, outer)) {
    return false;
  }
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]!;
    if (hole.length >= 3 && pointInRing(pt, hole)) {
      return false;
    }
  }
  return true;
}

function hitTestPolyline(
  pt: Point,
  points: readonly Point[],
  closed: boolean,
  threshold: number,
): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) {
    return Math.hypot(pt.x - points[0]!.x, pt.y - points[0]!.y) <= threshold;
  }
  for (let i = 0; i < points.length - 1; i++) {
    if (distanceToSegment(pt, points[i]!, points[i + 1]!) <= threshold) {
      return true;
    }
  }
  if (closed && points.length >= 3) {
    if (
      distanceToSegment(pt, points[points.length - 1]!, points[0]!) <= threshold
    ) {
      return true;
    }
  }
  return false;
}

export function hitTestEntity(
  entity: Entity,
  pt: Point,
  tolerance: number,
): boolean {
  switch (entity.type) {
    case 'image': {
      const dx = pt.x - entity.x;
      const dy = pt.y - entity.y;
      const cos = Math.cos(-entity.rotation);
      const sin = Math.sin(-entity.rotation);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return (
        lx >= -tolerance &&
        lx <= entity.w + tolerance &&
        ly >= -tolerance &&
        ly <= entity.h + tolerance
      );
    }
    case 'area': {
      if (pointInPolygon(pt, entity.rings)) {
        return true;
      }
      return entity.rings.some((ring) =>
        hitTestPolyline(pt, ring, true, tolerance),
      );
    }
    case 'path':
      return hitTestPolyline(
        pt,
        entity.points,
        entity.closed,
        Math.max(entity.width / 2, tolerance),
      );
    case 'wall':
      return hitTestPolyline(pt, entity.points, false, tolerance);
    case 'door':
      return distanceToSegment(pt, entity.a, entity.b) <= tolerance;
    case 'prop':
      return (
        Math.hypot(pt.x - entity.x, pt.y - entity.y) <=
        Math.max(0.75 * entity.scale, tolerance)
      );
    case 'light':
    case 'portal':
      return Math.hypot(pt.x - entity.x, pt.y - entity.y) <= Math.max(0.75, tolerance);
    case 'label': {
      const b = getEntityBounds(entity)!;
      return (
        pt.x >= b.minX - tolerance &&
        pt.x <= b.maxX + tolerance &&
        pt.y >= b.minY - tolerance &&
        pt.y <= b.maxY + tolerance
      );
    }
    case 'place':
      return false;
  }
}

export function pickTopEntity(
  map: MapDoc,
  pt: Point,
  tolerance: number,
): Entity | null {
  const allEntities = Object.values(map.entities);
  for (let i = map.layers.length - 1; i >= 0; i--) {
    const layer = map.layers[i]!;
    if (!layer.visible || layer.locked) {
      continue;
    }
    for (let j = allEntities.length - 1; j >= 0; j--) {
      const entity = allEntities[j]!;
      if (entity.layerId !== layer.id) {
        continue;
      }
      if (hitTestEntity(entity, pt, tolerance)) {
        return entity;
      }
    }
  }
  return null;
}

export function boxSelectEntities(map: MapDoc, box: BBox): string[] {
  const unlockedVisibleLayers = new Set(
    map.layers.filter((l) => l.visible && !l.locked).map((l) => l.id),
  );
  const selected: string[] = [];
  for (const entity of Object.values(map.entities)) {
    if (!unlockedVisibleLayers.has(entity.layerId)) {
      continue;
    }
    if (entity.type === 'light' || entity.type === 'portal' || entity.type === 'prop') {
      if (
        entity.x >= box.minX &&
        entity.x <= box.maxX &&
        entity.y >= box.minY &&
        entity.y <= box.maxY
      ) {
        selected.push(entity.id);
      }
      continue;
    }
    const bounds = getEntityBounds(entity);
    if (bounds && boxesIntersect(bounds, box)) {
      selected.push(entity.id);
    }
  }
  return selected;
}
