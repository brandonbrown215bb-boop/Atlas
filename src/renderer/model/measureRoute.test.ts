import { describe, expect, it } from 'vitest';
import { WorldMetaSchema } from './schema';
import { createWorldStore } from './store';

describe('map.measureRoute command', () => {
  it('returns a measurement without changing world state, revision, dirty flags or undo/redo history', () => {
    const store = createWorldStore();
    store.getState().loadWorld(WorldMetaSchema.parse({ formatVersion: 1, id: 'w', name: 'World', maps: [], themes: {} }), {});
    store.getState().execute('map.create', { id: 'm', name: 'Map', kind: 'site' });
    store.getState().markClean({ world: true, mapIds: ['m'] });
    const before = store.getState();
    expect(store.getState().execute('map.measureRoute', {
      mapId: 'm', points: [{ x: 0, y: 0 }, { x: 1609.344, y: 0 }], speedMph: 2, departure: '23:45',
    })).toMatchObject({ miles: 1, feet: 5280, durationSeconds: 1800, arrival: { time: '00:15', dayOffset: 1 } });
    expect(store.getState()).toBe(before);
    expect(() => store.getState().execute('map.measureRoute', { mapId: 'm', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], speedMph: 0 })).toThrow();
    expect(() => store.getState().execute('map.measureRoute', { mapId: 'missing', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })).toThrow('Map not found');
    expect(store.getState()).toBe(before);
  });
});
