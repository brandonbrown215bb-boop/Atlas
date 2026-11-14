import { createNoise2D } from 'simplex-noise';
import clipping from 'polygon-clipping';
import { bboxFromPoints } from '../../geom/hitTest';
import { fromPolygons, toPolygons } from '../../geom/fog';
import { ClimateSchema, type Climate, type Entity, type Point } from '../../model/schema';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { traceCellBoundaries } from './boundaries';
import { contains, type Area, type Terrain } from './terrain';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function climateAt(point: Point, elevation: number, seed: number, context: GeneratorInput<unknown>['climate'],
  noise = createNoise2D(mulberry32(seed ^ 0x81b3)), settings?: Climate): { temperature: number; moisture: number; rule: Climate['biomes'][number] } {
  const climate = settings ?? ClimateSchema.parse(context?.settings ?? {});
  let p = point;
  for (const t of context?.transforms ?? []) p = { x: p.x * Math.cos(t.rotation) - p.y * Math.sin(t.rotation) + t.x,
    y: p.x * Math.sin(t.rotation) + p.y * Math.cos(t.rotation) + t.y };
  const b = context?.bounds ?? { x: 0, y: 0, w: 1000000, h: 1000000 };
  const x = (p.x - b.x) / b.w, y = (p.y - b.y) / b.h;
  const latitude = climate.northLatitude + y * (climate.southLatitude - climate.northLatitude);
  const temperature = clamp(1 - Math.abs(latitude) / 90 - Math.max(0, elevation - .45) * .75 + climate.temperature + noise(x * 3 + 12, y * 3) * .07);
  const moisture = clamp(.5 + noise(x * 3, y * 3 + 21) * .3 + noise(x * 8, y * 8) * .08 + climate.moisture);
  const rule = climate.biomes.find(r => temperature >= r.temperatureMin && temperature <= r.temperatureMax && moisture >= r.moistureMin && moisture <= r.moistureMax)
    ?? climate.biomes[climate.biomes.length - 1]!;
  return { temperature, moisture, rule };
}

export function buildClimate(terrain: Terrain, input: GeneratorInput<unknown>) {
  const noise = createNoise2D(mulberry32(input.seed ^ 0x81b3));
  const b = bboxFromPoints(terrain.region[0]!)!;
  const context = input.climate ?? { bounds: { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }, transforms: [] };
  const settings = ClimateSchema.parse(context.settings ?? {});
  const values = terrain.cells.map(c => climateAt(c.point, c.elevation, input.seed, context, noise, settings));
  const overrides = input.constraints.filter((e): e is Area => e.type === 'area' && e.role.startsWith('biome:'));
  const groups = terrain.cells.map((c, i) => c.land && !overrides.some(e => contains(e.rings, c.point)) ? values[i]!.rule.name : null);
  const traced = traceCellBoundaries(terrain.cells.map(c => c.ring), groups);
  const entities: Entity[] = [];
  for (const [name, polygons] of traced) {
    const worldPolys = polygons.map(poly => poly.map(r => r.map(p => ({ x: b.minX + p.x * terrain.size, y: b.minY + p.y * terrain.size }))));
    let clipped = clipping.intersection(toPolygons(worldPolys), toPolygons(terrain.land));
    if (overrides.length && clipped.length) clipped = clipping.difference(clipped, ...overrides.map(e => toPolygons([e.rings])));
    const color = values.find(v => v.rule.name === name)!.rule.color;
    for (const rings of fromPolygons(clipped)) entities.push({ id: `biome-${entities.length}`, type: 'area', role: `biome:${name}`,
      name, fill: color, rings, layerId: 'base', origin: 'generated', rev: 0 });
  }
  return { values, entities };
}
