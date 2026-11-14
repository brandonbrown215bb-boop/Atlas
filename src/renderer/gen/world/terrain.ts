import { Delaunay } from 'd3-delaunay';
import { createNoise2D } from 'simplex-noise';
import clipping from 'polygon-clipping';
import { z } from 'zod';
import { bboxFromPoints, pointInPolygon } from '../../geom/hitTest';
import { fromPolygons, toPolygons } from '../../geom/fog';
import type { Entity, Point } from '../../model/schema';
import { registerGenerator, type GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { traceCellBoundaries } from './boundaries';

export const TerrainParamsSchema = z.object({
  cells: z.number().int().min(100).max(12000).default(8000),
  seaLevel: z.number().min(.15).max(.85).default(.45),
  ruggedness: z.number().min(0).max(1).default(.65),
});
export type TerrainParams = z.infer<typeof TerrainParamsSchema>;
export type Area = Extract<Entity, { type: 'area' }>;
export interface TerrainCell {
  point: Point; ring: Point[]; neighbors: number[]; elevation: number; land: boolean;
}
export interface Terrain {
  cells: TerrainCell[];
  land: Point[][][];
  region: Point[][];
  size: number;
}
export const contains = (rings: Point[][], p: Point) => pointInPolygon(p, rings);

export function buildTerrain(input: GeneratorInput<TerrainParams>): Terrain {
  const b = bboxFromPoints(input.region[0]!)!;
  const w = b.maxX - b.minX, h = b.maxY - b.minY, size = Math.max(w, h);
  if (Math.min(w, h) <= 0 || size / Math.min(w, h) > 50) throw new Error('Choose a wider continent footprint.');
  const random = mulberry32(input.seed), noise = createNoise2D(mulberry32(input.seed ^ 0x291ac));
  const cols = Math.max(2, Math.round(Math.sqrt(input.params.cells * w / h)));
  const rows = Math.max(2, Math.round(input.params.cells / cols));
  const points: [number, number][] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    points.push([(x + .15 + random() * .7) / cols * w / size, (y + .15 + random() * .7) / rows * h / size]);
  }
  const delaunay = Delaunay.from(points), voronoi = delaunay.voronoi([0, 0, w / size, h / size]);
  const overrides = input.constraints.filter((e): e is Area => e.type === 'area' && (e.role === 'land' || e.role === 'water'));
  const wet = overrides.flatMap(e => e.role === 'water' ? [e.rings] : e.rings.slice(1).map(r => [r]));
  const dry = overrides.filter(e => e.role === 'land').map(e => e.rings);
  const cells: TerrainCell[] = points.map(([px, py], i) => {
    const x = px * size / w, y = py * size / h;
    const wx = x + noise(x * 2 + 31, y * 2) * .17, wy = y + noise(x * 2, y * 2 + 41) * .17;
    const field = noise(wx * 2.2, wy * 2.2) * .22 + noise(wx * 5.5, wy * 5.5) * .1
      + noise(wx * 12, wy * 12) * .05 * input.params.ruggedness;
    const edge = Math.pow(Math.max(Math.abs(x * 2 - 1), Math.abs(y * 2 - 1)), 3);
    let elevation = .65 + field - edge * .65;
    const point = { x: b.minX + px * size, y: b.minY + py * size };
    if (dry.some(r => contains(r, point))) elevation = Math.max(elevation, input.params.seaLevel + .04);
    if (wet.some(r => contains(r, point))) elevation = Math.min(elevation, input.params.seaLevel - .04);
    const ring = voronoi.cellPolygon(i)!.slice(0, -1).map(([vx, vy]) => ({ x: vx, y: vy }));
    return { point, ring, neighbors: [...voronoi.neighbors(i)], elevation,
      land: contains(input.region, point) && elevation > input.params.seaLevel };
  });
  const traced = traceCellBoundaries(cells.map(c => c.ring), cells.map(c => c.land ? 'land' : null)).get('land') ?? [];
  const worldPolys = traced.map(poly => poly.map(r => r.map(p => ({ x: b.minX + p.x * size, y: b.minY + p.y * size }))));
  let land = worldPolys.length ? clipping.intersection(toPolygons(worldPolys), toPolygons([input.region])) : [];
  if (dry.length) land = clipping.intersection(clipping.union(land, ...dry.map(r => toPolygons([r]))), toPolygons([input.region]));
  if (wet.length && land.length) land = clipping.difference(land, ...wet.map(r => toPolygons([r])));
  return { cells, land: fromPolygons(land), region: input.region, size };
}

export function terrainEntities(terrain: Terrain): Entity[] {
  const base = { origin: 'generated' as const, rev: 0, layerId: 'base' };
  return [
    { ...base, id: 'ocean', type: 'area', role: 'water', name: 'Ocean', rings: terrain.region, fill: '#244c67' },
    ...terrain.land.map((rings, i): Entity => ({ ...base, id: `land-${i}`, type: 'area', role: 'land', name: 'Land', rings, fill: '#9ba67b' })),
  ];
}

registerGenerator({ type: 'world', title: 'World / continent', params: TerrainParamsSchema,
  generate: input => terrainEntities(buildTerrain(input)) });
