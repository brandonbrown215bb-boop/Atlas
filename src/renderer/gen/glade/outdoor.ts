import { z } from 'zod';
import { bboxFromPoints, distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { smoothChaikin, simplifyRDP } from '../../geom/simplify';
import { PointSchema, type Entity, type Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import { registerGenerator, type GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';

export const OutdoorParamsSchema = z.object({
  clearings: z.number().int().min(1).max(20).default(6),
  density: z.number().min(0).max(3).default(1),
  water: z.boolean().default(true),
  stream: z.boolean().default(true),
  pond: z.boolean().default(true),
  // Empty means entrances at the north and south edges. Custom points are projected onto the boundary.
  entrances: z.array(PointSchema).max(8).default([]),
});
export type OutdoorParams = z.infer<typeof OutdoorParamsSchema>;
type Cell = Point & { col: number; row: number; key: string };
const base = { origin: 'generated' as const, layerId: 'generated', rev: 0 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const lineDistance = (p: Point, points: Point[]) => Math.min(...points.slice(1).map((b, i) => distanceToSegment(p, points[i]!, b)));
const ringDistance = (p: Point, rings: Point[][]) => Math.min(...rings.flatMap(r => r.map((a, i) => distanceToSegment(p, a, r[(i + 1) % r.length]!))));

/** A small routing grid keeps trails inside concave footprints and away from deliberate edits. */
export function generateOutdoor(input: GeneratorInput<OutdoorParams>): Entity[] {
  const { region, constraints, params, grid: g } = input;
  const random = mulberry32(input.seed), box = bboxFromPoints(region[0]!)!;
  const cols = Math.ceil((box.maxX - box.minX) / g), rows = Math.ceil((box.maxY - box.minY) / g);
  if (cols * rows > 20000) throw new Error('Outdoor footprint is too large: use at most 20,000 grid squares.');
  const trailWidth = g * 2.2, trailRadius = trailWidth / 2;
  // Developed sites commonly inherit a whole land/biome backdrop; it is ground, not an obstacle.
  const areas = constraints.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area'
    && !(e.origin === 'inherited' && (e.role === 'land' || e.role.startsWith('biome:'))));
  const paths = constraints.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path');
  const walls = constraints.filter((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall');
  const props = constraints.filter(e => e.type === 'prop').map(e => getEntityBounds(e)!);
  const blocked = (p: Point, radius: number) => areas.some(e => pointInPolygon(p, e.rings) || ringDistance(p, e.rings) < radius)
    || paths.some(e => !['trail', 'road'].includes(e.role) && lineDistance(p, e.points) < radius + e.width / 2)
    || walls.some(e => lineDistance(p, e.points) < radius + g * .15)
    || props.some(b => p.x + radius > b.minX && p.x - radius < b.maxX && p.y + radius > b.minY && p.y - radius < b.maxY);
  const fits = (p: Point, radius: number) => pointInPolygon(p, region) && ringDistance(p, region) >= radius && !blocked(p, radius);
  const cells = new Map<string, Cell>();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const cell = { x: box.minX + (col + .5) * g, y: box.minY + (row + .5) * g, col, row, key: `${col},${row}` };
    if (fits(cell, trailRadius + g * .1)) cells.set(cell.key, cell);
  }
  const neighbors = (c: Cell, allowed: Map<string, Cell>): Cell[] => [[1, 0], [0, 1], [-1, 0], [0, -1]].flatMap(([dx, dy]) => {
    const n = allowed.get(`${c.col + dx!},${c.row + dy!}`);
    // Midpoints catch narrow obstacles between two otherwise clear cells.
    return n && fits({ x: (n.x + c.x) / 2, y: (n.y + c.y) / 2 }, trailRadius) ? [n] : [];
  });
  const component = (start: Cell, allowed: Map<string, Cell>) => {
    const queue = [start], seen = new Map([[start.key, start]]);
    for (let i = 0; i < queue.length; i++) for (const n of neighbors(queue[i]!, allowed)) if (!seen.has(n.key)) {
      seen.set(n.key, n); queue.push(n);
    }
    return seen;
  };
  const first = cells.values().next().value as Cell | undefined;
  if (!first || cells.size < params.clearings * 16) throw new Error('Not enough open ground for these clearings. Enlarge the footprint or reduce the count.');
  const connected = component(first, cells);
  if (connected.size !== cells.size) throw new Error('The outdoor footprint is disconnected by a hole or manual obstacle. Choose one connected area.');
  const all = [...cells.values()];
  const nearest = (p: Point, choices = all) => choices.reduce((a, b) => distance(a, p) <= distance(b, p) ? a : b);
  const projectBoundary = (p: Point): Point => region[0]!.map((a, i) => {
    const b = region[0]![(i + 1) % region[0]!.length]!, dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return { x: a.x + dx * t, y: a.y + dy * t };
  }).reduce((a, b) => distance(a, p) <= distance(b, p) ? a : b);
  const entrancePoints = (params.entrances.length ? params.entrances : [
    { x: (box.minX + box.maxX) / 2, y: box.minY }, { x: (box.minX + box.maxX) / 2, y: box.maxY },
  ]).map(projectBoundary);
  const entrances = entrancePoints.map(p => nearest(p));
  const segmentFits = (a: Point, b: Point, radius = trailRadius, boundary = false) => {
    const steps = Math.max(1, Math.ceil(distance(a, b) / (g * .2)));
    for (let i = 0; i <= steps; i++) {
      const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
      if (blocked(p, radius) || (!boundary && !fits(p, radius))) return false;
      if (boundary && i > 0 && i < steps && !pointInPolygon(p, region)) return false;
    }
    return true;
  };
  entrancePoints.forEach((p, i) => {
    if (distance(p, entrances[i]!) > g * 4 || !segmentFits(p, entrances[i]!, trailRadius, true)) {
      throw new Error('An entrance is blocked. Move it to an open part of the boundary.');
    }
  });

  // Breadth-first routing with seeded neighbor order, followed by safe corner smoothing.
  const directionOrder = new Map(all.map(c => [c.key, random()]));
  const route = (start: Cell, end: Cell, allowed = cells, extraFits = (_p: Point) => true): Point[] => {
    const queue = [start], previous = new Map<string, Cell | null>([[start.key, null]]);
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i]!;
      if (c.key === end.key) {
        const points: Point[] = []; let current: Cell | null = c;
        while (current) { points.push({ x: current.x, y: current.y }); current = previous.get(current.key)!; }
        points.reverse();
        const simple = simplifyRDP(points, g * .8);
        const smoothed = smoothChaikin(simple, 2);
        const safe = (line: Point[]) => line.slice(1).every((p, j) => {
          const a = line[j]!, steps = Math.max(1, Math.ceil(distance(a, p) / (g * .2)));
          return segmentFits(a, p) && Array.from({ length: steps + 1 }, (_, k) => ({ x: a.x + (p.x - a.x) * k / steps, y: a.y + (p.y - a.y) * k / steps })).every(extraFits);
        });
        if (safe(smoothed)) return smoothed;
        const rounded = smoothChaikin(points, 1);
        return safe(rounded) ? rounded : points;
      }
      for (const n of neighbors(c, allowed).sort((a, b) => directionOrder.get(a.key)! - directionOrder.get(b.key)!)) if (!previous.has(n.key)) {
        previous.set(n.key, c); queue.push(n);
      }
    }
    throw new Error('Cannot connect the outdoor paths around these constraints.');
  };

  const radius = Math.max(g * 1.8, Math.min(g * 5, Math.sqrt(cells.size / params.clearings) * g * .18));
  const candidates = all.filter(p => fits(p, radius + g * .3));
  const clearings: { center: Cell; radius: number; rings: Point[][] }[] = [];
  const scores = new Map(candidates.map(c => [c.key, random()]));
  for (let i = 0; i < params.clearings; i++) {
    const available = candidates.filter(c => clearings.every(other => distance(c, other.center) > radius * 2.5));
    const center = available.sort((a, b) => {
      const score = (c: Cell) => clearings.length ? Math.min(...clearings.map(other => distance(c, other.center))) * (.85 + scores.get(c.key)! * .15) : scores.get(c.key)!;
      return score(b) - score(a);
    })[0];
    if (!center) throw new Error('Not enough space to separate these clearings. Reduce the count or enlarge the footprint.');
    const r = radius * (.85 + random() * .15);
    const ring = Array.from({ length: 24 }, (_, j) => {
      const angle = j / 24 * Math.PI * 2, reach = r * (.83 + random() * .17);
      return { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach };
    });
    clearings.push({ center, radius: r, rings: [smoothChaikin(ring, 1, true)] });
  }
  const trails: Point[][] = [];
  const woodlandTrail = (start: Cell, end: Cell): Point[] => {
    const length = distance(start, end);
    if (length < g * 8) return route(start, end);
    const dx = -(end.y - start.y) / length, dy = (end.x - start.x) / length;
    const amplitude = Math.min(length * .2, g * 6) * (random() < .5 ? -1 : 1);
    const stops = [start, ...[1 / 3, 2 / 3].map((t, i) => nearest({
      x: start.x + (end.x - start.x) * t + dx * amplitude * (i ? -.7 : 1),
      y: start.y + (end.y - start.y) * t + dy * amplitude * (i ? -.7 : 1),
    })), end];
    const points = stops.slice(1).flatMap((stop, i) => route(stops[i]!, stop).slice(i ? 1 : 0));
    const rounded = smoothChaikin(points, 2);
    return rounded.slice(1).every((p, i) => segmentFits(rounded[i]!, p)) ? rounded : points;
  };
  const joined = [clearings[0]!.center], remaining = clearings.slice(1).map(c => c.center);
  while (remaining.length) {
    let best = { from: joined[0]!, index: 0, distance: Infinity };
    for (const from of joined) remaining.forEach((to, index) => {
      if (distance(from, to) < best.distance) best = { from, index, distance: distance(from, to) };
    });
    const to = remaining.splice(best.index, 1)[0]!;
    trails.push(woodlandTrail(best.from, to)); joined.push(to);
  }
  entrances.forEach((entrance, i) => trails.push([entrancePoints[i]!, ...woodlandTrail(entrance, nearest(entrance, joined))]));
  // Preserve a hand-drawn trail and connect its ends to the generated network.
  for (const path of paths.filter(p => ['trail', 'road'].includes(p.role))) for (const endpoint of [path.points[0]!, path.points.at(-1)!]) {
    if (!pointInPolygon(endpoint, region)) continue;
    const start = nearest(endpoint);
    if (segmentFits(endpoint, start)) trails.push([endpoint, ...woodlandTrail(start, nearest(start, joined))]);
  }
  const layout: Entity[] = clearings.map((c, i) => ({ ...base, id: `clearing-${i}`, type: 'area', role: 'land', name: `Clearing ${i + 1}`, rings: c.rings, fill: '#8ba561' }));

  let stream: Point[] = [];
  const streamWidth = g * 1.3;
  if (params.water && params.stream) {
    const waterCells = new Map(all.filter(c => clearings.every(clear => distance(c, clear.center) > clear.radius + streamWidth)).map(c => [c.key, c]));
    const west = [...waterCells.values()].sort((a, b) => a.x - b.x || Math.abs(a.y - (box.minY + box.maxY) / 2) - Math.abs(b.y - (box.minY + box.maxY) / 2))[0];
    if (!west) throw new Error('No room for a stream. Turn it off or reduce the clearing count.');
    const waterComponent = component(west, waterCells), choices = [...waterComponent.values()];
    const east = choices.reduce((a, b) => a.x > b.x ? a : b);
    if (east.x - west.x < (box.maxX - box.minX) * .6) throw new Error('No room for a stream crossing. Turn it off or reduce the clearing count.');
    // Keep smoothing out of the clearings as well as out of manual obstacles.
    stream = route(west, east, waterComponent, p => clearings.every(c => distance(p, c.center) > c.radius + streamWidth / 2));
    const westEdge = projectBoundary({ x: box.minX, y: west.y }), eastEdge = projectBoundary({ x: box.maxX, y: east.y });
    if (segmentFits(westEdge, west, streamWidth / 2, true)) stream.unshift(westEdge);
    if (segmentFits(east, eastEdge, streamWidth / 2, true)) stream.push(eastEdge);
    layout.push({ ...base, id: 'stream', name: 'Stream', type: 'path', role: 'river', points: stream, width: streamWidth, closed: false });
  }
  let pond: Point[][] | undefined;
  if (params.water && params.pond) {
    const pondRadius = g * 2.2;
    const options = all.filter(c => fits(c, pondRadius + g * .2)
      && clearings.every(clear => distance(c, clear.center) > clear.radius + pondRadius + g)
      && trails.every(t => lineDistance(c, t) > pondRadius + trailRadius + g)
      && paths.every(p => lineDistance(c, p.points) > pondRadius + p.width / 2 + g));
    const center = options[Math.floor(random() * options.length)];
    if (!center) throw new Error('No room for a pond beside the paths. Turn it off or enlarge the footprint.');
    pond = [smoothChaikin(Array.from({ length: 20 }, (_, i) => {
      const angle = i / 20 * Math.PI * 2, r = pondRadius * (.8 + random() * .2);
      return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
    }), 2, true)];
    layout.push({ ...base, id: 'pond', name: 'Pond', type: 'area', role: 'water', rings: pond, fill: '#469caa' });
  }
  layout.push(...trails.filter(t => t.length > 1).map((points, i): Entity => ({ ...base, id: `trail-${i}`, type: 'path', role: 'trail', name: 'Woodland trail', points, width: trailWidth, closed: false })));

  // Cover every wet stretch of a trail, including a grazing crossing, with a themed bridge.
  const bridges: Entity[] = [];
  const bridgeTrails = [...trails.map(points => ({ points, width: trailWidth })), ...paths.filter(p => ['trail', 'road'].includes(p.role))];
  if (stream.length) for (const { points: trail, width } of bridgeTrails) {
    let wet: Point[] = [];
    const flush = () => {
      if (wet.length < 2) { wet = []; return; }
      const a = wet[0]!, b = wet.at(-1)!, length = distance(a, b);
      const bend = Math.max(...wet.map(p => distanceToSegment(p, a, b)));
      const assets = themeAssets(input.theme, 'bridge'), asset = assets[Math.floor(random() * assets.length)]!;
      bridges.push({ ...base, id: `bridge-${bridges.length}`, type: 'prop', name: 'Stream bridge', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        w: length + g * .8, h: width + bend * 2, rotation: Math.atan2(b.y - a.y, b.x - a.x), scale: 1, flipX: false,
        ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }) });
      wet = [];
    };
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1]!, b = trail[i]!;
      const steps = Math.max(1, Math.ceil(distance(a, b) / (g * .2)));
      let previous = a;
      for (let j = 1; j <= steps; j++) {
        const p = { x: a.x + (b.x - a.x) * j / steps, y: a.y + (b.y - a.y) * j / steps };
        const crosses = Math.min(lineDistance(previous, stream), lineDistance(p, stream)) <= streamWidth / 2 + width / 2;
        if (crosses) {
          if (!wet.length) wet.push(previous);
          wet.push(p);
        } else flush();
        previous = p;
      }
    }
    flush();
  }
  layout.push(...bridges);

  // A dense band follows the footprint and walkable edges, with lighter scattering elsewhere.
  const trees: Entity[] = [], spacing = g * 1.6;
  for (let y = box.minY + spacing / 2; y < box.maxY; y += spacing) for (let x = box.minX + spacing / 2; x < box.maxX; x += spacing) {
    const p = { x: x + (random() - .5) * spacing * .65, y: y + (random() - .5) * spacing * .65 };
    const size = g * (1.25 + random() * .7), radius = size * Math.SQRT2 / 2;
    if (!fits(p, radius) || clearings.some(c => distance(p, c.center) < c.radius + radius)) continue;
    const trailDistance = Math.min(...trails.map(t => lineDistance(p, t)));
    if (trailDistance < trailRadius + radius || paths.some(t => lineDistance(p, t.points) < t.width / 2 + radius)) continue;
    if (stream.length && lineDistance(p, stream) < streamWidth / 2 + radius) continue;
    if (pond && (pointInPolygon(p, pond) || ringDistance(p, pond) < radius)) continue;
    if (bridges.some(e => { const b = getEntityBounds(e)!; return p.x + radius > b.minX && p.x - radius < b.maxX && p.y + radius > b.minY && p.y - radius < b.maxY; })) continue;
    const band = ringDistance(p, region) < g * 4 || trailDistance < trailRadius + g * 4 || clearings.some(c => distance(p, c.center) < c.radius + g * 4);
    if (random() > Math.min(.95, params.density * (band ? .85 : .18))) continue;
    const assets = themeAssets(input.theme, 'tree'), asset = assets[Math.floor(random() * assets.length)]!;
    trees.push({ ...base, id: `tree-${trees.length}`, type: 'prop', name: 'Tree', ...p, w: size, h: size, rotation: random() * Math.PI * 2, scale: 1, flipX: random() < .5,
      ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }) });
  }
  return [...layout, ...trees, ...clearings.map((c, i): Entity => ({ ...base, id: `label-${i}`, type: 'label', name: `Clearing ${i + 1}`, text: String(i + 1), x: c.center.x, y: c.center.y, size: 18 }))];
}

registerGenerator({ type: 'glade', title: 'Outdoor woodland', params: OutdoorParamsSchema, generate: generateOutdoor });
