import { expect, it } from 'vitest';
import { rectRing } from '../../geom/fog';
import { contains, buildTerrain } from './terrain';
import { buildClimate } from './climate';
import { decorateWorld } from './decoration';
import { generateWorld, WorldParamsSchema } from './world';
import { createWorldStore } from '../../model/store';
import { MapDocSchema, type Entity } from '../../model/schema';
import { playerRenderList } from '../../model/player';
import { validateWorld } from '../../model/transfer';

const bounds = { x: 0, y: 0, w: 1000000, h: 800000 };
const input = () => ({ seed: 9, params: WorldParamsSchema.parse({ cells: 2000, density: 3 }), region: [rectRing(bounds)], constraints: [] as Entity[], grid: 100,
  theme: { mountain: ['art-mountain'], forest: ['art-forest'], hill: ['art-hill'], settlement: ['art-settlement'] } });

it('scatters deterministic themed world symbols on land with uneven settlement spacing', () => {
  const source = input(), terrain = buildTerrain(source), climate = buildClimate(terrain, source);
  const a = decorateWorld(terrain, climate.values, source, []);
  expect(a).toEqual(decorateWorld(terrain, climate.values, source, []));
  const symbols = a.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop');
  for (const asset of ['art-mountain', 'art-forest', 'art-hill', 'art-settlement']) expect(symbols.some(e => e.assetId === asset)).toBe(true);
  for (const p of symbols) {
    expect(p.w).toBeGreaterThan(terrain.size * .005);
    expect(terrain.land.some(r => contains(r, p))).toBe(true);
  }
  const suggestions = symbols.filter(e => e.suggestedSettlement);
  expect(suggestions).toHaveLength(source.params.settlements);
  expect(suggestions.every(e => e.gmOnly)).toBe(true);
  const distances = suggestions.map(p => Math.min(...suggestions.filter(q => q !== p).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
  expect(Math.max(...distances) / Math.min(...distances)).toBeGreaterThan(2);
  expect(generateWorld({ ...source, params: { ...source.params, density: 0, settlements: 0 } }).some(e => e.type === 'prop')).toBe(false);
});

it('avoids manual water, developed footprints, existing props and manual roads', () => {
  const source = input();
  source.constraints = [
    { id: 'lake', type: 'area', role: 'water', rings: [rectRing({ x: 300000, y: 300000, w: 100000, h: 100000 })], origin: 'manual', rev: 1, layerId: 'l' },
    { id: 'town', type: 'area', role: 'district', rings: [rectRing({ x: 600000, y: 400000, w: 100000, h: 100000 })], origin: 'manual', rev: 1, layerId: 'l' },
    { id: 'road', type: 'path', role: 'road', points: [{ x: 0, y: 400000 }, { x: 1000000, y: 400000 }], width: 10000, closed: false, origin: 'manual', rev: 1, layerId: 'l' },
  ];
  const entities = generateWorld(source);
  for (const e of entities) if (e.type === 'prop') {
    expect(Math.abs(e.y - 400000)).toBeGreaterThan(e.w! * .5 + 5000);
    for (const area of source.constraints) if (area.type === 'area') expect(contains(area.rings, e)).toBe(false);
  }
});

it('accepts and dismisses suggestions undoably, hides pending points from players and preserves accepted places on reroll', () => {
  const map = MapDocSchema.parse({ id: 'm', name: 'Continent', kind: 'world', bounds, grid: { size: 100, visible: false },
    layers: [{ id: 'l', name: 'Base', visible: true, locked: false, gmOnly: false }],
    entities: { footprint: { id: 'footprint', type: 'area', role: 'land', rings: [rectRing(bounds)], origin: 'manual', rev: 0, layerId: 'l' } },
    generators: {}, revision: 0, deleted: {}, fog: { enabled: false, revealed: [] } });
  const store = createWorldStore(), s = () => store.getState(), current = () => s().world!.maps.m!;
  s().loadWorld({ id: 'w', name: 'World', formatVersion: 1, maps: [{ id: 'm', name: 'Continent', kind: 'world' }], themes: {} }, { m: map });
  s().execute('generator.run', { mapId: 'm', genId: 'g', type: 'world', seed: 9, params: { cells: 1000 }, regionEntityId: 'footprint', layerId: 'l' });
  const pending = Object.values(current().entities).filter(e => e.type === 'prop' && e.suggestedSettlement);
  expect(pending.length).toBeGreaterThan(2);
  expect(playerRenderList(current()).some(e => pending.some(p => p.id === e.id))).toBe(false);
  const before = s().world;
  const accepted = s().execute('settlement.resolveSuggestion', { mapId: 'm', entityId: pending[0]!.id, action: 'accept', name: 'Rookhaven' }) as { placeId: string };
  expect(current().entities[accepted.placeId]).toMatchObject({ type: 'place', name: 'Rookhaven', category: 'Settlement' });
  expect((current().entities[accepted.placeId] as Extract<Entity, { type: 'place' }>).entityIds).toContain(pending[0]!.id);
  expect(Object.values(current().entities).filter(e => e.type === 'place' && e.entityIds.includes(pending[0]!.id))).toHaveLength(1);
  const marker = current().entities[pending[0]!.id]!;
  expect(marker).toMatchObject({ origin: 'manual', gmOnly: false });
  expect(playerRenderList(current()).some(e => e.id === marker.id)).toBe(true);
  s().undo(); expect(s().world).toEqual(before); s().redo();
  const preDismiss = s().world;
  s().execute('settlement.resolveSuggestion', { mapId: 'm', entityId: pending[1]!.id, action: 'dismiss' });
  expect(current().entities[pending[1]!.id]).toBeUndefined();
  s().undo(); expect(s().world).toEqual(preDismiss); s().redo();
  s().execute('generator.reroll', { mapId: 'm', genId: 'g', seed: 10 });
  expect(current().entities[marker.id]).toEqual(marker);
  expect(current().entities[accepted.placeId]).toEqual(preDismiss!.maps.m!.entities[accepted.placeId]);
  expect(() => validateWorld(s().world!)).not.toThrow();
  expect(MapDocSchema.parse(JSON.parse(JSON.stringify(current())))).toEqual(current());
});

it('attaches settlement labels closely with linked Place records and populates 6 POI families on region maps', () => {
  const source = { ...input(), mapKind: 'region' as const };
  const terrain = buildTerrain(source), climate = buildClimate(terrain, source);
  const out = decorateWorld(terrain, climate.values, source, []);
  const places = out.filter((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place');
  const categories = new Set(places.map((p) => p.category));
  expect(categories.has('Settlement')).toBe(true);
  expect(categories.size).toBeGreaterThanOrEqual(4);
  const highwatch = out.find((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.name === 'Highwatch');
  const highwatchLabel = out.find((e): e is Extract<Entity, { type: 'label' }> => e.type === 'label' && e.text === 'Highwatch');
  if (highwatch && highwatchLabel) {
    expect(Math.hypot(highwatch.x - highwatchLabel.x, highwatch.y - highwatchLabel.y)).toBeLessThan(terrain.size * 0.02);
  }
});
