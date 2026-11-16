import { expect, it } from 'vitest';
import { MapDocSchema, WorldMetaSchema } from './schema';
import { createWorldStore } from './store';

const square = (x: number, y: number, s: number) => [[{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]];
function lockedStore() {
  const map = MapDocSchema.parse({ id: 'm', name: 'World', kind: 'world', bounds: { x: 0, y: 0, w: 100, h: 100 }, grid: { size: 10, visible: false },
    layers: [{ id: 'open', name: 'Open', visible: true, locked: false, gmOnly: false }, { id: 'locked', name: 'Locked', visible: true, locked: true, gmOnly: false }],
    entities: {
      land: { id: 'land', type: 'area', role: 'land', layerId: 'open', origin: 'manual', rev: 0, rings: square(0, 0, 100) },
      forest: { id: 'forest', type: 'area', role: 'biome:forest', name: 'Forest', layerId: 'locked', origin: 'manual', rev: 0, rings: square(0, 0, 100) },
      a: { id: 'a', type: 'label', text: 'A', x: 1, y: 1, size: 12, layerId: 'open', origin: 'manual', rev: 0, groupId: 'g' },
      b: { id: 'b', type: 'label', text: 'B', x: 2, y: 2, size: 12, layerId: 'open', origin: 'manual', rev: 0, groupId: 'g' },
    },
    generators: {}, revision: 0, deleted: {}, fog: { enabled: false, revealed: [] } });
  const meta = WorldMetaSchema.parse({ formatVersion: 1, id: 'w', name: 'W', maps: [{ id: 'm', name: 'World', kind: 'world' }], themes: { default: {} } });
  const store = createWorldStore();
  store.getState().loadWorld(meta, { m: map });
  return store.getState;
}

it('commands refuse to change geometry on a locked layer but allow names and notes', () => {
  const s = lockedStore();
  const label = (layerId: string) => ({ id: 'new', type: 'label', text: 'N', x: 0, y: 0, size: 12, layerId, origin: 'manual', rev: 0 });
  expect(() => s().execute('entity.add', { mapId: 'm', entity: label('locked') })).toThrow('Unlock');
  expect(() => s().execute('entity.add', { mapId: 'm', entity: label('missing') })).toThrow('Layer not found');
  expect(() => s().execute('entity.update', { mapId: 'm', entityId: 'forest', patch: { rings: square(0, 0, 50) } })).toThrow('Unlock');
  expect(() => s().execute('entity.update', { mapId: 'm', entityId: 'a', patch: { layerId: 'locked' } })).toThrow('Unlock');
  expect(() => s().execute('entity.delete', { mapId: 'm', entityId: 'forest' })).toThrow('Unlock');
  expect(() => s().execute('entity.duplicate', { mapId: 'm', entityIds: ['forest'] })).toThrow('Unlock');
  s().execute('entity.update', { mapId: 'm', entityId: 'forest', patch: { name: 'Old wood' } });
  expect(s().world!.maps.m!.entities.forest).toMatchObject({ name: 'Old wood' });
});

it('painting a biome does not cut biomes on a locked layer', () => {
  const s = lockedStore();
  const before = structuredClone(s().world!.maps.m!.entities.forest);
  s().execute('map.paintBiome', { mapId: 'm', biome: 'desert', points: [{ x: 50, y: 50 }], radius: 10, layerId: 'open' });
  expect(s().world!.maps.m!.entities.forest).toMatchObject({ rings: before && 'rings' in before ? before.rings : [] });
});

it('duplicating copies a group as a group only when every member is selected', () => {
  const s = lockedStore();
  const both = s().execute('entity.duplicate', { mapId: 'm', entityIds: ['a', 'b'] }) as { ids: string[] };
  const [first, second] = both.ids.map((id) => s().world!.maps.m!.entities[id]!);
  expect(first!.groupId).toBeDefined();
  expect(first!.groupId).not.toBe('g');
  expect(second!.groupId).toBe(first!.groupId);
  const one = s().execute('entity.duplicate', { mapId: 'm', entityIds: ['a'] }) as { ids: string[] };
  expect(s().world!.maps.m!.entities[one.ids[0]!]!.groupId).toBeUndefined();
});
