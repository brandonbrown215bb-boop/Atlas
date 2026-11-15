import { describe, expect, it } from 'vitest';
import { MapDocSchema, WorldMetaSchema, type MapDoc, type Entity } from './schema';
import { coversMap, resolveGenerationContext } from './generationContext';
import { createWorldStore } from './store';
import { rectRing } from '../geom/fog';

function map(kind: MapDoc['kind'] = 'world'): MapDoc {
  return MapDocSchema.parse({ id: 'map', name: 'Map', kind, bounds: { x: 0, y: 0, w: 100, h: 80 }, grid: { size: 1.524, visible: true },
    layers: [{ id: 'base', name: 'Art', visible: true, locked: false, gmOnly: false }], entities: {}, generators: {}, revision: 0, deleted: {}, fog: { enabled: false, revealed: [] } });
}
function area(id: string, role = 'land', extra: Partial<Entity> = {}): Entity {
  return { id, type: 'area', role: role as 'land', layerId: 'base', origin: 'manual', rev: 0,
    rings: [rectRing({ x: 10, y: 10, w: 60, h: 50 })], ...extra } as Entity;
}
function withResult(m: MapDoc, type = 'world', id = 'run') {
  m.generators[id] = { type, seed: 1, params: {}, regionEntityId: `boundary-${id}`, boundary: [rectRing(m.bounds)], groupId: id };
  m.entities[`boundary-${id}`] = area(`boundary-${id}`, 'land', { usage: 'boundary', groupId: id });
  const boundary = m.entities[`boundary-${id}`]!;
  if (boundary.type === 'area') boundary.rings = [rectRing(m.bounds)];
  m.entities[`${id}-output`] = area(`${id}-output`, 'land', { origin: 'generated', genId: id, groupId: id });
  return m;
}
describe('contextual generation targets', () => {
  it('uses authored land only where it intersects, excluding references and boundaries', () => {
    const m = map();
    expect(resolveGenerationContext(m, [], false)).toMatchObject({ kind: 'generate', type: 'world', mode: 'new' });
    m.entities.land = area('land', 'land');
    expect(resolveGenerationContext(m, [], false).mode).toBe('populate');
    m.entities.land.usage = 'reference';
    expect(resolveGenerationContext(m, [], false).mode).toBe('new');
    m.entities.land.usage = 'boundary';
    expect(resolveGenerationContext(m, [], false).mode).toBe('new');
    m.entities.land = area('land', 'land', { rings: [rectRing({ x: 200, y: 200, w: 50, h: 50 })] } as Partial<Entity>);
    expect(resolveGenerationContext(m, [], false).mode).toBe('new');
  });
  it('never broadens mixed selections or uses a trace group as a footprint', () => {
    const m = map(); m.entities.a = area('a'); m.entities.b = area('b');
    expect(resolveGenerationContext(m, ['a', 'b'], false).kind).toBe('selection');
    expect(resolveGenerationContext(m, ['a'], false)).toMatchObject({ regionId: 'a', mode: 'populate' });
    expect(resolveGenerationContext(m, ['deleted'], false).label).toBe('Whole map');
  });
  it('loads selected result ownership and asks when several whole-map results exist', () => {
    const m = withResult(map());
    expect(resolveGenerationContext(m, ['boundary-run', 'run-output'], false)).toMatchObject({ kind: 'result', genId: 'run' });
    expect(resolveGenerationContext(m, [], false).genId).toBe('run');
    withResult(m, 'world', 'second');
    expect(resolveGenerationContext(m, [], false).kind).toBe('results');
    m.generators.second!.boundary!.push(rectRing({ x: 10, y: 10, w: 5, h: 5 }));
    delete m.entities['boundary-second'];
    expect(coversMap(m, m.generators.second!)).toBe(false);
  });
  it('offers building and room actions while editing parts, retaining their owner', () => {
    const town = withResult(map('settlement'), 'city');
    town.entities.building = area('building', 'building', { origin: 'generated', genId: 'run', groupId: 'run', name: 'Anchor' });
    expect(resolveGenerationContext(town, ['building'], true)).toMatchObject({ kind: 'building', genId: 'run', label: 'Anchor interior' });
    town.entities.place = { id: 'place', type: 'place', layerId: 'base', origin: 'manual', rev: 0,
      name: 'The Rusty Anchor', category: 'Tavern', notes: '', gmNotes: '', entityIds: ['building'] };
    expect(resolveGenerationContext(town, ['place'], false)).toMatchObject({ kind: 'building', regionId: 'building', genId: 'run', label: 'The Rusty Anchor interior' });
    expect(resolveGenerationContext(town, ['boundary-run', 'run-output', 'building'], false).kind).toBe('result');
    const interior = withResult(map('interior'), 'dungeon');
    interior.entities.room = area('room', 'floor', { origin: 'generated', genId: 'run', groupId: 'run' });
    expect(resolveGenerationContext(interior, ['room'], true)).toMatchObject({ kind: 'room', genId: 'run' });
  });
  it('requires an explicit site choice and keeps whole-map defaults for other kinds', () => {
    expect(resolveGenerationContext(map('site'), [], false).kind).toBe('chooseSite');
    expect(resolveGenerationContext(map('site'), [], false, 'glade').type).toBe('glade');
    expect(resolveGenerationContext(map('settlement'), [], false).type).toBe('city');
    expect(resolveGenerationContext(map('interior'), [], false).type).toBe('dungeon');
  });
});
describe('whole-map generation commands', () => {
  it('keeps a populated coastline in its original group and gives the new detail its own boundary', () => {
    const m = map(), s = createWorldStore();
    m.entities.land = area('land', 'land', { groupId: 'trace', name: 'Island' });
    const land = structuredClone(m.entities.land);
    s.getState().loadWorld(WorldMetaSchema.parse({ formatVersion: 2, id: 'world', name: 'World', maps: [{ id: 'map', name: 'Map', kind: 'world' }], themes: {} }), { map: m });
    s.getState().execute('generator.run', { mapId: m.id, type: 'world', genId: 'detail', regionEntityId: 'land', seed: 5,
      params: { mode: 'populate', cells: 200, rivers: false, density: 0, settlements: 0 }, layerId: 'base' });
    const after = s.getState().world!.maps.map!, record = after.generators.detail!;
    expect(after.entities.land).toEqual(land);
    expect(record.regionEntityId).not.toBe('land');
    expect(after.entities[record.regionEntityId]).toMatchObject({ usage: 'boundary', groupId: 'detail', rings: (land as Extract<Entity, { type: 'area' }>).rings });
  });
  for (const [kind, type, params] of [
    ['world', 'world', { cells: 200, rivers: false, density: 0, settlements: 0 }],
    ['settlement', 'city', { density: .3 }], ['site', 'glade', { clearings: 2, water: false }],
    ['interior', 'dungeon', { rooms: 3 }],
  ] as const) it(`generates ${type} on a blank ${kind} and undoes its boundary with its output`, () => {
    const m = map(kind), s = createWorldStore();
    s.getState().loadWorld(WorldMetaSchema.parse({ formatVersion: 2, id: 'world', name: 'World', maps: [{ id: 'map', name: 'Map', kind }], themes: {} }), { map: m });
    const before = s.getState().world;
    s.getState().execute('generator.run', { mapId: m.id, type, genId: 'run', entireMap: true, seed: 5, params, layerId: 'base' });
    const after = s.getState().world!.maps.map!;
    expect(after.generators.run!.boundary).toEqual([rectRing(m.bounds)]);
    expect(Object.values(after.entities).some(e => e.genId === 'run')).toBe(true);
    s.getState().execute('generator.reroll', { mapId: m.id, genId: 'run', seed: 6 });
    expect(s.getState().world!.maps.map!.generators.run!.boundary).toEqual([rectRing(m.bounds)]);
    s.getState().undo(); s.getState().undo();
    expect(s.getState().world).toEqual(before);
  });
});
