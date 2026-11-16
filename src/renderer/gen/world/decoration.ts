import { distanceToSegment, getEntityBounds } from '../../geom/hitTest';
import type { Entity, MapDoc, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { buildClimate } from './climate';
import { contains, type Terrain } from './terrain';

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
  const bounds = input.constraints.flatMap(e => {
    if (e.type === 'image') return [];
    if (e.type === 'area' && (e.role === 'land' || e.role.startsWith('biome:'))) return [];
    if (e.type === 'path' || e.type === 'wall' || e.type === 'place') return [];
    const b = getEntityBounds(e);
    return b ? [b] : [];
  });
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
      ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }),
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

  // Pick 3 spaced regional hubs from top-scoring locations.
  const hubs: Point[] = [];
  const hubCandidates = [...scoredHabitable].sort((a, b) => b.geoScore * (0.7 + random() * 0.6) - a.geoScore * (0.7 + random() * 0.6));
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

  const townNames = ['Alderford', 'Highwatch', 'Oakhaven', 'Ravenhold', 'Briarwood', 'Saltmere', 'Cinderfall', 'Westmarch'];
  for (const candidate of ranked) {
    if (result.length >= input.params.settlements) break;
    const isMajor = result.length < 2;
    const size = isMajor ? candidate.size * 1.45 : candidate.size;
    if (safe(candidate.point, size * 0.6, size * 0.6)) {
      const idx = result.length;
      const name = idx < townNames.length ? townNames[idx]! : `Settlement ${idx + 1}`;
      result.push(symbol('settlement', candidate.point, size, name, true));
    }
  }

  // Overland King's Roads connecting neighboring settlements across habitable terrain
  const settlementProps = result.filter(
    (e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'settlement',
  );
  if (settlementProps.length >= 2) {
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
    const routeOverland = (fromPt: Point, toPt: Point): Point[] | null => {
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
          const inConstraint = bounds.some((b) => nc.point.x >= b.minX && nc.point.x <= b.maxX && nc.point.y >= b.minY && nc.point.y <= b.maxY);
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

    const routedPairs = new Set<string>();
    const maxRouteSpan = terrain.size * 0.42;
    for (let i = 0; i < Math.min(8, settlementProps.length); i++) {
      const a = settlementProps[i]!;
      const neighbors = settlementProps
        .slice(0, 8)
        .filter((b, j) => j !== i && Math.hypot(a.x - b.x, a.y - b.y) < maxRouteSpan)
        .sort((u, v) => Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(v.x - a.x, v.y - a.y))
        .slice(0, 2);
      for (const b of neighbors) {
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (routedPairs.has(key)) continue;
        routedPairs.add(key);
        const pts = routeOverland(a, b);
        if (!pts || pts.length < 2) continue;
        const w = terrain.size * 0.0022;
        result.push({
          id: `king-road-${routedPairs.size}`,
          type: 'path',
          role: 'trail',
          routeTier: 'track',
          name: 'Trade Route',
          layerId: 'base',
          origin: 'generated',
          rev: 0,
          points: pts,
          width: w,
          closed: false,
        });
        for (let k = 1; k < pts.length; k++) {
          lines.push({ a: pts[k - 1]!, b: pts[k]!, width: w * 1.6 });
        }
      }
    }
  }

  if (!input.params.density) return result;

  const manualBiomes = input.constraints.filter(e => e.type === 'area' && e.role.startsWith('biome:'));
  const relief = terrain.cells.map(c =>
    c.neighbors.reduce((m, n) => Math.max(m, Math.abs(c.elevation - terrain.cells[n]!.elevation)), 0),
  );

  // Place highest mountain peaks first so ranges form spines with flanking foothills.
  const landCells = terrain.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.land)
    .sort((a, b) => b.c.elevation - a.c.elevation);

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
    const isMountain = height > 0.18 && (height > 0.21 || slope > 0.016);
    const nearMountain = result.some(e => e.type === 'prop' && e.symbolKind === 'mountain' && Math.hypot(c.point.x - e.x, c.point.y - e.y) < terrain.size * 0.08);
    const isHill = !isMountain && !isForest && ((height > 0.08 && nearMountain) || (height > 0.12 && slope > 0.015) || (isDesertBiome && height > 0.02));

    const role = isMountain ? 'mountain' : isForest ? 'forest' : isHill ? 'hill' : null;
    if (!role) continue;

    const chance = role === 'mountain'
      ? 0.36 * input.params.density
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

  // Seed landmark obstacle list with all settlement icons before placing any POIs or labels
  const landmarkIconBoxes: LabelBox[] = [
    compassKeepoutBox(0, 0, terrain.size, terrain.size),
    ...settlementProps.map((s) => propIconBox(s, terrain.size)),
  ];

  // Populate the remaining 5 POI families (strongholds, ruins, lairs, sacred sites, travel stops)
  const isRegion = input.mapKind === 'region';
  const poiSpecs: Array<{
    role: 'stronghold' | 'ruin' | 'lair' | 'sacred' | 'travel';
    category: string;
    names: string[];
    hook: string;
    gmOnly: boolean;
    count: number;
    score: (c: Terrain['cells'][number], i: number) => number;
  }> = [
    {
      role: 'stronghold', category: 'Stronghold',
      names: ['Blackspire Watch', 'Greywall Keep', 'Redoubt of the Ford', 'Stonehelm Tower'],
      hook: 'Fortified watchpost guarding nearby approaches.', gmOnly: false, count: isRegion ? 2 : 1,
      score: (c) => (c.elevation - input.params.seaLevel) * 2 + (lines.some(s => distanceToSegment(c.point, s.a, s.b) < riverDist * 1.5) ? 0.5 : 0),
    },
    {
      role: 'ruin', category: 'Ruin',
      names: ['Sunken Barrow', 'Old Ashford', 'Barrow of Kings', 'Abandoned Shafts'],
      hook: 'Ancient stonework and forgotten vaults beneath the turf.', gmOnly: true, count: isRegion ? 3 : 1,
      score: (c, i) => (c.elevation - input.params.seaLevel) + (1 - climate[i]!.moisture) * 0.4,
    },
    {
      role: 'lair', category: 'Lair',
      names: ['Wyrmtooth Cavern', 'Hollow Crag', 'Dusk Den', 'Mossjaw Cave'],
      hook: 'Dark cavern mouth used as a beast or monster lair.', gmOnly: true, count: isRegion ? 2 : 1,
      score: (c) => Math.max(0, c.elevation - input.params.seaLevel - 0.08) * 3,
    },
    {
      role: 'sacred', category: 'Sacred Site',
      names: ['Whispering Stones', 'St. Aldric Shrine', 'Moonwell Abbey', 'Oakheart Altar'],
      hook: 'Quiet sanctuary or standing stones revered by locals.', gmOnly: false, count: isRegion ? 2 : 1,
      score: (_c, i) => climate[i]!.moisture * 1.2,
    },
    {
      role: 'travel', category: 'Travel Stop',
      names: ['Crossroads Inn', 'Old Stone Bridge', 'Ferryman Landing', 'Timber Mill'],
      hook: 'Waystation, crossing, or working camp for travelers.', gmOnly: false, count: isRegion ? 3 : 1,
      score: (c) => (lines.some(s => distanceToSegment(c.point, s.a, s.b) < riverDist * 0.9) ? 2.5 : 0.2),
    },
  ];
  const minPoiGap = terrain.size * 0.085;
  const landOnly = terrain.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.land);
  const placedPois: Array<{ prop: Extract<Entity, { type: 'prop' }>; category: string; hook: string; gmOnly: boolean; role: string }> = [];
  for (const spec of poiSpecs) {
    const candidates = [...landOnly]
      .map(({ c, i }) => ({ c, weight: Math.max(0.05, spec.score(c, i)) * (0.6 + random() * 0.8) }))
      .sort((a, b) => b.weight - a.weight);
    let placed = 0;
    for (const cand of candidates) {
      if (placed >= spec.count) break;
      const size = terrain.size * (isRegion ? 0.018 : 0.011);
      if (!safe(cand.c.point, size * 0.9, size * 1.4)) continue;
      if (
        result.some(
          (e) =>
            e.type === 'prop' &&
            POI_SYMBOL_KINDS.has(e.symbolKind ?? '') &&
            Math.hypot(cand.c.point.x - e.x, cand.c.point.y - e.y) < minPoiGap,
        )
      ) {
        continue;
      }
      const name = spec.names[placed % spec.names.length]!;
      const prop: Extract<Entity, { type: 'prop' }> = {
        id: `${spec.role}-${placed}`,
        type: 'prop',
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        name,
        symbolKind: spec.role,
        builtin: spec.role,
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
      placedPois.push({ prop, category: spec.category, hook: spec.hook, gmOnly: spec.gmOnly, role: spec.role });
      placed++;
    }
  }

  // Place cartographic labels strictly clear of EVERY symbol icon, previous label, frame margin, and compass rose.
  const placedBoxes: LabelBox[] = [];
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
  const dangerBandFor = (pt: Point) => {
    if (!mainHub) return 'Borderland';
    const d = Math.hypot(pt.x - mainHub.x, pt.y - mainHub.y);
    return d < terrain.size * 0.2 ? 'Heartland (Low Risk)' : d < terrain.size * 0.45 ? 'Borderland (Patrolled Passes)' : 'Frontier Wilds (High Risk)';
  };
  const primaryDanger = placedPois.find((p) => p.role === 'ruin' || p.role === 'lair')?.prop;

  // Road-river crossing bridges & situational coastal lighthouse hooks (respecting manual constraints)
  const riverSegs = rivers.flatMap((e) =>
    e.type === 'path' ? e.points.slice(1).map((b, i) => ({ a: e.points[i]!, b })) : [],
  );
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
        const fordId = `ford-${fordCount++}`;
        result.push({
          id: fordId,
          type: 'prop',
          layerId: 'base',
          origin: 'generated',
          rev: 0,
          name: 'Stone River Bridge',
          builtin: 'bridge',
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
          name: `Stone Bridge Crossing ${fordCount}`,
          category: 'Travel Stop',
          notes: `${dangerBandFor(hit)} · Guarded stone bridge spanning the main trade road.`,
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
      const beacon: Extract<Entity, { type: 'prop' }> = {
        id: 'lighthouse-0',
        type: 'prop',
        layerId: 'base',
        origin: 'generated',
        rev: 0,
        name: 'Seaward Beacon',
        symbolKind: 'sacred',
        builtin: 'sacred',
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
        name: 'Seaward Beacon',
        category: 'Landmark',
        notes: `${dangerBandFor(beacon)} · High stone watch-fire warning ships off rocky shoals.`,
        gmNotes: '',
        entityIds: [beacon.id],
      });
    }
  }

  // Soft GM frontier sphere-of-influence outline around primary capital
  if (mainHub && settlementProps.length >= 3 && !bounds.length) {
    const rSphere = terrain.size * 0.14;
    const spherePts: Point[] = Array.from({ length: 18 }, (_, k) => {
      const a = (k / 18) * Math.PI * 2;
      const wob = rSphere * (0.86 + Math.sin(a * 3 + input.seed) * 0.12);
      return {
        x: Math.max(framePad, Math.min(terrain.size - framePad, mainHub.x + Math.cos(a) * wob)),
        y: Math.max(framePad, Math.min(terrain.size - framePad, mainHub.y + Math.sin(a) * wob)),
      };
    });
    result.push({
      id: 'frontier-realm-0',
      type: 'area',
      role: 'biome:frontier',
      name: `${mainHub.name ?? 'Capital'} Sphere`,
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: true,
      rings: [spherePts],
    });
  }

  settlementProps.forEach((s, idx) => {
    const entityIds = [s.id];
    if (idx < 5) {
      const sz = idx < 2 ? 20 : 16;
      const lbl = placeLabel(`label-settlement-${idx}`, s.name ?? `Settlement ${idx + 1}`, s.x, s.y, sz, Boolean(s.gmOnly), s);
      if (lbl) entityIds.push(lbl.id);
    }
    const nearHook = placedPois
      .map((p) => ({ name: p.prop.name, d: Math.hypot(p.prop.x - s.x, p.prop.y - s.y) }))
      .sort((a, b) => a.d - b.d)[0];
    const distMiles = nearHook ? Math.max(2, Math.round(nearHook.d / 1609.344)) : 18;
    const rumour = nearHook
      ? `Caravans say ${nearHook.name} lies roughly ${distMiles} miles out, though directions conflict.`
      : primaryDanger
        ? `Traders warn of old stonework near ${primaryDanger.name}.`
        : 'Passersby trade tall tales from distant passes.';
    result.push({
      id: `place-settlement-${idx}`,
      type: 'place',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: Boolean(s.gmOnly),
      name: s.name ?? `Settlement ${idx + 1}`,
      category: 'Settlement',
      notes: `${idx < 2 ? 'Major regional hub with trade and lodging.' : 'Local settlement.'} (${dangerBandFor(s)})`,
      gmNotes: '',
      rumours: [rumour],
      entityIds,
    });
  });

  placedPois.forEach((entry, idx) => {
    const { prop } = entry;
    const entityIds = [prop.id];
    const lbl = placeLabel(`label-${entry.role}-${idx}`, prop.name ?? entry.category, prop.x, prop.y, 14, entry.gmOnly, prop);
    if (lbl) entityIds.push(lbl.id);
    const nearestTown = settlementProps
      .map((s) => ({ name: s.name, d: Math.hypot(s.x - prop.x, s.y - prop.y) }))
      .sort((a, b) => a.d - b.d)[0];
    result.push({
      id: `place-${entry.role}-${idx}`,
      type: 'place',
      layerId: 'base',
      origin: 'generated',
      rev: 0,
      gmOnly: entry.gmOnly,
      name: prop.name ?? entry.category,
      category: entry.category,
      notes: `${dangerBandFor(prop)} · ${entry.hook}`,
      gmNotes: nearestTown ? `Nearest supply point: ${nearestTown.name}.` : '',
      entityIds,
    });
  });

  const mountains = result.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'mountain');
  if (mountains.length >= 3) {
    const m = mountains[Math.floor(mountains.length * 0.35)]!;
    placeLabel('label-mountains-0', 'Ironspine Peaks', m.x, m.y - terrain.size * 0.04, 21);
  }
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
    placeLabel('label-forest-0', 'Whispering Weald', primary.x, primary.y, 18);
    const secondary = rankedForests.find(
      (c) => c.density >= 5 && Math.hypot(c.f.x - primary.x, c.f.y - primary.y) >= terrain.size * 0.26,
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
      placeLabel('label-forest-1', 'Elderwood', secondary.f.x, secondary.f.y, 17);
    }
  }
  const oceanCells = terrain.cells.filter(
    (c) => !c.land && !c.lake && c.neighbors.every((n) => !terrain.cells[n]!.land) && !(c.point.x > terrain.size * 0.74 && c.point.y > terrain.size * 0.74),
  );
  if (oceanCells.length > 0) {
    const deep = oceanCells[Math.floor(oceanCells.length * 0.8)]!;
    placeLabel('label-ocean-0', 'THE AZURE DEEP', deep.point.x, deep.point.y, 24);
  }

  return result;
}
