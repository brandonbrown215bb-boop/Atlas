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
