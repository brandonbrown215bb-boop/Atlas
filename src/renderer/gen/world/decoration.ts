import { distanceToSegment, getEntityBounds } from '../../geom/hitTest';
import type { Entity, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { buildClimate } from './climate';
import { contains, type Terrain } from './terrain';

type DecorationParams = { density: number; settlements: number; seaLevel: number };
type ClimateValues = ReturnType<typeof buildClimate>['values'];

/** Symbols use metres at continent scale. Seeded weighted sampling gives clusters and gaps. */
export function decorateWorld(terrain: Terrain, climate: ClimateValues, input: GeneratorInput<DecorationParams>, rivers: Entity[]): Entity[] {
  const random = mulberry32(input.seed ^ 0x651fea), result: Entity[] = [];
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
      symbolKind: role as 'mountain' | 'hill' | 'forest' | 'settlement',
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

  for (const candidate of ranked) {
    if (result.length >= input.params.settlements) break;
    const isMajor = result.length < 2;
    const size = isMajor ? candidate.size * 1.45 : candidate.size;
    if (safe(candidate.point, size * 0.6, size * 0.6)) {
      result.push(
        symbol('settlement', candidate.point, size, isMajor ? `Major Settlement ${result.length + 1}` : `Settlement suggestion ${result.length + 1}`, true),
      );
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
    const nearRiver = lines.some(s => distanceToSegment(c.point, s.a, s.b) < riverDist * 0.75);
    const isForest = isForestBiome || (nearRiver && climate[i]!.moisture > 0.34 && height < 0.16);
    const isMountain = height > 0.18 && (height > 0.21 || slope > 0.016);
    const nearMountain = result.some(e => e.type === 'prop' && e.symbolKind === 'mountain' && Math.hypot(c.point.x - e.x, c.point.y - e.y) < terrain.size * 0.08);
    const isHill = !isMountain && !isForest && ((height > 0.08 && nearMountain) || (height > 0.12 && slope > 0.015));

    const role = isMountain ? 'mountain' : isForest ? 'forest' : isHill ? 'hill' : null;
    if (!role) continue;

    const chance = role === 'mountain'
      ? 0.36 * input.params.density
      : role === 'forest'
        ? (0.09 + climate[i]!.moisture * 0.09) * input.params.density
        : (nearMountain ? 0.22 : 0.12) * input.params.density;
    if (random() > chance) continue;

    const size =
      terrain.size *
      (role === 'mountain'
        ? 0.032 + Math.min(0.020, Math.max(0, height - 0.18) * 0.10)
        : role === 'hill'
          ? 0.022
          : 0.020) *
      (0.8 + random() * 0.4);

    if (safe(c.point, size * 0.55, size * (role === 'hill' ? 0.38 : 0.30))) {
      result.push(symbol(role, c.point, size, { mountain: 'Mountain', forest: 'Forest', hill: 'Hills' }[role]));
      const extra = role === 'forest' ? (random() < 0.65 ? 2 : 1) : role === 'mountain' ? (random() < 0.55 ? 1 : 0) : random() < 0.65 ? 2 : 1;
      for (let k = 0; k < extra; k++) {
        const ang = random() * Math.PI * 2, dist = size * (0.56 + random() * 0.34);
        const subPt = { x: c.point.x + Math.cos(ang) * dist, y: c.point.y + Math.sin(ang) * dist };
        const subSize = size * (0.66 + random() * 0.22);
        if (safe(subPt, subSize * 0.55, subSize * 0.24)) {
          result.push(symbol(role, subPt, subSize, { mountain: 'Mountain', forest: 'Forest', hill: 'Hills' }[role]));
        }
      }
    }
  }

  // Add cartographic labels for major settlements, mountain ranges, forests, and oceans.
  const placeLabel = (id: string, text: string, x: number, y: number, size: number, gmOnly = false) => {
    const minSep = terrain.size * 0.09;
    if (result.some(e => e.type === 'label' && Math.hypot(e.x - x, e.y - y) < minSep)) return;
    result.push({ id, type: 'label', layerId: 'base', origin: 'generated', rev: 0, text, x, y, size, ...(gmOnly ? { gmOnly: true } : {}) });
  };
  const townNames = ['Alderford', 'Highwatch', 'Oakhaven', 'Ravenhold', 'Briarwood', 'Saltmere', 'Cinderfall', 'Westmarch'];
  const settlements = result.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'settlement');
  settlements.slice(0, 5).forEach((s, idx) => {
    const yOff = Math.max((s.h ?? terrain.size * 0.01) * 2.4, terrain.size * 0.024);
    placeLabel(`label-settlement-${idx}`, townNames[idx % townNames.length]!, s.x, s.y + yOff, idx < 2 ? 20 : 16, Boolean(s.gmOnly));
  });
  const mountains = result.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'mountain');
  if (mountains.length >= 3) {
    const m = mountains[Math.floor(mountains.length * 0.35)]!;
    placeLabel('label-mountains-0', 'Ironspine Peaks', m.x, m.y - terrain.size * 0.035, 22);
  }
  const forests = result.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'forest');
  if (forests.length >= 4) {
    const f = forests[Math.floor(forests.length * 0.25)]!;
    placeLabel('label-forest-0', 'Whispering Weald', f.x, f.y, 20);
    if (forests.length >= 12) {
      const f2 = forests[Math.floor(forests.length * 0.78)]!;
      placeLabel('label-forest-1', 'Elderwood', f2.x, f2.y, 19);
    }
  }
  const oceanCells = terrain.cells.filter(c => !c.land && !c.lake);
  if (oceanCells.length > 0) {
    const deep = oceanCells[Math.floor(oceanCells.length * 0.85)]!;
    placeLabel('label-ocean-0', 'THE AZURE DEEP', deep.point.x, deep.point.y, 26);
  }

  return result;
}
