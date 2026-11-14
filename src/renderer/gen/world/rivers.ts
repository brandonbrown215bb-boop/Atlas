import type { Entity, Point } from '../../model/schema';
import type { Terrain } from './terrain';
import { clipOutside } from '../../geom/clipOutside';

export interface RiverRoute { cells: number[]; points: Point[]; elevations: number[]; flow: number }

/** Strict descent makes the drainage graph acyclic; depressions retain their water. */
export function buildRivers(terrain: Terrain, rainfall: number[], threshold: number): RiverRoute[] {
  const cells = terrain.cells;
  const downhill = cells.map(c => c.neighbors.filter(i => cells[i]!.elevation < c.elevation - 1e-10)
    .sort((a, b) => cells[a]!.elevation - cells[b]!.elevation || a - b)[0] ?? -1);
  const flow = cells.map((c, i) => c.land ? .25 + (rainfall[i] ?? .5) : 0);
  const order = cells.map((_, i) => i).sort((a, b) => cells[b]!.elevation - cells[a]!.elevation || a - b);
  for (const i of order) if (downhill[i]! >= 0) flow[downhill[i]!]! += flow[i]!;
  const active = cells.map((c, i) => c.land && flow[i]! >= threshold && downhill[i]! >= 0);
  const incoming = cells.map(() => 0);
  active.forEach((yes, i) => { if (yes) incoming[downhill[i]!]!++; });
  const result: RiverRoute[] = [];
  const epsilon = 2e-8;
  const sharedMidpoint = (a: number, b: number): Point => {
    const shared = cells[a]!.ring.filter(p => cells[b]!.ring.some(q => Math.hypot(p.x - q.x, p.y - q.y) < epsilon));
    if (shared.length < 2) throw new Error('River cells do not share an edge.');
    const origin = terrain.region[0]!;
    const minX = Math.min(...origin.map(p => p.x)), minY = Math.min(...origin.map(p => p.y));
    return { x: minX + (shared[0]!.x + shared[1]!.x) / 2 * terrain.size, y: minY + (shared[0]!.y + shared[1]!.y) / 2 * terrain.size };
  };
  for (const start of order) {
    if (!active[start] || incoming[start] === 1) continue;
    const route = [start];
    let at = start;
    while (active[at]) {
      const next = downhill[at]!; route.push(next); at = next;
      if (incoming[at] !== 1) break;
    }
    if (route.length < 2) continue;
    const raw: Point[] = [cells[start]!.point], elevations = [cells[start]!.elevation];
    for (let j = 1; j < route.length; j++) {
      const a = route[j - 1]!, b = route[j]!;
      raw.push(sharedMidpoint(a, b), cells[b]!.point);
      elevations.push((cells[a]!.elevation + cells[b]!.elevation) / 2, cells[b]!.elevation);
    }
    // Round each centre's bend inside its convex cell; retain the shared-edge crossings exactly.
    const points: Point[] = [raw[0]!], heights = [elevations[0]!];
    for (let j = 1; j < raw.length - 1; j++) {
      if (j % 2) { points.push(raw[j]!); heights.push(elevations[j]!); continue; }
      for (const [index, weight] of [[j - 1, .2], [j + 1, .2]] as const) {
        points.push({ x: raw[j]!.x * (1 - weight) + raw[index]!.x * weight, y: raw[j]!.y * (1 - weight) + raw[index]!.y * weight });
        heights.push(elevations[j]! * (1 - weight) + elevations[index]! * weight);
      }
    }
    points.push(raw[raw.length - 1]!); heights.push(elevations[elevations.length - 1]!);
    result.push({ cells: route, points, elevations: heights, flow: flow[start]! });
  }
  return result;
}

export function riverEntities(terrain: Terrain, routes: RiverRoute[]): Entity[] {
  return routes.flatMap((route, i) => {
    let pieces = clipOutside(route.points, false, terrain.region[0]!, true);
    for (const hole of terrain.region.slice(1)) pieces = pieces.flatMap(points => clipOutside(points, false, hole));
    return pieces.map((points, j): Entity => ({ id: `river-${i}-${j}`, type: 'path', role: 'river', name: 'River', origin: 'generated', layerId: 'base', rev: 0,
      points, closed: false, width: terrain.size * .00065 * Math.min(3, Math.sqrt(route.flow / 10)) }));
  });
}
