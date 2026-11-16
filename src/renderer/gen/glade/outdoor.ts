import { z } from 'zod';
import { bboxFromPoints, distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { smoothChaikin, simplifyRDP } from '../../geom/simplify';
import { PointSchema, type Entity, type Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import { registerGenerator, type GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';

export const OutdoorParamsSchema = z.object({
  preset: z.enum(['woodland', 'roadside', 'ruins']).default('woodland'),
  clearings: z.number().int().min(1).max(20).default(6),
  density: z.number().min(0).max(3).default(1),
  water: z.boolean().default(true),
  stream: z.boolean().default(true),
  pond: z.boolean().default(true),
  edgeTrees: z.boolean().optional(),
  groveTightness: z.number().min(0).max(1).optional(),
  renderSeed: z.number().int().optional(),
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
  const trailWidth = g * 1.15, trailRadius = trailWidth / 2;
  // Developed sites commonly inherit a whole land/biome backdrop; it is ground, not an obstacle.
  const areas = constraints.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area'
    && !(e.origin === 'inherited' && (e.role === 'land' || e.role.startsWith('biome:')))
    && !(e.usage === 'blueprint' && (e.role === 'floor' || e.role === 'land')));
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

  // Weighted Dijkstra routing encourages nearby trails to share common trunk spines before forking.
  const directionOrder = new Map(all.map(c => [c.key, random()]));
  const cellUsage = new Map<string, number>();
  const smoothCellChain = (points: Point[], extraFits = (_p: Point) => true): Point[] => {
    if (points.length < 3) return points;
    const segClear = (u: Point, v: Point) => {
      const steps = Math.max(1, Math.ceil(distance(u, v) / (g * 0.25)));
      if (!segmentFits(u, v)) return false;
      for (let k = 0; k <= steps; k++) {
        if (!extraFits({ x: u.x + (v.x - u.x) * k / steps, y: u.y + (v.y - u.y) * k / steps })) return false;
      }
      return true;
    };
    const safe = (line: Point[]) => line.slice(1).every((p, j) => segClear(line[j]!, p));
    // RDP keeps the routed bends (a line-of-sight shortcut pulled trails taut); it also splits where a chord leaves open ground,
    // so one blocked stretch keeps its cells instead of the whole trail falling back to grid stairs.
    const simplify = (pts: Point[]): Point[] => {
      if (pts.length < 3) return pts;
      const a = pts[0]!, b = pts[pts.length - 1]!;
      let far = 0, split = 1;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = distanceToSegment(pts[i]!, a, b);
        if (d > far) { far = d; split = i; }
      }
      if (far <= g * .8 && segClear(a, b)) return [a, b];
      return [...simplify(pts.slice(0, split + 1)).slice(0, -1), ...simplify(pts.slice(split))];
    };
    const basePts = simplify(points);
    const chaikin = smoothChaikin(basePts, 2);
    // Keep exact endpoints pinned so branch junctions fuse seamlessly without corner gaps.
    const pinned = chaikin.length >= 2 ? [points[0]!, ...chaikin.slice(1, -1), points[points.length - 1]!] : basePts;
    if (safe(pinned)) return pinned;
    // Per-corner fallback: bevel each safe corner with a bounded radius so bends stay curved without cutting across tree clumps.
    const rounded: Point[] = [basePts[0]!];
    for (let i = 1; i < basePts.length - 1; i++) {
      const a = rounded[rounded.length - 1]!, b = basePts[i]!, c = basePts[i + 1]!;
      const lenAB = distance(a, b), lenBC = distance(b, c);
      const cut = Math.min(g * 1.45, lenAB * 0.35, lenBC * 0.35);
      if (cut > g * 0.15) {
        const q = { x: b.x + (a.x - b.x) * (cut / lenAB), y: b.y + (a.y - b.y) * (cut / lenAB) };
        const r = { x: b.x + (c.x - b.x) * (cut / lenBC), y: b.y + (c.y - b.y) * (cut / lenBC) };
        if (segClear(a, q) && segClear(q, r) && segClear(r, c)) {
          rounded.push(q, r);
          continue;
        }
      }
      rounded.push(b);
    }
    rounded.push(basePts[basePts.length - 1]!);
    // Every bevel was checked, so rounded is exactly as clear as basePts.
    return rounded;
  };
  const routeCells = (start: Cell, end: Cell, allowed = cells, penaltyClearings = false): Cell[] => {
    const distMap = new Map<string, number>([[start.key, 0]]);
    const previous = new Map<string, Cell | null>([[start.key, null]]);
    const queue: Array<{ cell: Cell; d: number }> = [{ cell: start, d: 0 }];
    while (queue.length) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i]!.d < queue[bestIdx]!.d) bestIdx = i;
      const { cell: c, d } = queue.splice(bestIdx, 1)[0]!;
      if (d > (distMap.get(c.key) ?? Infinity)) continue;
      if (c.key === end.key) {
        const out: Cell[] = [];
        let cur: Cell | null = c;
        while (cur) { out.push(cur); cur = previous.get(cur.key)!; }
        return out.reverse();
      }
      for (const n of neighbors(c, allowed)) {
        const sharedDiscount = cellUsage.has(n.key) ? 0.34 : 1;
        const clearingPenalty = penaltyClearings
          && clearings.some((cl) =>
            cl.center.key !== start.key
            && cl.center.key !== end.key
            && distance(n, cl.center) < cl.radius + trailRadius * 1.5,
          )
          ? g * 28
          : 0;
        const step = distance(c, n) * sharedDiscount + (directionOrder.get(n.key) ?? 0) * g * 0.08 + clearingPenalty;
        const nextD = d + step;
        if (nextD < (distMap.get(n.key) ?? Infinity)) {
          distMap.set(n.key, nextD);
          previous.set(n.key, c);
          queue.push({ cell: n, d: nextD });
        }
      }
    }
    throw new Error('Cannot connect the outdoor paths around these constraints.');
  };
  const route = (start: Cell, end: Cell, allowed = cells, extraFits = (_p: Point) => true): Point[] =>
    smoothCellChain(routeCells(start, end, allowed, false).map((c) => ({ x: c.x, y: c.y })), extraFits);

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
  type TrailSegment = { points: Point[]; width: number };
  const trails: TrailSegment[] = [];
  const rawCellRoutes: Cell[][] = [];
  const addCellRoute = (start: Cell, end: Cell): Cell[] => {
    const seq = (() => {
      const length = distance(start, end);
      if (length < g * 8) return routeCells(start, end, cells, true);
      const dx = -(end.y - start.y) / length, dy = (end.x - start.x) / length;
      const amplitude = Math.min(length * .2, g * 6) * (random() < .5 ? -1 : 1);
      // Two opposite offsets bend the trail into an S rather than one straight-sided V.
      const stops = [start, ...[1 / 3, 2 / 3].map((t, i) => nearest({
        x: start.x + (end.x - start.x) * t + dx * amplitude * (i ? -.7 : 1),
        y: start.y + (end.y - start.y) * t + dy * amplitude * (i ? -.7 : 1),
      })), end];
      const hitsOtherClearing = stops.slice(1, -1).some(stop => clearings.some((cl) =>
        cl.center.key !== start.key && cl.center.key !== end.key && distance(stop, cl.center) < cl.radius + trailRadius * 2,
      ));
      if (hitsOtherClearing) return routeCells(start, end, cells, true);
      const joinedCells: Cell[] = [];
      // Cut out-and-back spurs and loops where a leg revisits a cell an earlier leg already walked.
      for (const c of stops.slice(1).flatMap((stop, i) => routeCells(stops[i]!, stop, cells, true).slice(i ? 1 : 0))) {
        const at = joinedCells.findIndex(s => s.key === c.key);
        if (at >= 0) joinedCells.length = at;
        joinedCells.push(c);
      }
      return joinedCells;
    })();
    for (const c of seq) cellUsage.set(c.key, (cellUsage.get(c.key) ?? 0) + 1);
    rawCellRoutes.push(seq);
    return seq;
  };
  const joined = [clearings[0]!.center], remaining = clearings.slice(1).map(c => c.center);
  const connectedPairs = new Set<string>();
  while (remaining.length) {
    let best = { from: joined[0]!, index: 0, distance: Infinity };
    for (const from of joined) remaining.forEach((to, index) => {
      if (distance(from, to) < best.distance) best = { from, index, distance: distance(from, to) };
    });
    const to = remaining.splice(best.index, 1)[0]!;
    addCellRoute(best.from, to);
    joined.push(to);
    connectedPairs.add([best.from.key, to.key].sort().join('|'));
  }
  // Add 1-2 flanking loop trails between nearby clearings so outdoor skirmish maps aren't dead-end trees.
  if (clearings.length >= 3) {
    const loopPairs: Array<{ a: Cell; b: Cell; d: number }> = [];
    for (let i = 0; i < clearings.length; i++) for (let j = i + 1; j < clearings.length; j++) {
      const a = clearings[i]!.center, b = clearings[j]!.center;
      if (!connectedPairs.has([a.key, b.key].sort().join('|'))) loopPairs.push({ a, b, d: distance(a, b) });
    }
    loopPairs.sort((p, q) => p.d - q.d);
    for (const { a, b } of loopPairs.slice(0, 2)) addCellRoute(a, b);
  }
  const extraBoundaryAnchors: Array<{ pt: Point; cell: Cell }> = [];
  entrances.forEach((entrance, i) => {
    const seq = addCellRoute(entrance, nearest(entrance, joined));
    extraBoundaryAnchors.push({ pt: entrancePoints[i]!, cell: seq[0]! });
  });
  for (const path of paths.filter(p => ['trail', 'road'].includes(p.role))) for (const endpoint of [path.points[0]!, path.points.at(-1)!]) {
    if (!pointInPolygon(endpoint, region)) continue;
    const start = nearest(endpoint);
    if (segmentFits(endpoint, start)) {
      const seq = addCellRoute(start, nearest(start, joined));
      extraBoundaryAnchors.push({ pt: endpoint, cell: seq[0]! });
    }
  }
  // Decompose routed grid edges into clean non-overlapping graph branches, widening shared heavy-foot-traffic trunks.
  const edgeTraffic = new Map<string, number>();
  const adjMap = new Map<string, Set<string>>();
  const edgeKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const seq of rawCellRoutes) {
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]!.key, b = seq[i]!.key;
      if (a === b) continue;
      const ek = edgeKeyOf(a, b);
      edgeTraffic.set(ek, (edgeTraffic.get(ek) ?? 0) + 1);
      if (!adjMap.has(a)) adjMap.set(a, new Set());
      if (!adjMap.has(b)) adjMap.set(b, new Set());
      adjMap.get(a)!.add(b);
      adjMap.get(b)!.add(a);
    }
  }
  const mustSplitNodes = new Set<string>([
    ...clearings.map((c) => c.center.key),
    ...entrances.map((c) => c.key),
    ...extraBoundaryAnchors.map((a) => a.cell.key),
  ]);
  const isBreakNode = (k: string) => {
    if (mustSplitNodes.has(k)) return true;
    const deg = adjMap.get(k)?.size ?? 0;
    if (deg !== 2) return true;
    const [n1, n2] = [...adjMap.get(k)!];
    return (edgeTraffic.get(edgeKeyOf(k, n1!)) ?? 1) !== (edgeTraffic.get(edgeKeyOf(k, n2!)) ?? 1);
  };
  const visitedEdges = new Set<string>();
  const traceBranch = (startK: string, nextK: string) => {
    const chain: Cell[] = [cells.get(startK)!];
    let prevK = startK;
    let curK = nextK;
    while (true) {
      visitedEdges.add(edgeKeyOf(prevK, curK));
      chain.push(cells.get(curK)!);
      if (isBreakNode(curK)) break;
      const nxt = [...adjMap.get(curK)!].find((k) => k !== prevK);
      if (!nxt || visitedEdges.has(edgeKeyOf(curK, nxt))) break;
      prevK = curK;
      curK = nxt;
    }
    const traffic = edgeTraffic.get(edgeKeyOf(startK, nextK)) ?? 1;
    const clearGuard = (p: Point) => clearings.every((cl) =>
      cl.center.key === startK || cl.center.key === curK || distance(p, cl.center) > cl.radius + trailRadius * 1.15,
    );
    const smoothed = smoothCellChain(chain.map((c) => ({ x: c.x, y: c.y })), clearGuard);
    trails.push({ points: smoothed, width: traffic >= 2 ? trailWidth * 1.28 : trailWidth });
  };
  for (const k of adjMap.keys()) {
    if (!isBreakNode(k)) continue;
    for (const nk of adjMap.get(k)!) {
      if (!visitedEdges.has(edgeKeyOf(k, nk))) traceBranch(k, nk);
    }
  }
  for (const [ek] of edgeTraffic) {
    if (visitedEdges.has(ek)) continue;
    const [a, b] = ek.split('|') as [string, string];
    traceBranch(a, b);
  }
  for (const { pt, cell } of extraBoundaryAnchors) {
    if (distance(pt, cell) > 1e-4) trails.push({ points: [pt, { x: cell.x, y: cell.y }], width: trailWidth });
  }

  // Overlap trail mouths slightly inside each clearing rim so clearing fills seal cleanly over ends without gaps.
  const clipTrailAtClearings = (seg: TrailSegment): TrailSegment => {
    const pts = seg.points;
    if (pts.length < 2) return seg;
    const stepTrim = (seq: Point[]): Point[] => {
      let out = [...seq];
      for (const clear of clearings) {
        if (out.length < 2) break;
        if (!pointInPolygon(out[0]!, clear.rings)) continue;
        const outsideIdx = out.findIndex((p) => !pointInPolygon(p, clear.rings));
        if (outsideIdx < 0) continue;
        if (outsideIdx > 0) {
          const a = out[outsideIdx - 1]!, b = out[outsideIdx]!;
          let lo = 0, hi = 1;
          for (let iter = 0; iter < 10; iter++) {
            const mid = (lo + hi) / 2;
            const q = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
            if (pointInPolygon(q, clear.rings)) lo = mid; else hi = mid;
          }
          const rim = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
          const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          // Extend slightly inward toward clearing interior so clearing fill masks the seam cleanly.
          const insideShift = Math.min(segLen * lo, trailRadius * 0.85);
          const innerPt = { x: rim.x - ((b.x - a.x) / segLen) * insideShift, y: rim.y - ((b.y - a.y) / segLen) * insideShift };
          out = [pointInPolygon(innerPt, clear.rings) ? innerPt : rim, ...out.slice(outsideIdx)];
        }
      }
      return out;
    };
    const fromStart = stepTrim(pts);
    if (fromStart.length < 2) return seg;
    const trimmed = stepTrim([...fromStart].reverse()).reverse();
    return { points: trimmed.length >= 2 ? trimmed : pts, width: seg.width };
  };
  trails.splice(0, trails.length, ...trails.map(clipTrailAtClearings).filter((t) => t.points.length >= 2));

  const layout: Entity[] = clearings.map((c, i) => ({ ...base, id: `clearing-${i}`, type: 'area', role: 'land', name: `Clearing ${i + 1}`, rings: c.rings, fill: '#8ba561' }));
  if (params.preset === 'roadside' && entrances.length >= 2 && !paths.some(p => p.role === 'road')) {
    const roadPts = smoothCellChain(routeCells(entrances[0]!, entrances[1]!).map((c) => ({ x: c.x, y: c.y })));
    layout.push({ ...base, id: 'road-main', type: 'path', role: 'road', name: 'Country road', points: [entrancePoints[0]!, ...roadPts, entrancePoints[1]!], width: g * 2.1, closed: false });
  }

  let stream: Point[] = [];
  const streamWidth = g * 1.3;
  if (params.water && params.stream) {
    const waterCells = new Map(all.filter(c => clearings.every(clear => distance(c, clear.center) > clear.radius + streamWidth)).map(c => [c.key, c]));
    const west = [...waterCells.values()].sort((a, b) => a.x - b.x || Math.abs(a.y - (box.minY + box.maxY) / 2) - Math.abs(b.y - (box.minY + box.maxY) / 2))[0];
    if (!west) throw new Error('No room for a stream. Turn it off or reduce the clearing count.');
    const waterComponent = component(west, waterCells), choices = [...waterComponent.values()];
    const east = choices.reduce((a, b) => a.x > b.x ? a : b);
    if (east.x - west.x < (box.maxX - box.minX) * .6) throw new Error('No room for a stream crossing. Turn it off or reduce the clearing count.');
    // Prefer stream paths away from parallel trail segments so crossings occur cleanly perpendicularly.
    const trailBuffer = g * 2.4;
    const streamRoute = (): Point[] => {
      const distMap = new Map<string, number>([[west.key, 0]]);
      const prev = new Map<string, Cell | null>([[west.key, null]]);
      const queue: Array<{ cell: Cell; f: number }> = [{ cell: west, f: distance(west, east) }];
      while (queue.length) {
        queue.sort((a, b) => a.f - b.f);
        const { cell: c } = queue.shift()!;
        if (c.key === east.key) {
          const pts: Point[] = [];
          let cur: Cell | null = c;
          while (cur) { pts.push({ x: cur.x, y: cur.y }); cur = prev.get(cur.key)!; }
          pts.reverse();
          const simple = simplifyRDP(pts, g * 0.85);
          const sm = smoothChaikin(simple, 2);
          const ok = (line: Point[]) => line.slice(1).every((p, j) => {
            const a = line[j]!;
            const st = Math.max(1, Math.ceil(distance(a, p) / (g * 0.2)));
            return segmentFits(a, p) && Array.from({ length: st + 1 }, (_, k) => ({
              x: a.x + (p.x - a.x) * k / st,
              y: a.y + (p.y - a.y) * k / st,
            })).every((q) => clearings.every((cl) => distance(q, cl.center) > cl.radius + streamWidth / 2));
          });
          return ok(sm) ? sm : route(west, east, waterComponent, (p) => clearings.every((cl) => distance(p, cl.center) > cl.radius + streamWidth / 2));
        }
        const gCur = distMap.get(c.key)!;
        for (const n of neighbors(c, waterComponent)) {
          const nearTrail = trails.some((t) => lineDistance(n, t.points) < trailBuffer);
          const cost = distance(c, n) * (nearTrail ? 6.5 : 1) + (directionOrder.get(n.key) ?? 0) * 0.08 * g;
          const nextG = gCur + cost;
          if (nextG < (distMap.get(n.key) ?? Infinity)) {
            distMap.set(n.key, nextG);
            prev.set(n.key, c);
            queue.push({ cell: n, f: nextG + distance(n, east) });
          }
        }
      }
      return route(west, east, waterComponent, (p) => clearings.every((cl) => distance(p, cl.center) > cl.radius + streamWidth / 2));
    };
    stream = streamRoute();
    const westEdge = projectBoundary({ x: box.minX, y: west.y }), eastEdge = projectBoundary({ x: box.maxX, y: east.y });
    if (segmentFits(westEdge, west, streamWidth / 2, true)) stream.unshift(westEdge);
    if (segmentFits(east, eastEdge, streamWidth / 2, true)) stream.push(eastEdge);
    layout.push({ ...base, id: 'stream', name: 'Stream', type: 'path', role: 'river', points: stream, width: streamWidth, closed: false });
  }
  let pond: Point[][] | undefined;
  if (params.water && params.pond) {
    const pondRadius = g * 2.6;
    const options = all.filter(c => fits(c, pondRadius + g * .2)
      && clearings.every(clear => distance(c, clear.center) > clear.radius + pondRadius + g)
      && trails.every(t => lineDistance(c, t.points) > pondRadius + trailRadius + g)
      && paths.every(p => lineDistance(c, p.points) > pondRadius + p.width / 2 + g));
    const center = options[Math.floor(random() * options.length)];
    if (!center) throw new Error('No room for a pond beside the paths. Turn it off or enlarge the footprint.');
    pond = [smoothChaikin(Array.from({ length: 24 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2, r = pondRadius * (.78 + random() * .24);
      return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
    }), 2, true)];
    layout.push({ ...base, id: 'pond', name: 'Pond', type: 'area', role: 'water', rings: pond, fill: '#469caa' });
  }
  layout.push(...trails.filter(t => t.points.length > 1).map((t, i): Entity => ({ ...base, id: `trail-${i}`, type: 'path', role: 'trail', name: 'Woodland trail', points: t.points, width: t.width, closed: false })));

  // Cover every wet stretch of a trail, including a grazing crossing, with a themed bridge.
  const bridges: Entity[] = [];
  const bridgeTrails = [...trails, ...paths.filter(p => ['trail', 'road'].includes(p.role)).map(p => ({ points: p.points, width: p.width }))];
  if (stream.length) for (const { points: trail, width } of bridgeTrails) {
    let wet: Point[] = [];
    const flush = () => {
      if (wet.length < 2) { wet = []; return; }
      const a = wet[0]!, b = wet.at(-1)!, length = distance(a, b);
      const bend = Math.max(...wet.map(p => distanceToSegment(p, a, b)));
      const assets = themeAssets(input.theme, 'bridge'), asset = assets[Math.floor(random() * assets.length)]!;
      const crossingBuiltin = asset.startsWith('builtin:')
        ? (['bridge', 'fallenLog', 'steppingStones'][bridges.length % 3] ?? asset.slice(8))
        : undefined;
      bridges.push({ ...base, id: `bridge-${bridges.length}`, type: 'prop', name: 'Stream bridge', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        w: length + g * .8, h: Math.min(width * 1.4, width + bend * 1.4), rotation: Math.atan2(b.y - a.y, b.x - a.x), scale: 1, flipX: false,
        ...(crossingBuiltin ? { builtin: crossingBuiltin } : { assetId: asset }) });
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
          else if (distance(wet[0]!, p) > g * 7.5) { flush(); wet.push(previous); }
          wet.push(p);
        } else flush();
        previous = p;
      }
    }
    flush();
  }
  layout.push(...bridges);

  // A dense band follows the footprint and walkable edges, with organic grove clusters elsewhere.
  const edgeTreesEnabled = params.edgeTrees !== false;
  const groveTightness = params.groveTightness ?? 0.65;
  const extraRoads = layout.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road');
  const trees: Extract<Entity, { type: 'prop' }>[] = [], rocks: Entity[] = [], spacing = g * 1.55;
  for (let y = box.minY + spacing / 2; y < box.maxY; y += spacing) for (let x = box.minX + spacing / 2; x < box.maxX; x += spacing) {
    const p = { x: x + (random() - .5) * spacing * .65, y: y + (random() - .5) * spacing * .65 };
    const size = g * (1.25 + random() * .8), radius = size * Math.SQRT2 / 2;
    if (!fits(p, radius) || clearings.some(c => distance(p, c.center) < c.radius + radius)) continue;
    const trailDistance = Math.min(...trails.map(t => lineDistance(p, t.points)));
    if (trailDistance < trailRadius + radius || [...paths, ...extraRoads].some(t => lineDistance(p, t.points) < t.width / 2 + radius)) continue;
    const streamDist = stream.length ? lineDistance(p, stream) : Infinity;
    if (streamDist < streamWidth / 2 + radius) continue;
    if (pond && (pointInPolygon(p, pond) || ringDistance(p, pond) < radius)) continue;
    if (bridges.some(e => { const b = getEntityBounds(e)!; return p.x + radius > b.minX && p.x - radius < b.maxX && p.y + radius > b.minY && p.y - radius < b.maxY; })) continue;

    // Place mossy boulders near stream banks, pond edges, or occasional forest outcrops.
    const nearWater = (stream.length && streamDist < streamWidth / 2 + g * 1.9) || (pond && ringDistance(p, pond) < g * 1.8);
    if ((nearWater && random() < Math.min(0.45, 0.22 * params.density)) || (!nearWater && random() < Math.min(0.12, 0.05 * params.density))) {
      const rockSz = g * (0.55 + random() * 0.45);
      rocks.push({ ...base, id: `rock-${rocks.length}`, type: 'prop', name: 'Mossy boulder', ...p, w: rockSz, h: rockSz,
        rotation: random() * Math.PI * 2, scale: 1, flipX: random() < .5, builtin: 'rock', tacticalTag: 'cover' });
      continue;
    }

    const band = ringDistance(p, region) < g * 3.5 || trailDistance < trailRadius + g * 3.5 || clearings.some(c => distance(p, c.center) < c.radius + g * 3.5);
    const grove = 0.5 + 0.5 * Math.sin(p.x * 0.08 + input.seed) * Math.cos(p.y * 0.08 - input.seed * 0.7);
    const prob = band ? .82 : (.20 + grove * .52);
    if (random() > Math.min(.95, params.density * prob)) continue;
    const assets = themeAssets(input.theme, 'tree'), asset = assets[Math.floor(random() * assets.length)]!;
    trees.push({ ...base, id: `tree-${trees.length}`, type: 'prop', name: 'Tree', ...p, w: size, h: size, rotation: random() * Math.PI * 2, scale: 1, flipX: random() < .5,
      ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }) });
    // Add an occasional smaller sapling beside dense grove trees for natural thickets.
    if (!band && grove > (0.72 - groveTightness * 0.14) && random() < (0.28 + groveTightness * 0.25)) {
      const ang = random() * Math.PI * 2, reach = g * (0.78 - groveTightness * 0.22);
      const sp = { x: p.x + Math.cos(ang) * reach, y: p.y + Math.sin(ang) * reach };
      const subSz = size * 0.68, subR = subSz * Math.SQRT2 / 2;
      if (fits(sp, subR) && clearings.every(c => distance(sp, c.center) >= c.radius + subR)
        && trails.every(t => lineDistance(sp, t.points) >= trailRadius + subR)
        && (!stream.length || lineDistance(sp, stream) >= streamWidth / 2 + subR)
        && (!pond || (!pointInPolygon(sp, pond) && ringDistance(sp, pond) >= subR))) {
        trees.push({ ...base, id: `tree-${trees.length}`, type: 'prop', name: 'Tree', ...sp, w: subSz, h: subSz, rotation: random() * Math.PI * 2, scale: 1, flipX: random() < .5,
          ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }) });
      }
    }
  }
  // Perimeter framing edge trees + subtle grass-stripe contour tufts when density > 0.
  if (edgeTreesEnabled && params.density > 0) {
    const poly = region[0]!;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const len = distance(a, b);
      const steps = Math.max(1, Math.floor(len / (g * 2.1)));
      for (let s = 0; s < steps; s++) {
        if (random() > Math.min(0.85, 0.55 * params.density)) continue;
        const t = (s + 0.5) / steps;
        const ep = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const inset = g * 0.85;
        const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
        const candA = { x: ep.x + nx * inset, y: ep.y + ny * inset };
        const candB = { x: ep.x - nx * inset, y: ep.y - ny * inset };
        const p = pointInPolygon(candA, region) ? candA : pointInPolygon(candB, region) ? candB : null;
        if (!p) continue;
        const sz = g * (1.2 + random() * 0.5), rad = sz * 0.45;
        if (!fits(p, rad)) continue;
        if (entrancePoints.some(ePt => distance(p, ePt) < g * 2.6)) continue;
        if (clearings.some(c => distance(p, c.center) < c.radius + rad)) continue;
        if (trails.some(tr => lineDistance(p, tr.points) < trailRadius + rad + g * 0.5)) continue;
        if (stream.length && lineDistance(p, stream) < streamWidth + rad) continue;
        if (trees.some(tProp => distance(p, tProp) < g * 1.15)) continue;
        const assets = themeAssets(input.theme, 'tree'), asset = assets[Math.floor(random() * assets.length)]!;
        trees.push({ ...base, id: `edge-tree-${trees.length}`, type: 'prop', name: 'Tree', ...p, w: sz, h: sz, rotation: random() * Math.PI * 2, scale: 1, flipX: random() < .5,
          ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }) });
      }
    }
    for (const c of clearings) {
      const tuftCount = Math.min(3, Math.round(params.density * 2));
      for (let ti = 0; ti < tuftCount; ti++) {
        const ang = random() * Math.PI * 2;
        const tp = { x: c.center.x + Math.cos(ang) * c.radius * 0.72, y: c.center.y + Math.sin(ang) * c.radius * 0.72 };
        if (fits(tp, g * 0.35) && trails.every(tr => lineDistance(tp, tr.points) > trailRadius + g * 0.3)) {
          const tSz = g * (0.45 + random() * 0.25);
          rocks.push({ ...base, id: `tuft-${rocks.length}`, type: 'prop', name: 'Grass tuft', ...tp, w: tSz, h: tSz, rotation: (random() - 0.5) * 0.3, scale: 1, flipX: random() < 0.5, builtin: 'tuft' });
        }
      }
    }
  }
  // Place clearing landmarks & undergrowth (campfire + Waystone in clearing 1, outcrop + crates in clearing 2, standing stone in clearing 3).
  const lights: Entity[] = [];
  if (clearings.length && params.density > 0) {
    const c0 = clearings[0]!;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + random() * 0.4;
      const lp = { x: c0.center.x + Math.cos(ang) * (c0.radius * 0.56), y: c0.center.y + Math.sin(ang) * (c0.radius * 0.56) };
      const sz = g * 0.9;
      if (fits(lp, sz) && trails.every(t => lineDistance(lp, t.points) > trailRadius + sz)) {
        rocks.push({ ...base, id: `landmark-0`, type: 'prop', name: 'Waystone', ...lp, w: sz, h: sz, rotation: ang, scale: 1, flipX: false, builtin: 'altar' });
        const firePt = { x: c0.center.x - Math.cos(ang) * (c0.radius * 0.42), y: c0.center.y - Math.sin(ang) * (c0.radius * 0.42) };
        if (fits(firePt, g * 0.45) && trails.every(t => lineDistance(firePt, t.points) > trailRadius * 0.7 + g * 0.25)) {
          rocks.push({ ...base, id: 'landmark-0-fire', type: 'prop', name: 'Campfire', ...firePt, w: g * 0.65, h: g * 0.65, rotation: 0, scale: 1, flipX: false, builtin: 'campfire' });
          lights.push({ ...base, id: 'landmark-0-light', type: 'light', ...firePt, radius: g * 3.2, color: '#ff9e44' });
        }
        break;
      }
    }
    if (clearings.length > 1) {
      const c1 = clearings[1]!;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2 + random() * 0.5;
        const lp = { x: c1.center.x + Math.cos(ang) * (c1.radius * 0.56), y: c1.center.y + Math.sin(ang) * (c1.radius * 0.56) };
        const sz = g * 0.8;
        if (fits(lp, sz) && trails.every(t => lineDistance(lp, t.points) > trailRadius + sz)) {
          rocks.push({ ...base, id: `landmark-1-rock`, type: 'prop', name: 'Outcrop boulder', ...lp, w: sz, h: sz, rotation: ang, scale: 1, flipX: false, builtin: 'rock', tacticalTag: 'cover' });
          rocks.push({ ...base, id: `landmark-1-crate`, type: 'prop', name: 'Camp crate', x: lp.x + g * 0.6, y: lp.y + g * 0.25, w: g * 0.5, h: g * 0.5, rotation: ang + 0.4, scale: 1, flipX: false, builtin: 'crate', tacticalTag: 'cover' });
          rocks.push({ ...base, id: `landmark-1-barrel`, type: 'prop', name: 'Supply barrel', x: lp.x - g * 0.55, y: lp.y + g * 0.35, w: g * 0.45, h: g * 0.45, rotation: ang, scale: 1, flipX: false, builtin: 'barrel', tacticalTag: 'cover' });
          break;
        }
      }
    }
    // Add subtle undergrowth bushes near dense trees and pond edges.
    for (const t of trees) {
      if (random() > 0.24 * params.density) continue;
      const ang = random() * Math.PI * 2, bp = { x: t.x + Math.cos(ang) * g * 0.75, y: t.y + Math.sin(ang) * g * 0.75 };
      const bSz = g * (0.55 + random() * 0.35);
      if (fits(bp, bSz) && clearings.every(c => distance(bp, c.center) >= c.radius)
        && trails.every(tr => lineDistance(bp, tr.points) >= trailRadius + bSz * 0.6)
        && (!stream.length || lineDistance(bp, stream) >= streamWidth / 2 + bSz * 0.6)
        && (!pond || (!pointInPolygon(bp, pond) && ringDistance(bp, pond) >= bSz * 0.5))) {
        rocks.push({ ...base, id: `bush-${rocks.length}`, type: 'prop', name: 'Undergrowth', ...bp, w: bSz, h: bSz, rotation: random() * Math.PI * 2, scale: 1, flipX: false, builtin: 'bush', tacticalTag: 'concealment' });
      }
    }
    if (params.preset === 'roadside') {
      const road = layout.find((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road');
      if (road) {
        for (let i = 1; i < road.points.length; i += 2) {
          const a = road.points[i - 1]!, b = road.points[i]!;
          const len = distance(a, b) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          for (const side of [-1, 1]) {
            const hp = { x: mid.x + nx * side * (road.width / 2 + g * 0.7), y: mid.y + ny * side * (road.width / 2 + g * 0.7) };
            const hSz = g * (0.75 + random() * 0.25);
            if (fits(hp, hSz * 0.5) && trails.every(tr => lineDistance(hp, tr.points) >= trailRadius + hSz * 0.45)
              && (!stream.length || lineDistance(hp, stream) >= streamWidth / 2 + hSz * 0.5)) {
              rocks.push({ ...base, id: `hedge-${rocks.length}`, type: 'prop', name: 'Hedgerow', ...hp, w: hSz, h: hSz, rotation: Math.atan2(b.y - a.y, b.x - a.x), scale: 1, flipX: false, builtin: 'bush', tacticalTag: 'concealment' });
            }
          }
        }
      }
    } else if (params.preset === 'ruins') {
      for (const [ci, c] of clearings.slice(0, 3).entries()) {
        const ang = random() * Math.PI * 2, span = 0.55 + random() * 0.35;
        const pts = Array.from({ length: 4 }, (_, k) => {
          const a = ang + (k / 3 - 0.5) * span;
          return { x: c.center.x + Math.cos(a) * c.radius * 0.78, y: c.center.y + Math.sin(a) * c.radius * 0.78 };
        });
        if (pts.every(p => fits(p, g * 0.35) && trails.every(tr => lineDistance(p, tr.points) > trailRadius + g * 0.4))) {
          layout.push({ ...base, id: `ruin-wall-${ci}`, type: 'wall', name: 'Ruined wall', points: pts, blocksMove: true, blocksSight: true });
        }
      }
    }
  }
  // Fused dark-canopy mass behind dense tree groves (pure orthogonal grid contour trace + Chaikin smoothing; covers whole map with zero boolean risk).
  const canopyAreas: Entity[] = [];
  const ridgeAreas: Entity[] = [];
  if (params.density > 0) {
    const coreTrees = trees.filter((t) => !t.id.startsWith('edge-tree-'));
    if (coreTrees.length > 0) {
      const cellSize = Math.max(1, g * 1.25);
      const colsC = Math.ceil((box.maxX - box.minX) / cellSize);
      const rowsC = Math.ceil((box.maxY - box.minY) / cellSize);
      const occ = new Set<string>();
      const kC = (ix: number, iy: number) => `${ix},${iy}`;
      for (let iy = 0; iy < rowsC; iy++) {
        for (let ix = 0; ix < colsC; ix++) {
          const p = { x: box.minX + (ix + 0.5) * cellSize, y: box.minY + (iy + 0.5) * cellSize };
          if (!pointInPolygon(p, region)) continue;
          if (!coreTrees.some((t) => Math.abs(t.x - p.x) <= cellSize * 0.95 && Math.abs(t.y - p.y) <= cellSize * 0.95 && distance(t, p) <= cellSize * 1.0)) continue;
          if (clearings.some((cl) => distance(p, cl.center) <= cl.radius + cellSize * 0.42)) continue;
          if (trails.some((tr) => lineDistance(p, tr.points) <= trailRadius + cellSize * 0.45)) continue;
          if (stream.length && lineDistance(p, stream) <= streamWidth / 2 + cellSize * 0.45) continue;
          if (pond && (pointInPolygon(p, pond) || ringDistance(p, pond) <= cellSize * 0.45)) continue;
          occ.add(kC(ix, iy));
        }
      }
      // Trace boundary directed half-edges on occupied grid squares (turns clockwise around holes/islands).
      const edges = new Map<string, Point[]>();
      const ptK = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
      const pushEdge = (ax: number, ay: number, bx: number, by: number) => {
        const keyA = ptK(ax, ay);
        const list = edges.get(keyA) ?? [];
        list.push({ x: bx, y: by });
        edges.set(keyA, list);
      };
      for (const cellKey of occ) {
        const [ix, iy] = cellKey.split(',').map(Number) as [number, number];
        const x0 = box.minX + ix * cellSize, x1 = x0 + cellSize;
        const y0 = box.minY + iy * cellSize, y1 = y0 + cellSize;
        if (!occ.has(kC(ix, iy - 1))) pushEdge(x0, y0, x1, y0);
        if (!occ.has(kC(ix + 1, iy))) pushEdge(x1, y0, x1, y1);
        if (!occ.has(kC(ix, iy + 1))) pushEdge(x1, y1, x0, y1);
        if (!occ.has(kC(ix - 1, iy))) pushEdge(x0, y1, x0, y0);
      }
      const vertexPos = new Map<string, Point>();
      for (const cellKey of occ) {
        const [ix, iy] = cellKey.split(',').map(Number) as [number, number];
        const x0 = box.minX + ix * cellSize, x1 = x0 + cellSize;
        const y0 = box.minY + iy * cellSize, y1 = y0 + cellSize;
        for (const p of [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) vertexPos.set(ptK(p.x, p.y), p);
      }
      let ci = 0;
      while (edges.size > 0) {
        const startKey = edges.keys().next().value!;
        const startPt = vertexPos.get(startKey);
        if (!startPt) { edges.delete(startKey); continue; }
        const ring: Point[] = [startPt];
        let curKey = startKey;
        for (let guard = 0; guard < 2000; guard++) {
          const nextList = edges.get(curKey);
          if (!nextList || !nextList.length) { edges.delete(curKey); break; }
          const nxt = nextList.pop()!;
          if (!nextList.length) edges.delete(curKey);
          const nxtKey = ptK(nxt.x, nxt.y);
          if (nxtKey === startKey) break;
          ring.push(nxt);
          curKey = nxtKey;
        }
        if (ring.length < 4) continue;
        // Skip small hole loops by keeping positive/outer area or clipping safely; check >= 2 cells wide
        const signed = ring.reduce((s, p, i) => {
          const q = ring[(i + 1) % ring.length]!;
          return s + (p.x * q.y - q.x * p.y);
        }, 0) / 2;
        if (signed <= cellSize * cellSize * 1.5) continue;
        const rounded = smoothChaikin(ring, 2, true).map((pt) =>
          pointInPolygon(pt, region) ? pt : projectBoundary(pt),
        );
        canopyAreas.push({
          ...base,
          id: `canopy-${ci++}`,
          type: 'area',
          role: 'biome:dense-canopy',
          name: 'Forest Canopy',
          rings: [rounded],
          fill: '#1e3522',
        });
      }
    }

    // Place 1-2 elevated rock/earth tactical plateau ridges cleanly clear of paths and clearings.
    const ridgeOptions = all.filter((c) =>
      fits(c, g * 2.2)
      && clearings.every((cl) => distance(c, cl.center) > cl.radius + g * 2.6)
      && trails.every((tr) => lineDistance(c, tr.points) > trailRadius + g * 2.3)
      && (!stream.length || lineDistance(c, stream) > streamWidth / 2 + g * 2.3)
      && (!pond || (!pointInPolygon(c, pond) && ringDistance(c, pond) > g * 2.4)),
    );
    const chosenCenters: Point[] = [];
    for (let rAttempt = 0; rAttempt < 24 && ridgeAreas.length < 2 && ridgeOptions.length > 0; rAttempt++) {
      const center = ridgeOptions[Math.floor(random() * ridgeOptions.length)]!;
      if (chosenCenters.some((p) => distance(p, center) < g * 8)) continue;
      const rx = g * (1.4 + random() * 0.8), ry = g * (0.9 + random() * 0.5), ang = random() * Math.PI;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const rawRing = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const wob = 0.8 + random() * 0.35;
        const lx = Math.cos(a) * rx * wob, ly = Math.sin(a) * ry * wob;
        return { x: center.x + cos * lx - sin * ly, y: center.y + sin * lx + cos * ly };
      });
      const valid = rawRing.every((p) =>
        fits(p, g * 0.35)
        && clearings.every((cl) => distance(p, cl.center) > cl.radius + g * 0.5)
        && trails.every((tr) => lineDistance(p, tr.points) > trailRadius + g * 0.5)
        && (!stream.length || lineDistance(p, stream) > streamWidth / 2 + g * 0.5),
      );
      if (!valid) continue;
      chosenCenters.push(center);
      ridgeAreas.push({
        ...base,
        id: `ridge-${ridgeAreas.length}`,
        type: 'area',
        role: 'plateau',
        name: 'Rocky Ridge',
        rings: [smoothChaikin(rawRing, 1, true)],
        fill: '#6f7c52',
        elevation: 2,
      });
    }
  }
  return [...canopyAreas, ...ridgeAreas, ...layout, ...rocks, ...trees, ...lights, ...clearings.map((c, i): Entity => ({ ...base, id: `label-${i}`, type: 'label', name: `Clearing ${i + 1}`, text: String(i + 1), x: c.center.x, y: c.center.y, size: 18 }))];
}

registerGenerator({ type: 'glade', title: 'Outdoor woodland', params: OutdoorParamsSchema, generate: generateOutdoor });
