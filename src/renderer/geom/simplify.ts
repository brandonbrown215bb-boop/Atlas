import type { Point } from '../model/schema';
import { distanceToSegment } from './hitTest';

function rdpOpen(points: readonly Point[], epsilon: number): Point[] {
  if (points.length <= 2) {
    return [...points];
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = -1;
  let maxIdx = -1;

  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon && maxIdx !== -1) {
    const left = rdpOpen(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpOpen(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/**
 * Ramer-Douglas-Peucker polyline/polygon simplification.
 */
export function simplifyRDP(
  points: readonly Point[],
  epsilon: number,
  closed = false,
): Point[] {
  if (epsilon <= 0) {
    return [...points];
  }
  if (!closed) {
    return rdpOpen(points, epsilon);
  }
  if (points.length <= 3) {
    return [...points];
  }
  // Split closed ring at the point farthest from points[0]
  const start = points[0]!;
  let splitIdx = 1;
  let bestDist = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]!.x - start.x, points[i]!.y - start.y);
    if (d > bestDist) {
      bestDist = d;
      splitIdx = i;
    }
  }
  const half1 = rdpOpen(points.slice(0, splitIdx + 1), epsilon);
  const half2 = rdpOpen([...points.slice(splitIdx), start], epsilon);
  const combined = [...half1.slice(0, -1), ...half2.slice(0, -1)];
  return combined.length >= 3 ? combined : [...points.slice(0, 3)];
}

/**
 * Chaikin corner-cutting curve smoothing.
 */
export function smoothChaikin(
  points: readonly Point[],
  iterations = 1,
  closed = false,
): Point[] {
  if (points.length < 2 || iterations <= 0) {
    return [...points];
  }
  let current = [...points];
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 2) break;
    const next: Point[] = [];
    if (!closed) {
      next.push(current[0]!);
      for (let i = 0; i < current.length - 1; i++) {
        const a = current[i]!;
        const b = current[i + 1]!;
        next.push(
          { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
          { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
        );
      }
      next.push(current[current.length - 1]!);
    } else {
      for (let i = 0; i < current.length; i++) {
        const a = current[i]!;
        const b = current[(i + 1) % current.length]!;
        next.push(
          { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
          { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
        );
      }
    }
    current = next;
  }
  return current;
}

export function snapPointToGrid(pt: Point, gridSize: number): Point {
  if (gridSize <= 0) {
    return pt;
  }
  return {
    x: Math.round(pt.x / gridSize) * gridSize,
    y: Math.round(pt.y / gridSize) * gridSize,
  };
}
