import { bboxFromPoints, distanceToSegment, getEntityBounds } from '../../geom/hitTest';
import type { Entity, MapDoc, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import { propArt } from '../art';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { buildClimate } from './climate';
import { contains, type Terrain } from './terrain';
import { makeNamer } from './names';
import { BAND_NAMES, distance, makeHooks, SITE_SUMMARY, type Band, type SiteKind } from './hooks';

type LabelBox = { minX: number; maxX: number; minY: number; maxY: number };

function approxLabelBox(x: number, y: number, text: string, size: number, mapSpan: number): LabelBox {
  // Matches drawEntity render scaling (1 / (zoom * 1.35)) plus bold serif + halo padding.
  const h = Math.max(14, size) * (mapSpan / 1100);
  const w = Math.max(h * 1.6, text.length * h * 0.6);
  return {
    minX: x - w * 0.54,
    maxX: x + w * 0.54,
    minY: y - h * 0.55,
    maxY: y + h * 0.55,
  };
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function propIconBox(p: Extract<Entity, { type: 'prop' }>, span: number): LabelBox {
  const hw = Math.max((p.w ?? 0) * 0.54, span * 0.0075);
  const hh = Math.max((p.h ?? 0) * 0.54, span * 0.0075);
  return { minX: p.x - hw, maxX: p.x + hw, minY: p.y - hh, maxY: p.y + hh };
}

function compassKeepoutBox(minX: number, minY: number, w: number, h: number): LabelBox {
  const span = Math.max(w, h);
  return {
    minX: minX + w - span * 0.14,
    maxX: minX + w,
    minY: minY + h - span * 0.14,
    maxY: minY + h,
  };
}

const POI_SYMBOL_KINDS = new Set(['settlement', 'stronghold', 'ruin', 'lair', 'sacred', 'travel']);

/** De-collide all existing label entities on a map while keeping labels anchored close to their origin. */
export function rearrangeLabels(map: MapDoc): Record<string, Partial<Entity>> {
  const rawSpan = Math.max(1, Math.max(map.bounds.w, map.bounds.h));
  const labels = Object.values(map.entities)
    .filter((e): e is Extract<Entity, { type: 'label' }> => e.type === 'label')
    .sort((a, b) => b.size - a.size);
  const iconBoxes: LabelBox[] = [
    ...(map.kind === 'world' || map.kind === 'region'
      ? [compassKeepoutBox(map.bounds.x, map.bounds.y, map.bounds.w, map.bounds.h)]
      : []),
    ...Object.values(map.entities)
      .filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && POI_SYMBOL_KINDS.has(e.symbolKind ?? ''))
      .map((p) => propIconBox(p, rawSpan)),
  ];
  const pad = rawSpan * 0.02;
  const placed: LabelBox[] = [];
  const patches: Record<string, Partial<Entity>> = {};
  for (const lbl of labels) {
    const stepY = Math.max(2.6, rawSpan * 0.02);
    const stepX = Math.max(3.2, rawSpan * 0.032);
    const offsets: Array<[number, number]> = [
      [0, 0], [0, -stepY], [0, stepY], [stepX, 0], [-stepX, 0],
      [stepX * 0.85, -stepY * 0.95], [-stepX * 0.85, -stepY * 0.95],
      [stepX * 0.85, stepY * 0.95], [-stepX * 0.85, stepY * 0.95],
      [0, -stepY * 2], [0, stepY * 2], [stepX * 1.8, 0], [-stepX * 1.8, 0],
    ];
    let bestPt: Point = { x: lbl.x, y: lbl.y };
    for (const [ox, oy] of offsets) {
      const cx = lbl.x + ox;
      const cy = lbl.y + oy;
      const box = approxLabelBox(cx, cy, lbl.text, lbl.size, rawSpan);
      if (
        cx < map.bounds.x + pad || cx > map.bounds.x + map.bounds.w - pad ||
        cy < map.bounds.y + pad || cy > map.bounds.y + map.bounds.h - pad
      ) continue;
      if (!placed.some((p) => boxesOverlap(p, box)) && !iconBoxes.some((p) => boxesOverlap(p, box))) {
        bestPt = { x: cx, y: cy };
        break;
      }
    }
    placed.push(approxLabelBox(bestPt.x, bestPt.y, lbl.text, lbl.size, rawSpan));
    if (bestPt.x !== lbl.x || bestPt.y !== lbl.y) {
      patches[lbl.id] = { x: bestPt.x, y: bestPt.y };
    }
  }
  return patches;
}

type DecorationParams = { density: number; settlements: number; seaLevel: number; renderSeed?: number };
type ClimateValues = ReturnType<typeof buildClimate>['values'];

/** Symbols use metres at continent scale. Seeded weighted sampling gives clusters and gaps. */
export function decorateWorld(terrain: Terrain, climate: ClimateValues, input: GeneratorInput<DecorationParams>, rivers: Entity[]): Entity[] {
  const random = mulberry32((input.seed ^ 0x651fea ^ (((input.params.renderSeed ?? 0) * 2654435761) >>> 0)) >>> 0), result: Entity[] = [];
  // Names and GM hooks follow the world seed only, so a restyle keeps them.
  // Names already on the map (inherited from a world, or hand-placed) are never reused.
  // Names on this map or anywhere else in the world are taken; road names ("A–B Road") also carry town names.
  const takenNames = [...input.constraints.flatMap(e => (e.type === 'label' ? [e.text] : e.name ? [e.name] : [])), ...(input.takenNames ?? [])]
    .flatMap(n => [n, ...n.replace(/ (Road|Track)$/, '').split('–')]);
  const isRegion = input.mapKind === 'region';
  // A region salts its names so the same seed as its world doesn't replay the world's names.
  const namer = makeNamer(isRegion ? (input.seed ^ 0x5e1d) >>> 0 : input.seed, takenNames), hooks = makeHooks(mulberry32((input.seed ^ 0x9e3779b9) >>> 0));
  // A region that is mostly sea gets fewer towns and sites, so its land isn't crammed.
  const landShare = terrain.cells.filter(c => c.land).length / Math.max(1, terrain.cells.length);
  const crowd = isRegion ? Math.min(1, Math.max(0.25, landShare / 0.5)) : 1;
  const settlementTarget = Math.round(input.params.settlements * crowd);
  // Water needs no box: safe() and routing already test land, and an ocean's box would blank whole coasts.
  const boxes = (es: Entity[]) => es.flatMap(e => {
    if (e.type === 'image' || e.type === 'label') return [];
    if (e.type === 'area' && (e.role === 'land' || e.role === 'water' || e.role.startsWith('biome:'))) return [];
    if (e.type === 'path' || e.type === 'wall' || e.type === 'place') return [];
    const b = getEntityBounds(e);
    return b ? [b] : [];
  });
  const bounds = boxes(input.constraints);
  const routeBlocks = boxes(input.constraints.filter(e => e.type !== 'prop')); // roads may run up to existing icons
  // Existing towns, roads and adventure sites (inherited from the world, or hand-placed) are content to build around.
  const constraintProps = input.constraints.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop');
  const anchors = constraintProps.filter(e => e.symbolKind === 'settlement').sort((a, b) => (b.w ?? 0) - (a.w ?? 0));
  const majorSites = constraintProps.filter(e => ['ruin', 'lair', 'stronghold', 'sacred'].includes(e.symbolKind ?? ''));
  const existingRoads = input.constraints.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'trail');
  const lines = [...input.constraints, ...rivers].flatMap(e =>
    e.type === 'path' || e.type === 'wall'
      ? e.points.slice(1).map((b, i) => ({ a: e.points[i]!, b, width: e.type === 'path' ? e.width : 0 }))
      : [],
  );
  const safe = (p: Point, radius: number, propGap = radius) => {
    const samples = [p, ...[-1, 1].flatMap(x => [-1, 1].map(y => ({ x: p.x + x * radius, y: p.y + y * radius })))];
    return (
      samples.every(q => terrain.land.some(r => contains(r, q))) &&
      !bounds.some(b => p.x + radius > b.minX && p.x - radius < b.maxX && p.y + radius > b.minY && p.y - radius < b.maxY) &&
      !lines.some(s => distanceToSegment(p, s.a, s.b) < radius + s.width / 2) &&
      !result.some(e => e.type === 'prop' && Math.hypot(p.x - e.x, p.y - e.y) < propGap + Math.max(e.w!, e.h!) * 0.36)
    );
  };
  const symbol = (role: string, point: Point, size: number, name: string, suggestion = false): Entity => {
    const assets = themeAssets(input.theme, role), asset = assets[Math.floor(random() * assets.length)]!;
    return {
      id: `${role}-${result.length}`,
      type: 'prop',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      name,
      symbolKind: role as 'mountain' | 'hill' | 'forest' | 'settlement' | 'stronghold' | 'ruin' | 'lair' | 'sacred' | 'travel',
      ...point,
      w: size,
      h: size,
      scale: 1,
      rotation: 0,
      flipX: random() < 0.5,
      ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset, builtin: role }),
      ...(suggestion ? { suggestedSettlement: true, gmOnly: true } : {}),
    };
  };

  const riverDist = terrain.size * 0.025;
  const habitable = terrain.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => c.land && c.elevation < input.params.seaLevel + 0.28 && climate[i]!.temperature > 0.18 && climate[i]!.moisture > 0.15);

  // Score geographic suitability for settlements (estuaries, confluences, sheltered harbors, fertile valleys).
  const scoredHabitable = habitable.map(({ c, i }) => {
    const waterNeighbors = c.neighbors.filter(n => !terrain.cells[n]!.land).length;
    const coast = waterNeighbors > 0;
    const harbor = waterNeighbors >= 2 && waterNeighbors <= 4;
    let riverHits = 0;
    for (const s of lines) {
      if (distanceToSegment(c.point, s.a, s.b) < riverDist) riverHits++;
    }
    const nearRiver = riverHits > 0;
    const estuary = coast && nearRiver;
    const confluence = riverHits >= 3;
    const tempComfort = 1 - Math.min(1, Math.abs(climate[i]!.temperature - 0.55) * 2);
    const geoScore =
      0.2 +
      (estuary ? 3.2 : 0) +
      (confluence ? 2.2 : 0) +
      (harbor ? 1.5 : coast ? 0.9 : 0) +
      (nearRiver ? 1.1 : 0) +
      tempComfort * 0.7;
    return { c, i, coast, nearRiver, geoScore };
  });

  // Existing towns are the hubs villages gather around; otherwise pick 3 spaced hubs from top-scoring locations.
  const hubs: Point[] = anchors.slice(0, 3).map(a => ({ x: a.x, y: a.y }));
  const hubCandidates = hubs.length ? [] : [...scoredHabitable].sort((a, b) => b.geoScore * (0.7 + random() * 0.6) - a.geoScore * (0.7 + random() * 0.6));
  for (const cand of hubCandidates) {
    if (hubs.length >= 3) break;
    if (hubs.every(h => Math.hypot(h.x - cand.c.point.x, h.y - cand.c.point.y) > terrain.size * 0.16)) {
      hubs.push(cand.c.point);
    }
  }

  const ranked = scoredHabitable
    .map(({ c, i, geoScore }) => {
      const clustered = hubs.reduce(
        (sum, p) => sum + Math.exp(-Math.pow(Math.hypot(p.x - c.point.x, p.y - c.point.y) / (terrain.size * 0.12), 2)),
        0,
      );
      const weight = (geoScore + clustered * 3.2) * (0.3 + climate[i]!.moisture);
      return { point: c.point, score: -Math.log(Math.max(1e-10, random())) / weight, size: terrain.size * (0.007 + random() * 0.005) };
    })
    .sort((a, b) => a.score - b.score);

  for (const candidate of ranked) {
    if (result.length >= settlementTarget) break;
    const isMajor = result.length < 2 && !anchors.length;
    const size = isMajor ? candidate.size * 1.45 : candidate.size;
    if (safe(candidate.point, size * 0.6, size * 0.6)) {
      result.push(symbol('settlement', candidate.point, size, namer.town(), true));
    }
  }

  // Overland King's Roads connecting neighboring settlements across habitable terrain
  const settlementProps = [...anchors, ...result.filter(
    (e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'settlement',
  )];
  const nearestLandIdx = (pt: Point): number => {
    let best = -1;
    let bestD = Infinity;
    for (let idx = 0; idx < terrain.cells.length; idx++) {
      const c = terrain.cells[idx]!;
      if (!c.land) continue;
      const d = Math.hypot(c.point.x - pt.x, c.point.y - pt.y);
      if (d < bestD) { bestD = d; best = idx; }
    }
    return best;
  };
  const segOnLand = (a: Point, b: Point): boolean => {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(dist / (terrain.size * 0.015)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!terrain.land.some((r) => contains(r, p))) return false;
    }
    return true;
  };
  const peak = { cell: -1 }; // highest cell on the last routed path
  const routeOverland = (fromPt: Point, toPt: Point): Point[] | null => {
    peak.cell = -1;
    const start = nearestLandIdx(fromPt);
    const goal = nearestLandIdx(toPt);
    if (start < 0 || goal < 0 || start === goal) return null;
    const goalPt = terrain.cells[goal]!.point;
    const distMap = new Map<number, number>([[start, 0]]);
    const prev = new Map<number, number>();
    const queue: Array<{ idx: number; f: number }> = [{ idx: start, f: Math.hypot(terrain.cells[start]!.point.x - goalPt.x, terrain.cells[start]!.point.y - goalPt.y) }];
    let steps = 0;
    while (queue.length && steps++ < 4500) {
      queue.sort((a, b) => a.f - b.f);
      const cur = queue.shift()!;
      if (cur.idx === goal) break;
      const curCell = terrain.cells[cur.idx]!;
      const gCur = distMap.get(cur.idx)!;
      for (const n of curCell.neighbors) {
        const nc = terrain.cells[n]!;
        if (!nc.land || !segOnLand(curCell.point, nc.point)) continue;
        const inConstraint = routeBlocks.some((b) => nc.point.x >= b.minX && nc.point.x <= b.maxX && nc.point.y >= b.minY && nc.point.y <= b.maxY);
        if (inConstraint) continue;
        const segLen = Math.hypot(nc.point.x - curCell.point.x, nc.point.y - curCell.point.y);
        const climb = Math.max(0, nc.elevation - input.params.seaLevel - 0.18);
        const stepCost = segLen * (1 + climb * 14);
        const nextG = gCur + stepCost;
        if (nextG < (distMap.get(n) ?? Infinity)) {
          distMap.set(n, nextG);
          prev.set(n, cur.idx);
          const h = Math.hypot(nc.point.x - goalPt.x, nc.point.y - goalPt.y);
          queue.push({ idx: n, f: nextG + h });
        }
      }
    }
    if (!prev.has(goal)) return null;
    const pts: Point[] = [];
    let curr: number | undefined = goal;
    while (curr !== undefined) {
      pts.push(terrain.cells[curr]!.point);
      if (peak.cell < 0 || terrain.cells[curr]!.elevation > terrain.cells[peak.cell]!.elevation) peak.cell = curr;
      curr = prev.get(curr);
    }
    pts.reverse();
    if (pts.length < 3) return pts;
    // Corner-smooth once into graceful winding caravan curves without crossing bays or coves.
    const smooth: Point[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1]!, p1 = pts[i]!, p2 = pts[i + 1]!;
      const c1 = { x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 };
      const c2 = { x: p1.x * 0.75 + p2.x * 0.25, y: p1.y * 0.75 + p2.y * 0.25 };
      if (segOnLand(smooth[smooth.length - 1]!, c1) && segOnLand(c1, c2) && segOnLand(c2, p2)) {
        smooth.push(c1, c2);
      } else {
        smooth.push(p1);
      }
    }
    smooth.push(pts.at(-1)!);
    return smooth;
  };

  // Landmass ids so the road tree never tries to cross open sea.
  const landmass = new Int32Array(terrain.cells.length).fill(-1);
  terrain.cells.forEach((c, i) => {
    if (!c.land || landmass[i]! >= 0) return;
    const stack = [i];
    landmass[i] = i;
    while (stack.length) {
      for (const n of terrain.cells[stack.pop()!]!.neighbors) {
        if (terrain.cells[n]!.land && landmass[n]! < 0) { landmass[n] = i; stack.push(n); }
      }
    }
  });
  const massOf = (p: Point) => landmass[nearestLandIdx(p)] ?? -1;
  const passes: Point[] = [];
  let roadCount = 0;
  const addRoad = (from: Point, to: Point, name: string, tier: 'road' | 'track') => {
    const pts = routeOverland(from, to);
    if (!pts || pts.length < 2) return;
    const w = terrain.size * (tier === 'road' ? 0.003 : 0.0022);
    result.push({ id: `king-road-${++roadCount}`, type: 'path', role: 'trail', routeTier: tier, name, layerId: 'base', origin: 'generated', rev: 0, points: pts, width: w, closed: false });
    for (let k = 1; k < pts.length; k++) lines.push({ a: pts[k - 1]!, b: pts[k]!, width: w * 1.6 });
    if (peak.cell >= 0 && terrain.cells[peak.cell]!.elevation - input.params.seaLevel > 0.2) passes.push(terrain.cells[peak.cell]!.point);
  };

  // Spanning tree per landmass so every settlement is reachable, plus a couple of short loops.
  // Existing roads (sampled) and the towns on them start out connected, so new towns join that network.
  const netPts: Point[] = [];
  for (const p of existingRoads.flatMap(e => e.points)) {
    if (netPts.every(q => Math.hypot(p.x - q.x, p.y - q.y) > terrain.size * 0.02)) netPts.push(p);
  }
  const townCount = settlementProps.length, majors = anchors.length || 2;
  const node = (k: number): Point => (k < townCount ? settlementProps[k]! : netPts[k - townCount]!);
  const gap = (i: number, j: number) => Math.hypot(node(i).x - node(j).x, node(i).y - node(j).y);
  const masses = [...settlementProps, ...netPts].map(massOf);
  const seeded = (k: number) => netPts.length > 0 && (k < anchors.length || k >= townCount);
  const edges: Array<[number, number]> = [];
  const inTree = new Set(masses.map((_, k) => k).filter(seeded));
  const grow = () => {
    for (;;) {
      let best: [number, number] | null = null;
      for (const i of inTree) {
        for (let j = 0; j < townCount; j++) {
          if (!inTree.has(j) && masses[j] === masses[i] && (!best || gap(i, j) < gap(...best))) best = [i, j];
        }
      }
      if (!best) break;
      inTree.add(best[1]);
      edges.push(best);
    }
  };
  grow();
  for (let s = 0; s < townCount; s++) {
    if (!inTree.has(s)) { inTree.add(s); grow(); }
  }
  const linked = new Set(edges.map(([i, j]) => `${Math.min(i, j)}|${Math.max(i, j)}`));
  const loops = settlementProps.flatMap((_, i) => settlementProps.map((__, j) => [i, j] as [number, number]))
    .filter(([i, j]) => i < j && masses[i] === masses[j] && !linked.has(`${i}|${j}`) && !(seeded(i) && seeded(j)) && gap(i, j) < terrain.size * 0.25)
    .sort((a, b) => gap(...a) - gap(...b))
    .slice(0, 2);
  for (const [i, j] of [...edges, ...loops]) {
    const b = settlementProps[j]!;
    if (i >= townCount) { addRoad(netPts[i - townCount]!, b, `${b.name} Road`, 'track'); continue; }
    const a = settlementProps[i]!;
    addRoad(a, b, `${a.name}–${b.name} Road`, i < majors || j < majors ? 'road' : 'track');
  }

  if (!input.params.density) return result;

  // Seed landmark obstacle list with all settlement icons before placing any POIs or labels
  const landmarkIconBoxes: LabelBox[] = [
    compassKeepoutBox(0, 0, terrain.size, terrain.size),
    ...[...settlementProps, ...majorSites].map((s) => propIconBox(s, terrain.size)),
  ];

  // Travel-cost danger bands: multi-source Dijkstra from settlements across the terrain graph.
  // Roads run fast (0.45x), hills/forest/marsh drag (1.45x), steep mountains drag heavily (3.2x),
  // and unbridged river crossings add a fording delay.
  const roadPts = [...existingRoads, ...result].flatMap(e => (e.type === 'path' && e.role === 'trail' ? e.points : []));
  const riverSegs = rivers.flatMap((e) =>
    e.type === 'path' ? e.points.slice(1).map((b, i) => ({ a: e.points[i]!, b })) : [],
  );
  const nearest = (p: Point, pts: Point[]) => pts.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), Infinity);
  const segsCross = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
    const d1 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
    const d2 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
    const d3 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const d4 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const onRoadCell = new Uint8Array(terrain.cells.length);
  const roadSnap = terrain.size * 0.02;
  if (roadPts.length) {
    for (let i = 0; i < terrain.cells.length; i++) {
      const c = terrain.cells[i]!;
      if (!c.land) continue;
      for (const rp of roadPts) {
        if (Math.abs(c.point.x - rp.x) < roadSnap && Math.abs(c.point.y - rp.y) < roadSnap && Math.hypot(c.point.x - rp.x, c.point.y - rp.y) < roadSnap) {
          onRoadCell[i] = 1;
          break;
        }
      }
    }
  }
  const travelCost = new Float64Array(terrain.cells.length).fill(Infinity);
  if (settlementProps.length) {
    // Simple binary min-heap for fast multi-source Dijkstra over land cells.
    const heap: Array<{ i: number; d: number }> = [];
    const push = (i: number, d: number) => {
      heap.push({ i, d });
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p]!.d <= heap[k]!.d) break;
        [heap[p], heap[k]] = [heap[k]!, heap[p]!];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          let s = k;
          const l = k * 2 + 1, r = k * 2 + 2;
          if (l < heap.length && heap[l]!.d < heap[s]!.d) s = l;
          if (r < heap.length && heap[r]!.d < heap[s]!.d) s = r;
          if (s === k) break;
          [heap[k], heap[s]] = [heap[s]!, heap[k]!];
          k = s;
        }
      }
      return top;
    };
    for (const s of settlementProps) {
      const idx = nearestLandIdx(s);
      if (idx >= 0 && travelCost[idx]! > 0) {
        travelCost[idx] = 0;
        push(idx, 0);
      }
    }
    while (heap.length) {
      const cur = pop();
      if (cur.d > travelCost[cur.i]!) continue;
      const cell = terrain.cells[cur.i]!;
      for (const nb of cell.neighbors) {
        const nCell = terrain.cells[nb]!;
        if (!nCell.land) continue;
        const step = Math.hypot(nCell.point.x - cell.point.x, nCell.point.y - cell.point.y) / terrain.size;
        const roadEdge = onRoadCell[cur.i] === 1 && onRoadCell[nb] === 1;
        const height = Math.max(0, nCell.elevation - input.params.seaLevel);
        const bName = climate[nb]!.rule.name.toLowerCase();
        const terrainMult = roadEdge
          ? 0.45
          : height > 0.24
            ? 3.2
            : height > 0.12 || /forest|marsh|swamp|rainforest/.test(bName)
              ? 1.45
              : 1.0;
        let riverPenalty = 0;
        if (!roadEdge && riverSegs.length) {
          for (const rs of riverSegs) {
            if (segsCross(cell.point, nCell.point, rs.a, rs.b)) {
              riverPenalty = 0.04;
              break;
            }
          }
        }
        const nextD = cur.d + step * terrainMult + riverPenalty;
        if (nextD < travelCost[nb]!) {
          travelCost[nb] = nextD;
          push(nb, nextD);
        }
      }
    }
  }
  const bandOf = (p: Point): Band => {
    if (!settlementProps.length) return 1;
    // A settlement is judged by its nearest neighbour, so isolated villages read as frontier.
    if (settlementProps.some(s => s === p)) {
      const others = settlementProps.filter(s => s !== p);
      if (!others.length) return 2;
      const d = nearest(p, others) / terrain.size;
      return d < 0.07 ? 0 : d < 0.16 ? 1 : 2;
    }
    const idx = nearestLandIdx(p);
    const cost = idx >= 0 && Number.isFinite(travelCost[idx]!) ? travelCost[idx]! : nearest(p, settlementProps) / terrain.size;
    return cost < 0.09 ? 0 : cost < 0.20 ? 1 : 2;
  };
  const dangerBandFor = (p: Point) => BAND_NAMES[bandOf(p)];

  // Populate the 5 POI families (strongholds, ruins, lairs, sacred sites, travel stops)
  const siteTotal = Math.max(5, input.params.settlements);
  const countFor = (share: number, regionCount: number) => (isRegion ? Math.max(1, Math.round(regionCount * crowd)) : Math.max(1, Math.round(siteTotal * share)));
  const remote = (p: Point) => Math.min(2.5, Math.min(nearest(p, settlementProps), nearest(p, roadPts)) / (terrain.size * 0.12));
  // Outlying ruins, lairs and watchtowers gather on the approaches to an existing major site.
  const approach = (p: Point) => 1 + 1.5 * Math.exp(-((nearest(p, majorSites) / (terrain.size * 0.1)) ** 2));
  const poiSpecs: Array<{
    role: SiteKind;
    category: string;
    gmOnly: boolean;
    count: number;
    score: (c: Terrain['cells'][number], i: number) => number;
  }> = [
    {
      role: 'stronghold', category: 'Stronghold', gmOnly: false, count: countFor(0.2, 2),
      // Watchtowers favour high ground, rivers and above all mountain passes.
      score: (c) => (c.elevation - input.params.seaLevel) * 2 + (lines.some(s => distanceToSegment(c.point, s.a, s.b) < riverDist * 1.5) ? 0.5 : 0) + (nearest(c.point, passes) < terrain.size * 0.04 ? 3 : 0),
    },
    {
      role: 'ruin', category: 'Ruin', gmOnly: true, count: countFor(0.25, 3),
      score: (c, i) => ((c.elevation - input.params.seaLevel) + (1 - climate[i]!.moisture) * 0.4) * (0.3 + remote(c.point)),
    },
    {
      role: 'lair', category: 'Lair', gmOnly: true, count: countFor(0.25, 2),
      score: (c) => (0.15 + Math.max(0, c.elevation - input.params.seaLevel - 0.08) * 3) * (0.3 + remote(c.point)),
    },
    {
      role: 'sacred', category: 'Sacred Site', gmOnly: false, count: countFor(0.15, 2),
      score: (c, i) => climate[i]!.moisture * 1.2 * (0.6 + remote(c.point) * 0.4),
    },
    {
      role: 'travel', category: 'Travel Stop', gmOnly: false, count: countFor(0.15, 3),
      score: (c) => (nearest(c.point, roadPts) < riverDist ? 3 : lines.some(s => distanceToSegment(c.point, s.a, s.b) < riverDist * 0.9) ? 1 : 0.2),
    },
  ];
  const minPoiGap = terrain.size * 0.085;
  const landOnly = terrain.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.land);
  const placedPois: Array<{ prop: Extract<Entity, { type: 'prop' }>; category: string; gmOnly: boolean; role: SiteKind }> = [];
  for (const spec of poiSpecs) {
    const candidates = [...landOnly]
      .map(({ c, i }) => ({ c, weight: Math.max(0.05, spec.score(c, i)) * (spec.role === 'sacred' || spec.role === 'travel' ? 1 : approach(c.point)) * (0.6 + random() * 0.8) }))
      .sort((a, b) => b.weight - a.weight);
    let placed = 0;
    for (const cand of candidates) {
      if (placed >= spec.count) break;
      const size = terrain.size * (isRegion ? 0.018 : 0.011);
      const { x, y } = cand.c.point, edge = terrain.size * 0.04;
      if (x < edge || y < edge || x > terrain.size - edge || y > terrain.size - edge) continue;
      if (!safe(cand.c.point, size * 0.9, size * 1.4)) continue;
      if ([...result, ...constraintProps].some(e => e.type === 'prop' && POI_SYMBOL_KINDS.has(e.symbolKind ?? '') && Math.hypot(cand.c.point.x - e.x, cand.c.point.y - e.y) < minPoiGap)) continue;
      const prop: Extract<Entity, { type: 'prop' }> = {
        id: `${spec.role}-${placed}`,
        type: 'prop',
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        name: namer.site(spec.role),
        symbolKind: spec.role,
        ...propArt(input, [spec.role], `${spec.role}-${placed}`, spec.role),
        x: cand.c.point.x,
        y: cand.c.point.y,
        w: size,
        h: size,
        scale: 1,
        rotation: 0,
        flipX: false,
        ...(spec.gmOnly ? { gmOnly: true } : {}),
      };
      result.push(prop);
      landmarkIconBoxes.push(propIconBox(prop, terrain.size));
      placedPois.push({ prop, category: spec.category, gmOnly: spec.gmOnly, role: spec.role });
      placed++;
    }
  }

  // Waystations and forts sit on the network; ruins, lairs and shrines stay off-road on purpose.
  for (const { prop, role } of placedPois) {
    if (role !== 'travel' && role !== 'stronghold' || !roadPts.length) continue;
    const to = roadPts.reduce((m, q) => (Math.hypot(prop.x - q.x, prop.y - q.y) < Math.hypot(prop.x - m.x, prop.y - m.y) ? q : m));
    const d = Math.hypot(prop.x - to.x, prop.y - to.y);
    if (d > terrain.size * 0.012 && d < terrain.size * 0.2) addRoad(prop, to, `${prop.name} Track`, 'track');
  }

  const manualBiomes = input.constraints.filter(e => e.type === 'area' && e.role.startsWith('biome:'));
  const relief = terrain.cells.map(c =>
    c.neighbors.reduce((m, n) => Math.max(m, Math.abs(c.elevation - terrain.cells[n]!.elevation)), 0),
  );

  // Place highest mountain peaks first so ranges form spines with flanking foothills.
  const landCells = terrain.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.land)
    .sort((a, b) => b.c.elevation - a.c.elevation);
  // A region cut from a highland would otherwise be a blanket of peaks; only its top 30% can form ranges.
  const peakLine = Math.max(0.28, isRegion && landCells.length ? landCells[Math.floor(landCells.length * 0.3)]!.c.elevation - input.params.seaLevel : 0);

  for (const { c, i } of landCells) {
    const height = c.elevation - input.params.seaLevel;
    const slope = relief[i]!;
    const manual = manualBiomes.find(e => e.type === 'area' && contains(e.rings, c.point));
    const biome = manual?.type === 'area' ? manual.role.slice(6) : climate[i]!.rule.name;
    const isForestBiome = /forest|wood|jungle/i.test(biome);
    const isMarshBiome = /marsh|swamp|bog|fen|wetland/i.test(biome);
    const isDesertBiome = /desert|dune|arid|badlands/i.test(biome);
    const isPlainsBiome = /grass|savanna|steppe|plain|tundra/i.test(biome);
    const nearRiver = lines.some(s => distanceToSegment(c.point, s.a, s.b) < riverDist * 0.75);
    const isForest = isForestBiome || isMarshBiome || (nearRiver && climate[i]!.moisture > 0.34 && height < 0.16) || (isPlainsBiome && random() < 0.18);
    // Only true highlands become peaks, so ranges read as spines with valleys and passes between them.
    const isMountain = height > peakLine || (height > peakLine - 0.06 && slope > 0.022);
    const nearMountain = result.some(e => e.type === 'prop' && e.symbolKind === 'mountain' && Math.hypot(c.point.x - e.x, c.point.y - e.y) < terrain.size * 0.08);
    const isHill = !isMountain && !isForest && ((height > 0.08 && nearMountain) || (height > 0.12 && slope > 0.015) || (isDesertBiome && height > 0.02));

    const role = isMountain ? 'mountain' : isForest ? 'forest' : isHill ? 'hill' : null;
    if (!role) continue;

    const chance = role === 'mountain'
      ? 0.22 * input.params.density
      : role === 'forest'
        ? (isMarshBiome ? 0.11 : isPlainsBiome && !isForestBiome ? 0.045 : 0.09 + climate[i]!.moisture * 0.09) * input.params.density
        : (nearMountain ? 0.22 : isDesertBiome ? 0.06 : 0.12) * input.params.density;
    if (random() > chance) continue;

    const size =
      terrain.size *
      (role === 'mountain'
        ? 0.032 + Math.min(0.020, Math.max(0, height - 0.18) * 0.10)
        : role === 'hill'
          ? (isDesertBiome ? 0.017 : 0.022)
          : (isMarshBiome ? 0.016 : 0.020)) *
      (0.8 + random() * 0.4);

    const reliefName = role === 'mountain' ? 'Mountain' : role === 'forest' ? (isMarshBiome ? 'Marsh' : isPlainsBiome && !isForestBiome ? 'Copse' : 'Forest') : (isDesertBiome ? 'Dunes' : 'Hills');
    if (safe(c.point, size * 0.55, size * (role === 'hill' ? 0.38 : 0.30))) {
      result.push(symbol(role, c.point, size, reliefName));
      const extra = role === 'forest' ? (random() < 0.72 ? 3 : 2) : role === 'mountain' ? (random() < 0.55 ? 1 : 0) : random() < 0.65 ? 2 : 1;
      for (let k = 0; k < extra; k++) {
        const ang = random() * Math.PI * 2, dist = size * (role === 'forest' ? 0.42 + random() * 0.28 : 0.56 + random() * 0.34);
        const subPt = { x: c.point.x + Math.cos(ang) * dist, y: c.point.y + Math.sin(ang) * dist };
        const subSize = size * (0.68 + random() * 0.24);
        if (safe(subPt, subSize * 0.55, subSize * (role === 'forest' ? 0.18 : 0.24))) {
          result.push(symbol(role, subPt, subSize, reliefName));
        }
      }
    }
  }

  // Place cartographic labels strictly clear of EVERY symbol icon, previous label, frame margin, and compass rose.
  const oldLabels = input.constraints.filter((e): e is Extract<Entity, { type: 'label' }> => e.type === 'label');
  const placedBoxes: LabelBox[] = oldLabels.map(l => approxLabelBox(l.x, l.y, l.text, l.size, terrain.size));
  // Ranges and woods the world already named keep that name; don't add a second one beside it.
  const namedNearby = (p: Point) => oldLabels.some(l => l.size >= 17 && Math.hypot(l.x - p.x, l.y - p.y) < terrain.size * 0.15);
  const framePad = terrain.size * 0.028;
  const placeLabel = (
    id: string,
    text: string,
    anchorX: number,
    anchorY: number,
    size: number,
    gmOnly = false,
    clearIcon?: Extract<Entity, { type: 'prop' }>,
    customOffsets?: Array<[number, number]>,
  ) => {
    const sampleH = Math.max(14, size) * (terrain.size / 1100);
    const sampleW = Math.max(sampleH * 1.6, text.length * sampleH * 0.6);
    const dyClear = clearIcon ? Math.max((clearIcon.h ?? 0) * 0.54, terrain.size * 0.0075) + sampleH * 0.55 + terrain.size * 0.001 : 0;
    const dxTight = terrain.size * 0.006;
    const dxClear = clearIcon ? Math.max((clearIcon.w ?? 0) * 0.54, terrain.size * 0.0075) + sampleW * 0.54 + terrain.size * 0.001 : terrain.size * 0.025;
    const candidates: Array<[number, number]> = customOffsets ?? (clearIcon
      ? [
          [0, dyClear],
          [0, -dyClear],
          [dxTight, dyClear],
          [-dxTight, dyClear],
          [dxTight, -dyClear],
          [-dxTight, -dyClear],
          [dxClear, 0],
          [-dxClear, 0],
          [dxClear * 0.8, dyClear * 0.8],
          [-dxClear * 0.8, dyClear * 0.8],
          [0, dyClear * 1.5],
          [0, -dyClear * 1.5],
        ]
      : [
          [0, 0], [0, -sampleH * 1.5], [0, sampleH * 1.5],
          [terrain.size * 0.035, 0], [-terrain.size * 0.035, 0],
          [terrain.size * 0.035, -sampleH * 1.5], [-terrain.size * 0.035, -sampleH * 1.5],
          [terrain.size * 0.035, sampleH * 1.5], [-terrain.size * 0.035, sampleH * 1.5],
          [0, -sampleH * 2.8], [0, sampleH * 2.8],
        ]);
    for (const [ox, oy] of candidates) {
      const cx = anchorX + ox, cy = anchorY + oy;
      const box = approxLabelBox(cx, cy, text, size, terrain.size);
      if (
        box.minX < framePad || box.maxX > terrain.size - framePad ||
        box.minY < framePad || box.maxY > terrain.size - framePad
      ) continue;
      if (placedBoxes.some((b) => boxesOverlap(b, box)) || landmarkIconBoxes.some((b) => boxesOverlap(b, box))) {
        continue;
      }
      placedBoxes.push(box);
      const lbl: Entity = { id, type: 'label', layerId: 'base', origin: 'generated', rev: 0, text, x: cx, y: cy, size, ...(gmOnly ? { gmOnly: true } : {}) };
      result.push(lbl);
      return lbl;
    }
    return null;
  };

  const mainHub = settlementProps[0];

  // Road-river crossing bridges & situational coastal lighthouse hooks (respecting manual constraints)
  const tradePaths = result.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.id.startsWith('king-road-'));
  const manualSegs = input.constraints.flatMap((e) =>
    e.type === 'path' || e.type === 'wall'
      ? e.points.slice(1).map((b, i) => ({ a: e.points[i]!, b, width: e.type === 'path' ? e.width : 0 }))
      : [],
  );
  const segHit = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
    const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den;
    const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / den;
    if (t >= 0.05 && t <= 0.95 && u >= 0.05 && u <= 0.95) {
      return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
    }
    return null;
  };
  const safeCrossing = (pt: Point, sz: number) =>
    terrain.land.some((r) => contains(r, pt)) &&
    !bounds.some((b) => pt.x + sz > b.minX && pt.x - sz < b.maxX && pt.y + sz > b.minY && pt.y - sz < b.maxY) &&
    !manualSegs.some((s) => distanceToSegment(pt, s.a, s.b) < sz * 0.6 + s.width / 2) &&
    !result.some((e) => e.type === 'prop' && Math.hypot(pt.x - e.x, pt.y - e.y) < terrain.size * 0.055);
  let fordCount = 0;
  for (const road of tradePaths) {
    if (fordCount >= 2) break;
    for (let i = 1; i < road.points.length && fordCount < 2; i++) {
      for (const rs of riverSegs) {
        const hit = segHit(road.points[i - 1]!, road.points[i]!, rs.a, rs.b);
        if (!hit) continue;
        const sz = terrain.size * 0.0085;
        if (!safeCrossing(hit, sz)) continue;
        const ang = Math.atan2(road.points[i]!.y - road.points[i - 1]!.y, road.points[i]!.x - road.points[i - 1]!.x);
        const fordId = `ford-${fordCount++}`, bridgeName = namer.site('bridge');
        result.push({
          id: fordId,
          type: 'prop',
          layerId: 'base',
          origin: 'generated',
          rev: 0,
          name: bridgeName,
          ...propArt(input, ['atlasBridge'], fordId, 'bridge'),
          x: hit.x,
          y: hit.y,
          w: sz * 1.35,
          h: sz * 0.65,
          scale: 1,
          rotation: ang,
          flipX: false,
        });
        result.push({
          id: `place-${fordId}`,
          type: 'place',
          layerId: 'base',
          origin: 'generated',
          rev: 0,
          name: bridgeName,
          category: 'Travel Stop',
          notes: `${dangerBandFor(hit)} · Guarded stone bridge on the ${road.name ?? 'road'}.`,
          gmNotes: 'Toll house and ferryman gossip track passing caravans.',
          entityIds: [fordId],
        });
        break;
      }
    }
  }

  // Situational coastal cliff beacon / lighthouse overlooking sea lanes
  const cliffCape = landOnly
    .filter(({ c }) => c.neighbors.filter((n) => !terrain.cells[n]!.land && !terrain.cells[n]!.lake).length >= 2 && c.elevation > input.params.seaLevel + 0.04)
    .sort((a, b) => b.c.elevation - a.c.elevation)[0];
  if (cliffCape) {
    const lSize = terrain.size * 0.011;
    if (safe(cliffCape.c.point, lSize, lSize * 1.4) && !result.some((e) => e.type === 'prop' && POI_SYMBOL_KINDS.has(e.symbolKind ?? '') && Math.hypot(e.x - cliffCape.c.point.x, e.y - cliffCape.c.point.y) < minPoiGap)) {
      const beaconName = namer.site('beacon');
      const beacon: Extract<Entity, { type: 'prop' }> = {
        id: 'lighthouse-0',
        type: 'prop',
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        name: beaconName,
        symbolKind: 'sacred',
        ...propArt(input, ['lighthouse', 'sacred'], 'lighthouse-0', 'sacred'),
        x: cliffCape.c.point.x,
        y: cliffCape.c.point.y,
        w: lSize,
        h: lSize,
        scale: 1,
        rotation: 0,
        flipX: false,
      };
      result.push(beacon);
      landmarkIconBoxes.push(propIconBox(beacon, terrain.size));
      result.push({
        id: 'place-lighthouse-0',
        type: 'place',
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        name: beaconName,
        category: 'Landmark',
        notes: `${dangerBandFor(beacon)} · High stone watch-fire warning ships off rocky shoals.`,
        gmNotes: '',
        entityIds: [beacon.id],
      });
    }
  }

  // 1) Named Sub-Regions: flood-fill contiguous land biome clusters into up to 5 regions,
  // each with its own Regional Heart site and 6-entry encounter table (5 native + 1 neighbor spillover).
  const biomeFamilyOf = (i: number): string => {
    const c = terrain.cells[i]!;
    if (c.elevation - input.params.seaLevel > 0.24) return 'mountain';
    const b = climate[i]!.rule.name.toLowerCase();
    if (b.includes('rainforest')) return 'rainforest';
    if (b.includes('marsh') || b.includes('swamp') || b.includes('bog')) return 'marsh';
    if (b.includes('forest') || b.includes('wood')) return 'forest';
    if (b.includes('desert') || b.includes('arid')) return 'desert';
    if (b.includes('snow')) return 'snow';
    if (b.includes('tundra')) return 'tundra';
    return 'grassland';
  };
  const cellRegionIdx = new Int32Array(terrain.cells.length).fill(-1);
  interface SubRegion {
    id: number;
    name: string;
    biome: string;
    neighborBiome: string;
    cells: number[];
    center: Point;
    encounterTable: string[];
    heartName?: string;
  }
  const rawClusters: Array<{ biome: string; cells: number[]; neighborCounts: Map<string, number> }> = [];
  const visitedRegion = new Uint8Array(terrain.cells.length);
  for (let i = 0; i < terrain.cells.length; i++) {
    if (!terrain.cells[i]!.land || visitedRegion[i]) continue;
    const fam = biomeFamilyOf(i);
    const stack = [i];
    visitedRegion[i] = 1;
    const cells: number[] = [];
    const neighborCounts = new Map<string, number>();
    while (stack.length) {
      const cur = stack.pop()!;
      cells.push(cur);
      for (const nb of terrain.cells[cur]!.neighbors) {
        if (!terrain.cells[nb]!.land) continue;
        const nbFam = biomeFamilyOf(nb);
        if (nbFam === fam) {
          if (!visitedRegion[nb]) { visitedRegion[nb] = 1; stack.push(nb); }
        } else {
          neighborCounts.set(nbFam, (neighborCounts.get(nbFam) ?? 0) + 1);
        }
      }
    }
    rawClusters.push({ biome: fam, cells, neighborCounts });
  }
  const minRegionCells = Math.max(8, Math.floor(landOnly.length * 0.04));
  const subRegions: SubRegion[] = rawClusters
    .filter((cl) => cl.cells.length >= minRegionCells)
    .sort((a, b) => b.cells.length - a.cells.length)
    .slice(0, 5)
    .map((cl, idx) => {
      const cx = cl.cells.reduce((s, ci) => s + terrain.cells[ci]!.point.x, 0) / cl.cells.length;
      const cy = cl.cells.reduce((s, ci) => s + terrain.cells[ci]!.point.y, 0) / cl.cells.length;
      const bestCell = cl.cells.reduce((best, ci) => {
        const bp = terrain.cells[best]!.point, cp = terrain.cells[ci]!.point;
        return Math.hypot(cp.x - cx, cp.y - cy) < Math.hypot(bp.x - cx, bp.y - cy) ? ci : best;
      }, cl.cells[0]!);
      for (const ci of cl.cells) cellRegionIdx[ci] = idx;
      const neighborBiome = [...cl.neighborCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        ?? (cl.biome === 'grassland' ? 'forest' : 'grassland');
      return {
        id: idx,
        name: namer.region(cl.biome),
        biome: cl.biome,
        neighborBiome,
        cells: cl.cells,
        center: terrain.cells[bestCell]!.point,
        encounterTable: hooks.regionalEncounters(cl.biome, neighborBiome),
      };
    });
  const regionAt = (p: Point): SubRegion | undefined => {
    const idx = nearestLandIdx(p);
    if (idx < 0) return undefined;
    const rIdx = cellRegionIdx[idx]!;
    if (rIdx >= 0) return subRegions[rIdx];
    // Fall back to nearest named sub-region center if on a tiny coastal sliver.
    return subRegions.reduce<SubRegion | undefined>((best, r) =>
      !best || Math.hypot(r.center.x - p.x, r.center.y - p.y) < Math.hypot(best.center.x - p.x, best.center.y - p.y) ? r : best,
      undefined,
    );
  };

  // 2) 3–5 Overlapping Competing Regional Factions (biome:faction, gmOnly: true) replacing single capital sphere.
  const FACTION_TINTS = ['#8b3a3a', '#355c7d', '#4a6b48', '#7d5a35', '#6b456e'];
  interface FactionTerritory {
    id: string;
    name: string;
    anchor: Point;
    radius: number;
    fill: string;
    rings: Point[][];
  }
  const factions: FactionTerritory[] = [];
  if (settlementProps.length >= 2 && !bounds.length) {
    const anchorsForFactions: Point[] = [];
    for (const s of settlementProps) {
      if (anchorsForFactions.length >= 3) break;
      if (anchorsForFactions.every((a) => Math.hypot(a.x - s.x, a.y - s.y) > terrain.size * 0.14)) {
        anchorsForFactions.push({ x: s.x, y: s.y });
      }
    }
    const frontierSeeds = placedPois
      .filter((p) => p.role === 'stronghold' || p.role === 'ruin' || p.role === 'sacred')
      .map((p) => ({ x: p.prop.x, y: p.prop.y }));
    for (const fs of frontierSeeds) {
      if (anchorsForFactions.length >= 5) break;
      if (anchorsForFactions.every((a) => Math.hypot(a.x - fs.x, a.y - fs.y) > terrain.size * 0.12)) {
        anchorsForFactions.push(fs);
      }
    }
    // Guarantee at least 3 factions when enough settlements/POIs exist.
    for (const s of [...settlementProps, ...placedPois.map((p) => p.prop)]) {
      if (anchorsForFactions.length >= 3) break;
      if (anchorsForFactions.every((a) => Math.hypot(a.x - s.x, a.y - s.y) > terrain.size * 0.06)) {
        anchorsForFactions.push({ x: s.x, y: s.y });
      }
    }
    anchorsForFactions.slice(0, 5).forEach((anchor, fIdx) => {
      const fName = namer.faction();
      const fill = FACTION_TINTS[fIdx % FACTION_TINTS.length]!;
      const radius = terrain.size * (0.15 + (fIdx % 3) * 0.025);
      const pts: Point[] = Array.from({ length: 18 }, (_, k) => {
        const a = (k / 18) * Math.PI * 2;
        const wob = radius * (0.86 + Math.sin(a * 3 + input.seed + fIdx * 1.9) * 0.12);
        return {
          x: Math.max(framePad, Math.min(terrain.size - framePad, anchor.x + Math.cos(a) * wob)),
          y: Math.max(framePad, Math.min(terrain.size - framePad, anchor.y + Math.sin(a) * wob)),
        };
      });
      const id = `faction-territory-${fIdx}`;
      const ft: FactionTerritory = { id, name: fName, anchor, radius, fill, rings: [pts] };
      factions.push(ft);
      result.push({
        id,
        type: 'area',
        role: 'biome:faction',
        name: fName,
        fill,
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        gmOnly: true,
        rings: [pts],
      });
    });
  }
  const factionsCovering = (p: Point): string[] => {
    const hits = factions.filter((f) => contains(f.rings, p) || Math.hypot(p.x - f.anchor.x, p.y - f.anchor.y) <= f.radius * 0.85);
    if (!hits.length) return [];
    const contested = hits.length >= 2;
    return hits.map((f) => {
      const role = Math.hypot(p.x - f.anchor.x, p.y - f.anchor.y) < terrain.size * 0.03
        ? 'Seat of Power'
        : contested
          ? 'Contested Border'
          : 'Claimed Territory';
      return `${f.name} (${role})`;
    });
  };

  // 3) 1–2 Fantastical Geographic Anomalies (landmarks visible from leagues away; defy mundane geography)
  const anomalyEntries: Array<{ prop: Extract<Entity, { type: 'prop' }>; region?: SubRegion }> = [];
  const anomalyTarget = isRegion ? 1 : 2;
  const anomalyCandidates = [...landOnly]
    .map(({ c, i }) => ({
      c,
      weight: (0.4 + Math.abs(c.elevation - input.params.seaLevel - 0.15) * 2 + climate[i]!.moisture * 0.4) * (0.5 + remote(c.point) * 0.7) * (0.6 + random() * 0.8),
    }))
    .sort((a, b) => b.weight - a.weight);
  for (const cand of anomalyCandidates) {
    if (anomalyEntries.length >= anomalyTarget) break;
    const size = terrain.size * (isRegion ? 0.02 : 0.013);
    const { x, y } = cand.c.point, edge = terrain.size * 0.06;
    if (x < edge || y < edge || x > terrain.size - edge || y > terrain.size - edge) continue;
    if (!safe(cand.c.point, size * 0.9, size * 1.4)) continue;
    if ([...result, ...constraintProps].some(e => e.type === 'prop' && POI_SYMBOL_KINDS.has(e.symbolKind ?? '') && Math.hypot(cand.c.point.x - e.x, cand.c.point.y - e.y) < minPoiGap)) continue;
    const aId = `anomaly-${anomalyEntries.length}`;
    const aName = namer.anomaly();
    const aProp: Extract<Entity, { type: 'prop' }> = {
      id: aId,
      type: 'prop',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      name: aName,
      symbolKind: 'sacred',
      ...propArt(input, ['sacred'], aId, 'sacred'),
      x,
      y,
      w: size,
      h: size,
      scale: 1,
      rotation: 0,
      flipX: false,
    };
    result.push(aProp);
    landmarkIconBoxes.push(propIconBox(aProp, terrain.size));
    anomalyEntries.push({ prop: aProp, region: regionAt(cand.c.point) });
  }

  // Designate a Regional Heart site inside each named sub-region.
  const heartPropIds = new Set<string>();
  for (const reg of subRegions) {
    const inside = [
      ...anomalyEntries.filter((a) => a.region === reg).map((a) => ({ id: a.prop.id, name: a.prop.name!, prio: 4 })),
      ...placedPois
        .filter((p) => regionAt(p.prop) === reg)
        .map((p) => ({
          id: p.prop.id,
          name: p.prop.name!,
          prio: p.role === 'sacred' ? 3 : p.role === 'ruin' ? 2 : p.role === 'stronghold' ? 2 : 1,
        })),
    ].sort((a, b) => b.prio - a.prio);
    if (inside[0]) {
      reg.heartName = inside[0].name;
      heartPropIds.add(inside[0].id);
    }
  }

  // Identify 1 sealed endgame foreshadowing ruin near the primary starter hub (Ring-Map design).
  const endgamePropId = mainHub && settlementProps.length >= 3
    ? placedPois
        .filter((p) => p.role === 'ruin' || p.role === 'lair')
        .sort((a, b) => Math.hypot(a.prop.x - mainHub.x, a.prop.y - mainHub.y) - Math.hypot(b.prop.x - mainHub.x, b.prop.y - mainHub.y))[0]?.prop.id
    : undefined;

  // Existing major sites get no new marker, but clues and rumours lead to them.
  const leadSites = [...placedPois, ...majorSites.map(prop => ({ prop, category: '', gmOnly: true, role: prop.symbolKind as SiteKind }))];
  // Clue chains lead outward: each site points at the nearest site that is more remote than itself.
  const byRemoteness = [...leadSites].sort((a, b) => nearest(a.prop, settlementProps) - nearest(b.prop, settlementProps));
  const clueNext = new Map<string, (typeof placedPois)[number]>();
  byRemoteness.forEach((site, k) => {
    const next = byRemoteness.slice(k + 1).sort((a, b) => Math.hypot(a.prop.x - site.prop.x, a.prop.y - site.prop.y) - Math.hypot(b.prop.x - site.prop.x, b.prop.y - site.prop.y))[0];
    if (next && Math.hypot(next.prop.x - site.prop.x, next.prop.y - site.prop.y) < terrain.size * 0.3) clueNext.set(site.prop.id, next);
  });
  // Every ruin and lair gets at least two leads (clues plus town rumours); then each town gets two rumours.
  const rumoursAbout = settlementProps.map(() => [] as Array<(typeof placedPois)[number]>);
  // A town that already has a Place (adopted from the world, or written by hand) keeps it; it gets no second one.
  const placed = new Set(input.constraints.flatMap(e => (e.type === 'place' ? e.entityIds : [])));
  const byDistance = (p: Point) => settlementProps.map((s, i) => ({ i, d: Math.hypot(s.x - p.x, s.y - p.y) })).sort((a, b) => a.d - b.d);
  for (const site of leadSites) {
    if (site.role !== 'ruin' && site.role !== 'lair' && !majorSites.includes(site.prop)) continue;
    const leads = [...clueNext.entries()].filter(([from, n]) => n === site && placedPois.some(p => p.prop.id === from)).length;
    const hearers = byDistance(site.prop).filter(({ i }) => !placed.has(settlementProps[i]!.id));
    for (const { i } of hearers.slice(0, Math.max(0, 2 - leads))) rumoursAbout[i]!.push(site);
  }
  settlementProps.forEach((s, i) => {
    for (const site of [...leadSites].sort((a, b) => Math.hypot(a.prop.x - s.x, a.prop.y - s.y) - Math.hypot(b.prop.x - s.x, b.prop.y - s.y))) {
      if (rumoursAbout[i]!.length >= 2) break;
      if (!rumoursAbout[i]!.includes(site)) rumoursAbout[i]!.push(site);
    }
  });

  settlementProps.forEach((s, idx) => {
    if (placed.has(s.id)) return;
    const entityIds = [s.id];
    // Existing towns keep their label; new ones beside them rank below as villages and hamlets.
    const anchor = idx < anchors.length, rank = anchors.length ? idx - anchors.length + 5 : idx;
    const lbl = anchor ? null : placeLabel(`label-settlement-${idx}`, s.name ?? 'Settlement', s.x, s.y, rank < 2 ? 20 : rank < 5 ? 16 : 13, Boolean(s.gmOnly), s);
    if (lbl) entityIds.push(lbl.id);
    const fLinks = factionsCovering(s);
    const reg = regionAt(s);
    const hubTierNote = settlementProps.length >= 3
      ? (idx === 0
          ? 'Ring-Map Tier: Starter Hub (safe resupply, low-level leads nearby).'
          : idx < 3
            ? 'Ring-Map Tier: Mid-Tier Hub (borderland staging & faction politics).'
            : 'Ring-Map Tier: Frontier Outpost (scarce gear, deep-wilderness staging).')
      : '';
    const rivalryNote = fLinks.length >= 2 ? ` Contested: ${fLinks[0]!.replace(/ \(.+\)$/, '')} ${hooks.factionRivalry()}.` : '';
    result.push({
      id: `place-settlement-${idx}`,
      type: 'place',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: Boolean(s.gmOnly),
      name: s.name ?? 'Settlement',
      category: 'Settlement',
      discoveryTier: 'landmark',
      siteStatus: 'active',
      ...(reg ? { regionName: reg.name } : {}),
      ...(fLinks.length ? { factionLinks: fLinks } : {}),
      notes: hooks.settlement(anchor ? 'Town' : rank < 2 ? 'City' : rank < 5 ? 'Town' : rank < 8 ? 'Village' : 'Hamlet', bandOf(s)),
      gmNotes: `${hubTierNote}${rivalryNote}`.trim(),
      rumours: rumoursAbout[idx]!.map(site => hooks.rumour(site.role, site.prop.name!, s, site.prop)),
      entityIds,
    });
  });

  // Roads running off the map edge say where they lead, so the world feels bigger than the sheet.
  const box = bboxFromPoints(terrain.region[0]!)!, near = terrain.size * 0.01, here = new Set(anchors.map(a => a.name));
  const exits = new Set<string>();
  for (const road of existingRoads) {
    const ends = road.name?.match(/^(.+)–(.+) Road$/)?.slice(1) ?? [];
    const dest = ends.find(n => !here.has(n));
    if (!dest || exits.has(dest)) continue;
    for (const p of [road.points[0]!, road.points.at(-1)!]) {
      if (p.x - box.minX > near && box.maxX - p.x > near && p.y - box.minY > near && box.maxY - p.y > near) continue;
      // Step inward along the road so the label clears the frame.
      const toCentre = Math.hypot((box.minX + box.maxX) / 2 - p.x, (box.minY + box.maxY) / 2 - p.y) || 1;
      const inset = terrain.size * 0.07;
      const at = { x: p.x + ((box.minX + box.maxX) / 2 - p.x) / toCentre * inset, y: p.y + ((box.minY + box.maxY) / 2 - p.y) / toCentre * inset };
      if (placeLabel(`label-exit-${exits.size}`, `to ${dest}`, at.x, at.y, 11)) { exits.add(dest); break; }
    }
  }

  let rumorRingCount = 0;
  placedPois.forEach((entry, idx) => {
    const { prop } = entry;
    const entityIds = [prop.id];
    const lbl = placeLabel(`label-${entry.role}-${idx}`, prop.name ?? entry.category, prop.x, prop.y, 14, entry.gmOnly, prop);
    if (lbl) entityIds.push(lbl.id);
    const nearestTown = byDistance(prop)[0];
    const hook = hooks.site(entry.role, bandOf(prop));
    const next = clueNext.get(prop.id);
    const onRoad = nearest(prop, roadPts) < terrain.size * 0.025;
    const onRiver = riverSegs.some((s) => distanceToSegment(prop, s.a, s.b) < riverDist * 1.1);
    const routeTag = [onRoad ? '(on road)' : '', onRiver ? '(on river)' : ''].filter(Boolean).join(' ');
    const discoveryTier: 'landmark' | 'hidden' | 'secret' =
      entry.gmOnly ? (random() < 4 / 6 ? 'hidden' : 'secret') : 'landmark';
    const reg = regionAt(prop);
    const fLinks = factionsCovering(prop);
    const isHeart = heartPropIds.has(prop.id);
    const isEndgame = prop.id === endgamePropId;
    const extraGm = [
      nearestTown ? `Nearest supply point: ${settlementProps[nearestTown.i]!.name}.` : '',
      fLinks.length >= 2 ? `Contested border: ${fLinks[0]!.replace(/ \(.+\)$/, '')} ${hooks.factionRivalry()}.` : '',
      isEndgame && mainHub ? `Endgame Foreshadowing: Sealed high-threat vault visible early from ${mainHub.name}; requires keys or allies from deeper sites to break.` : '',
    ].filter(Boolean).join(' ');

    // Player-visible dashed Rumored Area ring offset around hidden/secret frontier sites (up to 4).
    if (entry.gmOnly && rumorRingCount < 4) {
      const rRing = terrain.size * (0.048 + random() * 0.02);
      const offAng = random() * Math.PI * 2;
      const offDist = rRing * (0.3 + random() * 0.35);
      const cx = Math.max(framePad + rRing * 0.5, Math.min(terrain.size - framePad - rRing * 0.5, prop.x + Math.cos(offAng) * offDist));
      const cy = Math.max(framePad + rRing * 0.5, Math.min(terrain.size - framePad - rRing * 0.5, prop.y + Math.sin(offAng) * offDist));
      const ringPts: Point[] = Array.from({ length: 16 }, (_, k) => {
        const a = (k / 16) * Math.PI * 2;
        const wob = rRing * (0.9 + Math.sin(a * 3 + input.seed + rumorRingCount) * 0.08);
        return {
          x: Math.max(framePad, Math.min(terrain.size - framePad, cx + Math.cos(a) * wob)),
          y: Math.max(framePad, Math.min(terrain.size - framePad, cy + Math.sin(a) * wob)),
        };
      });
      result.push({
        id: `rumor-ring-${rumorRingCount++}`,
        type: 'area',
        role: 'biome:rumor',
        name: `Rumored Area: ${prop.name ?? entry.category}`,
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        gmOnly: false,
        rings: [ringPts],
      });
    }

    result.push({
      id: `place-${entry.role}-${idx}`,
      type: 'place',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: entry.gmOnly,
      name: prop.name ?? entry.category,
      category: entry.category,
      discoveryTier,
      siteStatus: 'active',
      ...(reg ? { regionName: reg.name } : {}),
      ...(fLinks.length ? { factionLinks: fLinks } : {}),
      notes: `${dangerBandFor(prop)} · ${SITE_SUMMARY[entry.role]}${routeTag ? ` ${routeTag}` : ''}${isHeart && reg ? ` · Regional Heart of ${reg.name}` : ''}`,
      gmNotes: `${hook.gmNotes}${extraGm ? ` ${extraGm}` : ''}`,
      stockingRole: hook.stockingRole,
      ...(next ? { clueNext: `A clue here points toward ${next.prop.name}, ${distance(prop, next.prop)} away.` } : {}),
      entityIds,
    });
  });

  // Place records & labels for fantastical geographic anomalies.
  anomalyEntries.forEach(({ prop, region }, idx) => {
    const entityIds = [prop.id];
    const lbl = placeLabel(`label-anomaly-${idx}`, prop.name ?? 'Geographic Anomaly', prop.x, prop.y, 15, false, prop);
    if (lbl) entityIds.push(lbl.id);
    const hook = hooks.site('sacred', bandOf(prop));
    const fLinks = factionsCovering(prop);
    const isHeart = heartPropIds.has(prop.id);
    result.push({
      id: `place-anomaly-${idx}`,
      type: 'place',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: false,
      name: prop.name ?? 'Geographic Anomaly',
      category: 'Landmark',
      discoveryTier: 'landmark',
      siteStatus: 'active',
      ...(region ? { regionName: region.name } : {}),
      ...(fLinks.length ? { factionLinks: fLinks } : {}),
      notes: `${dangerBandFor(prop)} · Iconic fantastical landmark visible from leagues away.${isHeart && region ? ` · Regional Heart of ${region.name}` : ''}`,
      gmNotes: hook.gmNotes,
      stockingRole: hook.stockingRole,
      entityIds,
    });
  });

  // Name up to two ranges at their densest clusters, and the passes roads take through them.
  const mountains = result.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'mountain');
  const rangeR = terrain.size * 0.08;
  const ranges = mountains
    .map((m) => ({ m, members: mountains.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) <= rangeR) }))
    .sort((a, b) => b.members.length - a.members.length);
  const namedRanges: Point[] = [];
  for (const { m, members } of ranges) {
    if (namedRanges.length >= 2 || members.length < (namedRanges.length ? 5 : 3)) break;
    if (namedNearby(m) || namedRanges.some((p) => Math.hypot(p.x - m.x, p.y - m.y) < terrain.size * 0.3)) continue;
    namedRanges.push(m);
    const cx = members.reduce((t, o) => t + o.x, 0) / members.length, cy = members.reduce((t, o) => t + o.y, 0) / members.length;
    placeLabel(`label-mountains-${namedRanges.length - 1}`, namer.range(), cx, cy, 21);
  }
  passes
    .filter((p, k) => passes.findIndex((q) => Math.hypot(p.x - q.x, p.y - q.y) < terrain.size * 0.05) === k)
    .slice(0, 3)
    .forEach((p, k) => placeLabel(`label-pass-${k}`, namer.pass(), p.x, p.y, 12));
  const forests = result.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'forest');
  if (forests.length >= 4) {
    const clusterR = terrain.size * 0.065;
    const rankedForests = forests
      .map((f) => ({
        f,
        density: forests.filter((o) => Math.hypot(o.x - f.x, o.y - f.y) <= clusterR).length,
      }))
      .sort((a, b) => b.density - a.density);
    const primary = rankedForests[0]!.f;
    if (!namedNearby(primary)) placeLabel('label-forest-0', namer.wood(), primary.x, primary.y, 18);
    const secondary = rankedForests.find(
      (c) => c.density >= 5 && Math.hypot(c.f.x - primary.x, c.f.y - primary.y) >= terrain.size * 0.26 && !namedNearby(c.f),
    );
    if (secondary) {
      // Thicken any sparser named secondary woodland so it reads clearly as a true forest cluster.
      const needed = Math.max(0, 9 - secondary.density);
      for (let k = 0; k < needed; k++) {
        const ang = (k / Math.max(1, needed)) * Math.PI * 2 + random() * 0.5;
        const rad = terrain.size * (0.016 + random() * 0.025);
        const pt = { x: secondary.f.x + Math.cos(ang) * rad, y: secondary.f.y + Math.sin(ang) * rad };
        const sz = (secondary.f.w ?? terrain.size * 0.018) * (0.78 + random() * 0.3);
        if (safe(pt, sz * 0.45, sz * 0.16)) {
          result.push(symbol('forest', pt, sz, 'Forest'));
        }
      }
      placeLabel('label-forest-1', namer.wood(), secondary.f.x, secondary.f.y, 17);
    }
  }
  // Name the two longest rivers near their middle, so travellers have water to follow and cross.
  const riverLength = (pts: Point[]) => pts.slice(1).reduce((t, p, k) => t + Math.hypot(p.x - pts[k]!.x, p.y - pts[k]!.y), 0);
  // The name also goes on the generated path, so a region cut from this map knows the river is already named.
  const unnamedRiver = (e: Entity): e is Extract<Entity, { type: 'path' }> =>
    e.type === 'path' && e.role === 'river' && (!e.name || ['River', 'Navigable river', 'River · boundary outlet'].includes(e.name));
  [...rivers, ...input.constraints]
    .filter(unnamedRiver)
    .sort((a, b) => riverLength(b.points) - riverLength(a.points))
    .filter(e => riverLength(e.points) > terrain.size * 0.15)
    .slice(0, 2)
    .forEach((river, k) => {
      const mid = river.points[Math.floor(river.points.length / 2)]!, name = namer.river();
      if (placeLabel(`label-river-${k}`, name, mid.x, mid.y, 12) && rivers.includes(river)) river.name = name;
    });

  // Emit named sub-region italic labels & Region Place records with 6-entry spillover encounter tables.
  subRegions.forEach((reg, idx) => {
    const lbl = placeLabel(`label-subregion-${idx}`, reg.name, reg.center.x, reg.center.y, 15, false);
    result.push({
      id: `place-subregion-${idx}`,
      type: 'place',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: false,
      name: reg.name,
      category: 'Region',
      discoveryTier: 'landmark',
      regionName: reg.name,
      notes: `Named ${reg.biome} region bordering ${reg.neighborBiome} terrain.${reg.heartName ? ` Regional Heart: ${reg.heartName}.` : ''}`,
      gmNotes: `Regional 1d6 encounter table blends 5 ${reg.biome} entries with 1 ${reg.neighborBiome} border spillover.`,
      encounterTable: reg.encounterTable,
      entityIds: lbl ? [lbl.id] : [],
    });
  });

  // Sea label goes on the open-water cell farthest (in hops) from any coast, clear of the compass.
  const sea = (i: number) => !terrain.cells[i]!.land && !terrain.cells[i]!.lake;
  const hops = new Int32Array(terrain.cells.length).fill(-1);
  const frontier = terrain.cells.flatMap((c, i) => (sea(i) && c.neighbors.some((n) => terrain.cells[n]!.land) ? [i] : []));
  frontier.forEach((i) => { hops[i] = 0; });
  for (let k = 0; k < frontier.length; k++) {
    for (const n of terrain.cells[frontier[k]!]!.neighbors) {
      if (sea(n) && hops[n]! < 0) { hops[n] = hops[frontier[k]!]! + 1; frontier.push(n); }
    }
  }
  const inner = (v: number) => v > terrain.size * 0.12 && v < terrain.size * 0.88; // wide label must clear the frame
  const seaName = namer.sea();
  frontier
    .filter((i) => hops[i]! > 0 && inner(terrain.cells[i]!.point.x) && inner(terrain.cells[i]!.point.y))
    .sort((a, b) => hops[b]! - hops[a]!)
    .slice(0, 30)
    .some((i) => placeLabel('label-ocean-0', seaName, terrain.cells[i]!.point.x, terrain.cells[i]!.point.y, 24));

  return result;
}
