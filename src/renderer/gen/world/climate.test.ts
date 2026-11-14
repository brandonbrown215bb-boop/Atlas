import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { ClimateSchema } from '../../model/schema';
import { toPolygons } from '../../geom/fog';
import { rectRing } from '../../geom/fog';
import { buildTerrain, TerrainParamsSchema } from './terrain';
import { buildClimate, climateAt } from './climate';
import { climateContext } from './context';
import { createWorldStore } from '../../model/store';

const bounds = { x: 0, y: 0, w: 1000000, h: 800000 };
const input = () => ({ seed: 9, params: TerrainParamsSchema.parse({ cells: 800 }), region: [rectRing(bounds)], constraints: [], theme: {}, grid: 100 });
it('classifies reproducible climate, honors manual biomes exactly and supports custom names', () => {
  const source = input(), terrain = buildTerrain(source);
  const biome = { id: 'manual', type: 'area' as const, role: 'biome:haunted', rings: [rectRing({ x: 350000, y: 250000, w: 200000, h: 200000 })], origin: 'manual' as const, layerId: 'base', rev: 1 };
  const climate = { bounds, transforms: [], settings: ClimateSchema.parse({ biomes: [{ name: 'crystal wastes', color: '#ac92cc' }] }) };
  const a = buildClimate(terrain, { ...source, constraints: [biome], climate });
  expect(a).toEqual(buildClimate(terrain, { ...source, constraints: [biome], climate }));
  expect(a.entities.length).toBeGreaterThan(0);
  for (const e of a.entities) {
    if (e.type !== 'area') throw new Error();
    expect(e.role).toBe('biome:crystal wastes');
    expect(clipping.intersection(toPolygons([e.rings]), toPolygons([biome.rings]))).toEqual([]);
  }
  const cold = climateAt({ x: 500000, y: 400000 }, .6, 1, { bounds, transforms: [], settings: ClimateSchema.parse({ temperature: -.8, moisture: -.8 }) });
  const hot = climateAt({ x: 500000, y: 400000 }, .6, 1, { bounds, transforms: [], settings: ClimateSchema.parse({ temperature: .8, moisture: .8 }) });
  expect(hot.temperature).toBeGreaterThan(cold.temperature);
  expect(hot.moisture).toBeGreaterThan(cold.moisture);
  expect(hot.rule.name).not.toBe(cold.rule.name);
});
it('uses parent-world latitude for child regions and persists climate through undo', () => {
  const store = createWorldStore();
  store.getState().loadWorld({ id: 'w', name: 'w', maps: [], themes: {}, formatVersion: 1 }, {});
  store.getState().execute('map.create', { id: 'world', name: 'World', kind: 'world', bounds });
  store.getState().execute('map.create', { id: 'region', name: 'Region', kind: 'region', parentId: 'world' });
  store.getState().execute('world.setClimate', { climate: { temperature: -.4 } });
  const world = store.getState().world!;
  expect(climateContext(world, world.maps.region!)).toMatchObject({ settings: { temperature: -.4 }, bounds, transforms: [{ x: 0, y: 0, rotation: 0 }] });
  const nested = climateAt({ x: 20, y: 30 }, .5, 4, { bounds, transforms: [{ x: 100, y: 200, rotation: Math.PI / 2 }] });
  expect(nested).toEqual(climateAt({ x: 70, y: 220 }, .5, 4, { bounds, transforms: [] }));
  store.getState().undo(); expect(store.getState().world!.meta.climate).toBeUndefined();
  store.getState().redo(); expect(ClimateSchema.parse(store.getState().world!.meta.climate).temperature).toBe(-.4);
});
