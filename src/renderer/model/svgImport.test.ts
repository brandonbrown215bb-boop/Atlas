import { describe, expect, it } from 'vitest';
import { createWorldStore } from './store';
import { WorldMetaSchema } from './schema';

function fixture() {
  const store = createWorldStore();
  store.getState().loadWorld(WorldMetaSchema.parse({ formatVersion: 1, id: 'world', name: 'World', maps: [], themes: {} }), {});
  store.getState().execute('map.create', { id: 'map', name: 'Map', kind: 'site' });
  store.getState().markClean({ world: true, mapIds: ['map'] });
  return store;
}
const shapes = [
  { type: 'area', role: 'water', name: 'Lake', rings: [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }]] },
  { type: 'path', role: 'river', points: [{ x: 30, y: 10 }, { x: 40, y: 20 }], closed: false, width: 2 },
];
describe('map.importSvg', () => {
  it('imports manual geometry, dirties one map, and restores everything with one undo/redo', () => {
    const store = fixture();
    const before = structuredClone(store.getState().world);
    const historyLength = store.getState().history.past.length;
    const { ids } = store.getState().execute('map.importSvg', { mapId: 'map', layerId: 'layer-base', shapes }) as { ids: string[] };
    const after = structuredClone(store.getState().world);
    expect(ids).toHaveLength(2);
    const map = after!.maps.map!;
    expect(map.revision).toBe(before!.maps.map!.revision + 1);
    expect(Object.values(map.entities).every((e) => e.origin === 'manual' && e.rev === map.revision)).toBe(true);
    expect(store.getState().dirtyMapIds).toEqual({ map: true });
    expect(store.getState().dirtyWorld).toBe(false);
    expect(store.getState().history.past).toHaveLength(historyLength + 1);
    store.getState().undo();
    expect(store.getState().world).toEqual(before);
    store.getState().redo();
    expect(store.getState().world).toEqual(after);
  });
  it('rejects invalid geometry without partial imports or history changes', () => {
    const store = fixture();
    const before = store.getState();
    expect(() => store.getState().execute('map.importSvg', { mapId: 'map', layerId: 'layer-base', shapes: [...shapes, { ...shapes[1], role: 'bogus' }] })).toThrow();
    expect(store.getState()).toBe(before);
  });
  it.each([{ locked: true }, { visible: false }])('refuses an uneditable target layer: %s', (patch) => {
    const store = fixture();
    store.getState().execute('layer.update', { mapId: 'map', layerId: 'layer-base', patch });
    const before = store.getState();
    expect(() => store.getState().execute('map.importSvg', { mapId: 'map', layerId: 'layer-base', shapes })).toThrow('visible, unlocked');
    expect(store.getState()).toBe(before);
  });
});
