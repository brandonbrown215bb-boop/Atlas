import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { ClimateSchema, MapDocSchema, type Entity } from '../../model/schema';
import { rectRing, toPolygons } from '../../geom/fog';
import { transferMap, validateWorld } from '../../model/transfer';
import type { WorldDocument } from '../../model/commands';
import { planSync } from '../../model/sync';
import { createWorldStore } from '../../model/store';

const bounds = { x: 0, y: 0, w: 100000, h: 80000 };
function fixture() {
  const base = { layerId: 'l', rev: 1, origin: 'manual' as const };
  const coast = [rectRing({ x: 5000, y: 5000, w: 90000, h: 70000 }), rectRing({ x: 40000, y: 30000, w: 20000, h: 20000 })];
  const manual = rectRing({ x: 20000, y: 20000, w: 10000, h: 10000 }), developed = rectRing({ x: 65000, y: 50000, w: 10000, h: 10000 });
  const map = MapDocSchema.parse({ id: 'region', name: 'Region', kind: 'region', bounds, grid: { size: 100, visible: false },
    layers: [{ id: 'l', name: 'Base', visible: true, locked: false, gmOnly: false }], revision: 1, deleted: {}, fog: { enabled: false, revealed: [] },
    generators: { g: { type: 'world', seed: 9, params: { cells: 500 }, regionEntityId: 'footprint', layerId: 'l' } },
    entities: {
      footprint: { ...base, id: 'footprint', type: 'area', role: 'land', rings: [rectRing(bounds)] },
      coast: { ...base, id: 'coast', type: 'area', role: 'land', rings: coast, origin: 'generated', genId: 'g' },
      biome: { ...base, id: 'biome', type: 'area', role: 'biome:snow', name: 'snow', fill: '#d9e3dc', rings: coast, origin: 'generated', genId: 'g' },
      manual: { ...base, id: 'manual', type: 'area', role: 'biome:enchanted', rings: [manual] },
      developed: { ...base, id: 'developed', type: 'area', role: 'district', rings: [developed] },
      town: { ...base, id: 'town', type: 'place', name: 'Keep me', notes: 'Public notes', gmNotes: 'Secrets', category: 'settlement', entityIds: ['developed'], childMapId: 'site' },
      river: { ...base, id: 'river', type: 'path', role: 'river', points: [{ x: 70000, y: 20000 }, { x: 85000, y: 5000 }], width: 50, closed: false, origin: 'generated', genId: 'g' },
    } });
  const site = MapDocSchema.parse({ ...map, id: 'site', name: 'Developed site', kind: 'site', parent: { mapId: 'region', x: 65000, y: 50000, rotation: 0, footprintEntityId: 'developed' }, generators: {} });
  delete site.entities.town;
  const meta = { id: 'source', name: 'Cold world', formatVersion: 1, themes: {}, climate: ClimateSchema.parse({ temperature: -.8 }),
    maps: [{ id: 'region', name: 'Region', kind: 'region' as const }, { id: 'site', name: 'Developed site', kind: 'site' as const, parentId: 'region' }] };
  const source: WorldDocument = { meta, maps: { region: map, site } };
  const parent = MapDocSchema.parse({ ...map, id: 'world', name: 'Hot world', kind: 'world', bounds: { x: 0, y: 0, w: 1000000, h: 800000 }, entities: {}, generators: {} });
  const target: WorldDocument = { meta: { ...meta, id: 'target', name: 'Hot world', climate: ClimateSchema.parse({ temperature: .8, moisture: -.8 }),
    maps: [{ id: 'world', name: 'Hot world', kind: 'world' }] }, maps: { world: parent } };
  return { source, target };
}
function ids() { let id = 0; return () => `copy-${++id}`; }
const biomes = (entities: Entity[]) => entities.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role.startsWith('biome:') && e.origin === 'generated');

for (const mode of ['copy', 'move', 'linked'] as const) it(`${mode} re-climates generated biomes while preserving manual areas, places, coastline, rivers and developed child maps`, () => {
  const { source, target } = fixture(), original = structuredClone(source);
  const placement = { parentMapId: 'world', x: 200000, y: 200000, rotation: 0, scale: 1, underneath: 'merge' as const, seamMargin: 0 };
  const before = transferMap(source, target, { mapId: 'region', mode, placement }, ids());
  const after = transferMap(source, target, { mapId: 'region', mode, placement: { ...placement, reClimate: true } }, ids());
  const normal = before.target.maps[before.mapId]!, changed = after.target.maps[after.mapId]!;
  const originalBiomes = biomes(Object.values(normal.entities)), changedBiomes = biomes(Object.values(changed.entities));
  expect(originalBiomes.every(e => e.role === 'biome:snow')).toBe(true);
  expect(changedBiomes.length).toBeGreaterThan(0);
  expect(changedBiomes.some(e => e.role === 'biome:desert')).toBe(true);
  for (const e of Object.values(normal.entities).filter(e => !originalBiomes.includes(e as typeof originalBiomes[number]))) expect(changed.entities[e.id]).toEqual(e);
  const siteBefore = Object.values(before.target.maps).find(m => m.kind === 'site')!;
  expect(after.target.maps[siteBefore.id]).toEqual(siteBefore);
  const oldCoverage = clipping.union(toPolygons([originalBiomes[0]!.rings]), ...originalBiomes.slice(1).map(e => toPolygons([e.rings])));
  const protectedAreas = Object.values(normal.entities).filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && (e.role === 'district' || e.role === 'biome:enchanted'));
  const preservedCoverage = clipping.union(toPolygons([protectedAreas[0]!.rings]), ...protectedAreas.slice(1).map(e => toPolygons([e.rings])));
  for (const e of changedBiomes.filter(e => e.role === 'biome:snow')) expect(clipping.difference(toPolygons([e.rings]), preservedCoverage)).toEqual([]);
  const actual = clipping.union(toPolygons([changedBiomes[0]!.rings]), ...changedBiomes.slice(1).map(e => toPolygons([e.rings])));
  expect(clipping.xor(oldCoverage, actual)).toEqual([]);
  expect(() => validateWorld(after.target)).not.toThrow();
  expect(source).toEqual(original);
  if (mode === 'move') expect(after.source.maps).toEqual({});
  if (mode === 'linked') {
    const sync = planSync(changed, after.source.maps.region!);
    expect(sync.taken).toEqual([]); expect(sync.conflicts).toEqual([]);
  }
});

it('uses the arrival latitude and preserves manual-only regions without a revision change', () => {
  const { source, target } = fixture();
  target.meta.climate = ClimateSchema.parse({ northLatitude: 90, southLatitude: -90, moisture: .2 });
  const transfer = (y: number) => transferMap(source, target, { mapId: 'region', mode: 'copy', placement: { parentMapId: 'world', x: 400000, y, rotation: 0, scale: 1, underneath: 'merge', seamMargin: 0, reClimate: true } }, ids());
  const north = transfer(0), equator = transfer(350000);
  const names = (w: typeof north) => [...new Set(biomes(Object.values(w.target.maps[w.mapId]!.entities)).map(e => e.role))].sort();
  expect(names(north)).not.toEqual(names(equator));
  source.maps.region!.entities.biome!.origin = 'manual';
  const result = transfer(0);
  expect(result.target.maps[result.mapId]!.revision).toBe(source.maps.region!.revision);
  expect(Object.values(result.target.maps[result.mapId]!.entities).find(e => e.name === 'snow')).toMatchObject({ origin: 'manual', role: 'biome:snow' });
});

it('keeps the old biome beneath a developed child with no footprint entity', () => {
  const { source, target } = fixture();
  delete source.maps.site!.parent!.footprintEntityId;
  delete source.maps.region!.entities.developed;
  const place = source.maps.region!.entities.town!;
  if (place.type === 'place') place.entityIds = [];
  const result = transferMap(source, target, { mapId: 'region', mode: 'copy', placement: {
    parentMapId: 'world', x: 0, y: 0, rotation: 0, scale: 1, underneath: 'merge', seamMargin: 0, reClimate: true,
  } }, ids());
  const changed = result.target.maps[result.mapId]!;
  const old = biomes(Object.values(changed.entities)).filter(e => e.role === 'biome:snow');
  const child = Object.values(result.target.maps).find(m => m.kind === 'site')!;
  const footprint = toPolygons([[rectRing({ x: child.parent!.x, y: child.parent!.y, w: child.bounds.w, h: child.bounds.h })]]);
  const preserved = clipping.union(toPolygons([old[0]!.rings]), ...old.slice(1).map(e => toPolygons([e.rings])));
  const original = source.maps.region!.entities.biome!;
  if (original.type !== 'area') throw new Error();
  const expected = clipping.intersection(footprint, toPolygons([original.rings]));
  expect(expected.length).toBeGreaterThan(0);
  expect(clipping.difference(expected, preserved)).toEqual([]);
});

it('applies a generated map move as one undo step without mistaking schema field order for an edit', () => {
  const { source, target } = fixture(), store = createWorldStore(), s = () => store.getState();
  s().loadWorld(source.meta, source.maps);
  s().execute('generator.reroll', { mapId: 'region', genId: 'g', seed: 42 });
  const before = s().world!;
  const result = transferMap(before, target, { mapId: 'region', mode: 'move', placement: {
    parentMapId: 'world', x: 200000, y: 200000, rotation: 0, scale: 1, underneath: 'merge', seamMargin: 0, reClimate: true,
  } }, ids());
  s().execute('world.applyTransfer', { before, after: result.source });
  expect(s().world).toEqual(result.source);
  s().undo(); expect(s().world).toEqual(before);
  s().execute('entity.update', { mapId: 'region', entityId: 'manual', patch: { name: 'A newer edit' } });
  const newer = s().world;
  expect(() => s().execute('world.applyTransfer', { before, after: result.source })).toThrow('World changed during transfer');
  expect(s().world).toBe(newer);
});
