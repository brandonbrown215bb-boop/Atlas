import { simplifyRDP } from '../../geom/simplify';
import { tectonicField, type Plate } from './tectonics';
import { Delaunay } from 'd3-delaunay';
import { createNoise2D } from 'simplex-noise';
import clipping from '../../geom/polygonClipping';
import { z } from 'zod';
import { bboxFromPoints, pointInPolygon } from '../../geom/hitTest';
import { fromPolygons, toPolygons } from '../../geom/fog';
import type { Entity, Point } from '../../model/schema';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { smoothPolygons, traceCellBoundaries } from './boundaries';

export const TerrainParamsSchema = z.object({
  algorithmVersion: z.number().int().min(1).max(2).default(2),
  mode: z.enum(['new', 'populate']).default('new'),
  plateCount: z.number().int().min(3).max(40).default(12),
  cells: z.number().int().min(100).max(12000).default(8000),
  seaLevel: z.number().min(0.15).max(0.85).default(0.45),
  ruggedness: z.number().min(0).max(1).default(0.65),
});
export type TerrainParams = z.infer<typeof TerrainParamsSchema>;
export type Area = Extract<Entity, { type: 'area' }>;
export interface TerrainCell {
  point: Point;
  ring: Point[];
  neighbors: number[];
  elevation: number;
  land: boolean;
  lake?: boolean;
  plate?: number;
  downstream?: number;
}
export interface Terrain {
  cells: TerrainCell[];
  land: Point[][][];
  lakes?: Point[][][];
  region: Point[][];
  size: number;
  seaLevel?: number;
  plates?: Plate[];
}
export const contains = (rings: Point[][], p: Point) => pointInPolygon(p, rings);

function interpolateInheritedElevation(
  point: Point,
  inherited: Array<{ x: number; y: number; elevation: number; plate: number }>,
): { elevation: number; plate: number } {
  const k = Math.min(6, inherited.length);
  const best: Array<{ d2: number; elevation: number; plate: number }> = [];
  for (const c of inherited) {
    const dx = c.x - point.x, dy = c.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) return { elevation: c.elevation, plate: c.plate };
    if (best.length < k || d2 < best[best.length - 1]!.d2) {
      best.push({ d2, elevation: c.elevation, plate: c.plate });
      best.sort((a, b) => a.d2 - b.d2);
      if (best.length > k) best.pop();
    }
  }
  let wSum = 0, eSum = 0;
  for (const item of best) {
    const w = 1 / item.d2;
    wSum += w;
    eSum += w * item.elevation;
  }
  return { elevation: eSum / (wSum || 1), plate: best[0]!.plate };
}

function carveNaturalLakes(cells: TerrainCell[], seaLevel: number, isRegion: boolean): void {
  if (isRegion || cells.length < 250) return;
  const maxLakes = 3;
  const maxCellsPerLake = Math.max(4, Math.floor(cells.length * 0.006));
  const used = new Uint8Array(cells.length);
  // Find genuine inland basins well above sea level.
  const minima = cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) =>
      c.land &&
      c.elevation > seaLevel + 0.03 &&
      c.neighbors.every(n => cells[n]!.land && cells[n]!.elevation >= c.elevation),
    )
    .sort((a, b) => a.c.elevation - b.c.elevation);

  let lakeCount = 0;
  for (const { c: seedCell, i: seedIdx } of minima) {
    if (lakeCount >= maxLakes) break;
    if (used[seedIdx]) continue;
    const ceiling = seedCell.elevation + 0.016;
    const basin = [seedIdx];
    const inBasin = new Set([seedIdx]);
    let touchesOcean = false;
    for (let q = 0; q < basin.length && basin.length < maxCellsPerLake; q++) {
      const cur = basin[q]!;
      for (const n of cells[cur]!.neighbors) {
        if (inBasin.has(n)) continue;
        const nc = cells[n]!;
        if (!nc.land || used[n]) { touchesOcean = true; break; }
        if (nc.elevation <= ceiling) {
          inBasin.add(n);
          basin.push(n);
        }
      }
      if (touchesOcean) break;
    }
    if (touchesOcean || basin.length < 3) continue;
    // Verify the basin rim actually encloses it.
    const hasRim = basin.every(idx =>
      cells[idx]!.neighbors.every(n => inBasin.has(n) || (cells[n]!.land && cells[n]!.elevation > ceiling * 0.999)),
    );
    if (!hasRim) continue;
    for (const idx of basin) {
      used[idx] = 1;
      cells[idx]!.land = false;
      cells[idx]!.lake = true;
      cells[idx]!.elevation = seedCell.elevation;
    }
    lakeCount++;
  }
}

export function buildTerrain(input: GeneratorInput<TerrainParams>): Terrain {
  const b = bboxFromPoints(input.region[0]!)!;
  const w = b.maxX - b.minX, h = b.maxY - b.minY, size = Math.max(w, h);
  if (Math.min(w, h) <= 0 || size / Math.min(w, h) > 50) throw new Error('Choose a wider continent footprint.');
  const random = mulberry32(input.seed), noise = createNoise2D(mulberry32(input.seed ^ 0x291ac));
  const cols = Math.max(2, Math.round(Math.sqrt(input.params.cells * w / h)));
  const rows = Math.max(2, Math.round(input.params.cells / cols));
  const points: [number, number][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      points.push([(x + 0.15 + random() * 0.7) / cols * w / size, (y + 0.15 + random() * 0.7) / rows * h / size]);
    }
  }
  const delaunay = Delaunay.from(points), voronoi = delaunay.voronoi([0, 0, w / size, h / size]);
  const neighborLists = points.map((_, i) => [...voronoi.neighbors(i)]);

  const isRegion = input.mapKind === 'region';
  const inheritedCells = Object.entries(input.inheritedTerrain ?? {})
    .filter(([id]) => id.startsWith('inherited:'))
    .flatMap(([, m]) => m.cells);
  const useInherited = isRegion && inheritedCells.length >= 4;

  const effectivePlates = isRegion ? Math.min(input.params.plateCount, 3) : input.params.plateCount;
  const field = input.params.algorithmVersion === 1 || useInherited
    ? undefined
    : tectonicField(points, neighborLists, input.seed, effectivePlates, w / size, h / size, input.params.ruggedness);

  const overrides = input.constraints.filter((e): e is Area => e.type === 'area' && (e.role === 'land' || e.role === 'water' || e.role.startsWith('biome:')));
  const wet = overrides.flatMap(e => e.role === 'water' ? [e.rings] : e.rings.slice(1).map(r => [r]));
  const dry = overrides.filter(e => e.role !== 'water').map(e => e.rings);
  const samplingTolerance = size / Math.sqrt(input.params.cells) * 0.15;
  const sampler = (polygons: Point[][][]) => polygons.map(rings => ({
    bounds: bboxFromPoints(rings[0]!)!,
    rings: rings.map(r => { const simple = simplifyRDP(r, samplingTolerance, true); return simple.length >= 3 ? simple : r; }),
  }));
  const drySamples = sampler(dry), wetSamples = sampler(wet);
  const inside = (polygons: ReturnType<typeof sampler>, p: Point) =>
    polygons.some(({ bounds, rings }) => p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY && contains(rings, p));

  const cells: TerrainCell[] = points.map(([px, py], i) => {
    const x = px * size / w, y = py * size / h;
    const wx = x + noise(x * 2 + 31, y * 2) * 0.17, wy = y + noise(x * 2, y * 2 + 41) * 0.17;
    const ridged = 1 - Math.abs(noise(wx * 4.5 + 17, wy * 4.5 + 9));
    const noiseField = noise(wx * 2.2, wy * 2.2) * 0.20
      + noise(wx * 5.5, wy * 5.5) * 0.10
      + noise(wx * 12, wy * 12) * 0.05 * input.params.ruggedness
      + (ridged - 0.5) * 0.08 * input.params.ruggedness;

    const point = { x: b.minX + px * size, y: b.minY + py * size };
    let elevation: number;
    let plate: number | undefined = field?.owner[i];

    if (useInherited) {
      const parent = interpolateInheritedElevation(point, inheritedCells);
      elevation = parent.elevation + noise(wx * 4, wy * 4) * 0.045 + (ridged - 0.5) * 0.05 * input.params.ruggedness;
      plate = parent.plate;
    } else if (field) {
      const ex = x + noise(x * 2.4 + 5, y * 2.4) * 0.11;
      const ey = y + noise(x * 2.4, y * 2.4 + 19) * 0.11;
      const edge = Math.pow(Math.min(1.2, Math.max(Math.abs(ex * 2 - 1), Math.abs(ey * 2 - 1))), 2.6);
      const edgeDrop = isRegion ? edge * 0.03 : edge * 0.26;
      elevation = field.elevation[i]! + noiseField * 0.16 - edgeDrop;
    } else {
      const edge = Math.pow(Math.max(Math.abs(x * 2 - 1), Math.abs(y * 2 - 1)), 3);
      elevation = 0.65 + noiseField - edge * 0.65;
    }

    if (input.params.mode === 'populate' && !inside(drySamples, point)) elevation = Math.min(elevation, input.params.seaLevel - 0.05);
    if (inside(drySamples, point)) elevation = Math.max(elevation, input.params.seaLevel + 0.04);
    if (inside(wetSamples, point)) elevation = Math.min(elevation, input.params.seaLevel - 0.04);
    const ring = voronoi.cellPolygon(i)!.slice(0, -1).map(([vx, vy]) => ({ x: vx, y: vy }));
    return {
      point,
      ring,
      neighbors: neighborLists[i]!,
      plate,
      elevation,
      land: contains(input.region, point) && elevation > input.params.seaLevel,
    };
  });

  if (input.params.mode === 'new' && !wet.length) {
    carveNaturalLakes(cells, input.params.seaLevel, isRegion);
  }

  const traced = traceCellBoundaries(cells.map(c => c.ring), cells.map(c => c.land ? 'land' : null)).get('land') ?? [];
  const smoothed = smoothPolygons(traced, 2);
  const worldPolys = smoothed.map(poly => poly.map(r => r.map(p => ({ x: b.minX + p.x * size, y: b.minY + p.y * size }))));
  let land = worldPolys.length ? clipping.intersection(toPolygons(worldPolys), toPolygons([input.region])) : [];
  if (input.params.mode === 'populate') {
    if (!dry.length) throw new Error('Trace or draw land before populating geography.');
    land = clipping.intersection(
      clipping.union(...dry.map(r => toPolygons([r])) as [ReturnType<typeof toPolygons>, ...ReturnType<typeof toPolygons>[]]),
      toPolygons([input.region]),
    );
  } else if (dry.length) {
    land = clipping.intersection(clipping.union(land, ...dry.map(r => toPolygons([r]))), toPolygons([input.region]));
  }
  if (wet.length && land.length) land = clipping.difference(land, ...wet.map(r => toPolygons([r])));

  const tracedLakes = traceCellBoundaries(cells.map(c => c.ring), cells.map(c => c.lake ? 'lake' : null)).get('lake') ?? [];
  const lakePolys = smoothPolygons(tracedLakes, 2).map(poly => poly.map(r => r.map(p => ({ x: b.minX + p.x * size, y: b.minY + p.y * size }))));
  const lakes = lakePolys.length ? fromPolygons(clipping.intersection(toPolygons(lakePolys), toPolygons([input.region]))) : [];

  return { cells, land: fromPolygons(land), lakes, region: input.region, size, seaLevel: input.params.seaLevel, plates: field?.plates };
}

export function terrainEntities(terrain: Terrain): Entity[] {
  const base = { origin: 'generated' as const, rev: 0, layerId: 'base' };
  return [
    { ...base, id: 'ocean', type: 'area', role: 'water', waterKind: 'ocean', name: 'Ocean', rings: terrain.region, fill: '#244c67' },
    ...terrain.land.map((rings, i): Entity => ({ ...base, id: `land-${i}`, type: 'area', role: 'land', name: 'Land', rings, fill: '#9ba67b' })),
    ...(terrain.lakes ?? []).map((rings, i): Entity => ({ ...base, id: `lake-${i}`, type: 'area', role: 'water', waterKind: 'lake', name: 'Lake', rings, fill: '#2e5d7b' })),
  ];
}
