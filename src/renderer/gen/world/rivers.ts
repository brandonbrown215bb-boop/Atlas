import { joinAuthoredRivers } from './manualRivers';
import { drainTerrain } from './drainage';
import type { Entity, Point } from '../../model/schema';
import type { Terrain } from './terrain';
import { clipOutside } from '../../geom/clipOutside';
import { bboxFromPoints } from '../../geom/hitTest';

export interface RiverRoute { cells: number[]; points: Point[]; elevations: number[]; flow: number; outlet?: 'water' | 'junction' | 'boundary'; waterfalls?: Point[] }

/** Strict descent makes the drainage graph acyclic; depressions retain their water. */
export function buildRivers(terrain: Terrain, rainfall: number[], threshold: number): RiverRoute[] {
  const cells = terrain.cells;
  const downhill = cells.every(c => c.downstream !== undefined) ? cells.map(c => c.downstream!) : drainTerrain(terrain);
  downhill.forEach((next, i) => { cells[i]!.downstream = next; });
  const flow = cells.map((c, i) =>
    c.land ? 0.14 + Math.pow(Math.max(0, rainfall[i] ?? 0.5), 1.3) * 1.15 + Math.max(0, c.elevation - 0.52) * 0.65 : 0,
  );
  const order = cells.map((_, i) => i).sort((a, b) => cells[b]!.elevation - cells[a]!.elevation || a - b);
  for (const i of order) if (downhill[i]! >= 0) flow[downhill[i]!]! += flow[i]!;
  const active = cells.map((c, i) => c.land && flow[i]! >= threshold && downhill[i]! >= 0);
  const incoming = cells.map(() => 0);
  active.forEach((yes, i) => { if (yes) incoming[downhill[i]!]!++; });
  const result: RiverRoute[] = [];
  const epsilon = 2e-8;
  const { minX, minY } = bboxFromPoints(terrain.region[0]!)!;
  const sharedMidpoint = (a: number, b: number): Point => {
    const shared = cells[a]!.ring.filter(p => cells[b]!.ring.some(q => Math.hypot(p.x - q.x, p.y - q.y) < epsilon));
    if (shared.length < 2) throw new Error('River cells do not share an edge.');
    return { x: minX + (shared[0]!.x + shared[1]!.x) / 2 * terrain.size, y: minY + (shared[0]!.y + shared[1]!.y) / 2 * terrain.size };
  };
  for (const start of order) {
    if (!active[start] || incoming[start] === 1) continue;
    const route = [start];
    let at = start;
    while (active[at]) {
      const next = downhill[at]!;
      route.push(next);
      at = next;
      if (incoming[at] !== 1) break;
    }
    if (route.length < 2) continue;
    const terminal = cells[at]!, outlet = !terminal.land ? 'water' : downhill[at]! < 0 ? 'boundary' : 'junction';
    const seaLevel = terrain.seaLevel ?? 0.45;
    if (incoming[start] === 0 && threshold >= 8 && (route.length <= 2 || (route.length <= 5 && cells[start]!.elevation < seaLevel + 0.09))) continue;

    const raw: Point[] = [cells[start]!.point], elevations = [cells[start]!.elevation];
    for (let j = 1; j < route.length; j++) {
      const a = route[j - 1]!, b = route[j]!;
      raw.push(sharedMidpoint(a, b), cells[b]!.point);
      elevations.push((cells[a]!.elevation + cells[b]!.elevation) / 2, cells[b]!.elevation);
    }

    // Round each bend with a quadratic Bezier inside its convex Voronoi cell; retain edge crossings exactly.
    const points: Point[] = [raw[0]!], heights = [elevations[0]!];
    for (let j = 1; j < raw.length - 1; j++) {
      if (j % 2) {
        points.push(raw[j]!);
        heights.push(elevations[j]!);
        continue;
      }
      const a = raw[j - 1]!, c = raw[j]!, b = raw[j + 1]!;
      const ea = elevations[j - 1]!, ec = elevations[j]!, eb = elevations[j + 1]!;
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t;
        points.push({
          x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
          y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        });
        heights.push(t <= 0.5 ? ea + (ec - ea) * (t * 2) : ec + (eb - ec) * ((t - 0.5) * 2));
      }
    }
    points.push(raw[raw.length - 1]!);
    heights.push(elevations[elevations.length - 1]!);

    if (outlet === 'boundary') {
      const last = points[points.length - 1]!;
      let closest = last, distance = Infinity;
      for (const ring of terrain.region) {
        for (let j = 0; j < ring.length; j++) {
          const a = ring[j]!, b = ring[(j + 1) % ring.length]!, dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((last.x - a.x) * dx + (last.y - a.y) * dy) / (dx * dx + dy * dy)));
          const p = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(last.x - p.x, last.y - p.y);
          if (d < distance) { closest = p; distance = d; }
        }
      }
      points.push(closest);
      heights.push(terminal.elevation);
    }
    const waterfalls: Point[] = [];
    for (let j = 1; j < route.length; j++) {
      const elevDrop = cells[route[j - 1]!]!.elevation - cells[route[j]!]!.elevation;
      if (elevDrop >= 0.045) waterfalls.push(sharedMidpoint(route[j - 1]!, route[j]!));
    }
    result.push({ cells: route, points, elevations: heights, flow: flow[start]!, outlet, ...(waterfalls.length ? { waterfalls } : {}) });
  }
  return result;
}

export function riverEntities(terrain: Terrain, routes: RiverRoute[], constraints: Entity[] = []): Entity[] {
  return routes.flatMap((route, i) => {
    const joined = joinAuthoredRivers(route.points, constraints);
    let pieces = clipOutside(joined, false, terrain.region[0]!, true);
    for (const hole of terrain.region.slice(1)) pieces = pieces.flatMap(points => clipOutside(points, false, hole));
    const navigable = route.flow >= 18;
    const baseName = route.outlet === 'boundary'
      ? 'River · boundary outlet'
      : navigable
        ? 'Navigable river'
        : 'River';
    return pieces.map((points, j): Entity => ({
      id: `river-${i}-${j}`,
      type: 'path',
      role: 'river',
      name: baseName,
      outlet: joined !== route.points ? 'authored' : route.outlet,
      origin: 'generated',
      layerId: 'base',
      rev: 0,
      points,
      startNodeId: `river-node:${points[0]!.x.toFixed(6)}:${points[0]!.y.toFixed(6)}`,
      endNodeId: `river-node:${points[points.length - 1]!.x.toFixed(6)}:${points[points.length - 1]!.y.toFixed(6)}`,
      closed: false,
      width: Math.max(4, Math.round(6 * Math.min(8, Math.sqrt(route.flow / 8)))),
    }));
  });
}
