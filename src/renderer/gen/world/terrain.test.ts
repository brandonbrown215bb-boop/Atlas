import { expect, it } from 'vitest';
import { buildTerrain, TerrainParamsSchema, terrainEntities, contains } from './terrain';
import type { GeneratorInput } from '../framework';
import type { TerrainParams } from './terrain';

export function terrainInput(): GeneratorInput<TerrainParams> {
  return { seed: 9, params: TerrainParamsSchema.parse({ cells: 800 }), region: [[{ x: 0, y: 0 }, { x: 1000000, y: 0 }, { x: 1000000, y: 800000 }, { x: 0, y: 800000 }]],
    constraints: [], theme: {}, grid: 100 };
}
it('builds reproducible jittered terrain and closed coast polygons at world scale', () => {
  const input = terrainInput(), a = buildTerrain(input), b = buildTerrain(input);
  expect(a).toEqual(b);
  expect(a.land.length).toBeGreaterThan(0);
  expect(a.cells.some(c => c.land)).toBe(true);
  expect(a.cells.some(c => !c.land)).toBe(true);
  expect(terrainEntities(a)).not.toEqual(terrainEntities(buildTerrain({ ...input, seed: 10 })));
  for (const c of a.cells) expect(a.land.some(r => contains(r, c.point))).toBe(c.land);
});
it('preserves an exact manually carved lake, land overrides and footprint holes across seeds', () => {
  const input = terrainInput(), lake = [{ x: 400000, y: 300000 }, { x: 600000, y: 300000 }, { x: 600000, y: 500000 }, { x: 400000, y: 500000 }];
  input.constraints = [{ id: 'lake', type: 'area', role: 'water', rings: [lake], origin: 'manual', layerId: 'base', rev: 1 },
    { id: 'land', type: 'area', role: 'land', rings: input.region, origin: 'manual', layerId: 'base', rev: 1 }];
  for (const seed of [1, 5, 19]) {
    const terrain = buildTerrain({ ...input, seed });
    expect(terrain.land.some(r => contains(r, { x: 500000, y: 400000 }))).toBe(false);
    expect(terrain.land.some(r => contains(r, { x: 100, y: 100 }))).toBe(true);
    expect(terrain.land.some(r => r.length > 1)).toBe(true);
  }
  input.constraints = [];
  input.region.push(lake);
  expect(buildTerrain(input).land.some(r => contains(r, { x: 500000, y: 400000 }))).toBe(false);
});

it('population retains tectonic relief inside the exact authored coastline',()=>{
  const source=terrainInput();source.params.mode='populate';
  source.constraints=[{id:'land',type:'area',role:'land',origin:'manual',layerId:'base',rev:1,rings:source.region}];
  const t=buildTerrain(source),heights=t.cells.filter(c=>c.land).map(c=>c.elevation);
  expect(t.plates).toHaveLength(12);
  expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(.15);
  expect(new Set(t.cells.map(c=>c.plate)).size).toBeGreaterThan(3);
  expect(t.land).toEqual([source.region]);
});

it('interpolates parent elevation for inherited regions and uses broad geology for standalone regions', () => {
  const regionBounds = [{ x: 0, y: 0 }, { x: 160000, y: 0 }, { x: 160000, y: 160000 }, { x: 0, y: 160000 }];
  const standalone = buildTerrain({
    seed: 7,
    params: TerrainParamsSchema.parse({ cells: 600, plateCount: 12 }),
    region: [regionBounds],
    constraints: [],
    theme: {},
    grid: 100,
    mapKind: 'region',
  });
  expect(standalone.plates?.length).toBeLessThanOrEqual(3);

  const inheritedTerrain = {
    'inherited:world': {
      algorithmVersion: 2,
      seed: 1,
      bounds: { x: 0, y: 0, w: 160000, h: 160000 },
      plates: [],
      cells: [
        { x: 20000, y: 80000, elevation: 0.85, land: true, plate: 0 },
        { x: 20000, y: 20000, elevation: 0.85, land: true, plate: 0 },
        { x: 20000, y: 140000, elevation: 0.85, land: true, plate: 0 },
        { x: 140000, y: 80000, elevation: 0.48, land: true, plate: 1 },
        { x: 140000, y: 20000, elevation: 0.48, land: true, plate: 1 },
        { x: 140000, y: 140000, elevation: 0.48, land: true, plate: 1 },
      ],
    },
  };
  const inherited = buildTerrain({
    seed: 7,
    params: TerrainParamsSchema.parse({ cells: 600, mode: 'populate' }),
    region: [regionBounds],
    constraints: [{ id: 'land', type: 'area', role: 'land', origin: 'inherited', layerId: 'base', rev: 1, rings: [regionBounds] }],
    theme: {},
    grid: 100,
    mapKind: 'region',
    inheritedTerrain,
  });
  const west = inherited.cells.filter(c => c.point.x < 40000).map(c => c.elevation);
  const east = inherited.cells.filter(c => c.point.x > 120000).map(c => c.elevation);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  expect(avg(west)).toBeGreaterThan(avg(east) + 0.25);
});
