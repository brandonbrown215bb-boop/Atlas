import clipping, { type MultiPolygon, type Ring } from 'polygon-clipping';
import type { Point } from '../model/schema';

/** Turn SVG contours into separate areas, preserving holes and islands. */
export function svgAreaRings(contours: Point[][], fillRule: 'nonzero' | 'evenodd'): Point[][][] {
  let regions = new Map<number, MultiPolygon>();
  for (const points of contours) {
    if (points.length < 3) continue;
    const ring: Ring = points.map((p) => [p.x, p.y]);
    const polygon: MultiPolygon = [[ring]];
    if (fillRule === 'evenodd') {
      regions.set(1, clipping.xor(regions.get(1) ?? [], polygon));
      continue;
    }
    const signedArea = points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0);
    if (signedArea === 0) continue;
    const direction = Math.sign(signedArea);
    const next = new Map<number, MultiPolygon>();
    const add = (winding: number, region: MultiPolygon) => {
      if (winding !== 0 && region.length) {
        next.set(winding, clipping.union(next.get(winding) ?? [], region));
      }
    };
    let uncovered = polygon;
    for (const [winding, region] of regions) {
      add(winding, clipping.difference(region, polygon));
      add(winding + direction, clipping.intersection(region, polygon));
      uncovered = clipping.difference(uncovered, region);
    }
    add(direction, uncovered);
    regions = next;
  }
  const filled = [...regions.values()].reduce<MultiPolygon>(
    (all, region) => clipping.union(all, region), [],
  );
  return filled.map((polygon) => polygon.map((ring) =>
    ring.slice(0, -1).map(([x, y]) => ({ x, y })),
  ));
}
