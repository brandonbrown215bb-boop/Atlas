import { describe, expect, it } from 'vitest';
import { migrateMapData, migrateWorldData } from './migrate';
import { MapDocSchema, WorldMetaSchema, type MapDoc, type WorldMeta } from './schema';
import { createWorldStore } from './store';

function createFixtureWorld(): { meta: WorldMeta; maps: Record<string, MapDoc> } {
  const meta: WorldMeta = WorldMetaSchema.parse({
    formatVersion: 1,
    id: 'world-1',
    name: 'Test World',
    maps: [{ id: 'map-1', name: 'Overworld', kind: 'world' }],
    themes: { default: {} },
  });

  const map: MapDoc = MapDocSchema.parse({
    formatVersion: 1,
    id: 'map-1',
    name: 'Overworld',
    kind: 'world',
    bounds: { x: 0, y: 0, w: 5000, h: 5000 },
    grid: { size: 100, visible: false },
    layers: [
      { id: 'layer-base', name: 'Base', visible: true, locked: false, gmOnly: false },
    ],
    entities: {},
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  });

  return { meta, maps: { [map.id]: map } };
}

describe('P1.1 schema, store, commands, history, and migrate', () => {
  it('adds, updates, and deletes an entity with undo/redo restoring exact state', () => {
    const store = createWorldStore();
    const { meta, maps } = createFixtureWorld();
    store.getState().loadWorld(meta, maps);

    const initialSnapshot = structuredClone(store.getState().world);

    // Add entity
    store.getState().execute('entity.add', {
      mapId: 'map-1',
      entity: {
        id: 'ent-1',
        type: 'area',
        layerId: 'layer-base',
        origin: 'generated',
        genId: 'gen-1',
        rev: 0,
        role: 'land',
        rings: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
        ],
      },
    });

    const afterAdd = structuredClone(store.getState().world);
    expect(afterAdd?.maps['map-1']?.entities['ent-1']).toBeDefined();
    expect(afterAdd?.maps['map-1']?.revision).toBe(2);
    expect(store.getState().dirtyMapIds['map-1']).toBe(true);

    // Update entity -> Rule A: generated becomes manual
    store.getState().execute('entity.update', {
      mapId: 'map-1',
      entityId: 'ent-1',
      patch: { name: 'Mainland' },
    });

    const afterUpdate = structuredClone(store.getState().world);
    const updatedEnt = afterUpdate?.maps['map-1']?.entities['ent-1'];
    expect(updatedEnt?.origin).toBe('manual');
    expect(updatedEnt?.name).toBe('Mainland');

    // Delete entity -> records deleted revision
    store.getState().execute('entity.delete', {
      mapId: 'map-1',
      entityId: 'ent-1',
    });

    const afterDelete = structuredClone(store.getState().world);
    expect(afterDelete?.maps['map-1']?.entities['ent-1']).toBeUndefined();
    expect(afterDelete?.maps['map-1']?.deleted['ent-1']).toBe(4);

    // Undo all 3 steps back to initial
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().world).toEqual(afterUpdate);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().world).toEqual(afterAdd);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().world).toEqual(initialSnapshot);
    expect(store.getState().undo()).toBe(false);

    // Redo all 3 steps forward
    expect(store.getState().redo()).toBe(true);
    expect(store.getState().world).toEqual(afterAdd);

    expect(store.getState().redo()).toBe(true);
    expect(store.getState().world).toEqual(afterUpdate);

    expect(store.getState().redo()).toBe(true);
    expect(store.getState().world).toEqual(afterDelete);
    expect(store.getState().redo()).toBe(false);
  });

  it('executes a batch as a single undo step', () => {
    const store = createWorldStore();
    const { meta, maps } = createFixtureWorld();
    store.getState().loadWorld(meta, maps);

    store.getState().executeBatch([
      {
        name: 'map.create',
        input: { id: 'map-2', name: 'Town', kind: 'settlement', parentId: 'map-1' },
      },
      {
        name: 'entity.add',
        input: {
          mapId: 'map-2',
          entity: {
            id: 'wall-1',
            type: 'wall',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            blocksMove: true,
            blocksSight: true,
          },
        },
      },
    ]);

    expect(store.getState().world?.maps['map-2']?.entities['wall-1']).toBeDefined();
    expect(store.getState().dirtyWorld).toBe(true);
    expect(store.getState().dirtyMapIds['map-2']).toBe(true);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().world?.maps['map-2']).toBeUndefined();
    expect(store.getState().world?.meta.maps).toHaveLength(1);
  });

  it('round-trips sample world and map through JSON and migrate', () => {
    const { meta, maps } = createFixtureWorld();
    const sampleMap = maps['map-1']!;
    sampleMap.entities['door-1'] = {
      id: 'door-1',
      type: 'door',
      layerId: 'layer-base',
      origin: 'manual',
      rev: 1,
      a: { x: 1, y: 2 },
      b: { x: 2, y: 2 },
      kind: 'secret',
      open: false,
      gmOnly: true,
    };

    const roundTrippedMeta = migrateWorldData(JSON.parse(JSON.stringify(meta)));
    const roundTrippedMap = migrateMapData(JSON.parse(JSON.stringify(sampleMap)));

    expect(roundTrippedMeta).toEqual(meta);
    expect(roundTrippedMap).toEqual(sampleMap);

    expect(() =>
      migrateMapData({ ...sampleMap, formatVersion: 999 }),
    ).toThrow(/Unsupported formatVersion/);
  });

  it('adds, updates, reorders, and deletes layers with undo', () => {
    const store = createWorldStore();
    const { meta, maps } = createFixtureWorld();
    store.getState().loadWorld(meta, maps);

    store.getState().execute('layer.add', {
      mapId: 'map-1',
      layer: {
        id: 'layer-top',
        name: 'Props',
        visible: true,
        locked: false,
        gmOnly: false,
      },
    });
    expect(store.getState().world?.maps['map-1']?.layers.map((l) => l.id)).toEqual([
      'layer-base',
      'layer-top',
    ]);

    store.getState().execute('layer.update', {
      mapId: 'map-1',
      layerId: 'layer-top',
      patch: { name: 'GM Props', visible: false, locked: true, gmOnly: true },
    });
    const updated = store.getState().world?.maps['map-1']?.layers[1]!;
    expect(updated).toEqual({
      id: 'layer-top',
      name: 'GM Props',
      visible: false,
      locked: true,
      gmOnly: true,
    });

    store.getState().execute('layer.reorder', {
      mapId: 'map-1',
      layerId: 'layer-top',
      toIndex: 0,
    });
    expect(store.getState().world?.maps['map-1']?.layers.map((l) => l.id)).toEqual([
      'layer-top',
      'layer-base',
    ]);

    store.getState().undo();
    expect(store.getState().world?.maps['map-1']?.layers.map((l) => l.id)).toEqual([
      'layer-base',
      'layer-top',
    ]);

    store.getState().execute('layer.delete', {
      mapId: 'map-1',
      layerId: 'layer-top',
    });
    expect(store.getState().world?.maps['map-1']?.layers.map((l) => l.id)).toEqual([
      'layer-base',
    ]);
  });

  it('creates a place from entities, cleans up deleted entity references, and supports undo', () => {
    const store = createWorldStore();
    const { meta, maps } = createFixtureWorld();
    store.getState().loadWorld(meta, maps);

    store.getState().execute('entity.add', {
      mapId: 'map-1',
      entity: {
        id: 'label-1',
        type: 'label',
        layerId: 'layer-base',
        origin: 'manual',
        rev: 0,
        text: 'Tavern',
        x: 10,
        y: 20,
        size: 14,
      },
    });

    const res = store.getState().execute('place.create', {
      mapId: 'map-1',
      id: 'place-1',
      name: 'The Rusty Anchor',
      category: 'Tavern',
      notes: 'Dockside inn',
      gmNotes: 'Secret cellar',
      entityIds: ['label-1'],
    }) as { id: string };

    expect(res.id).toBe('place-1');
    const created = store.getState().world?.maps['map-1']?.entities['place-1'];
    expect(created?.type).toBe('place');
    if (created?.type === 'place') {
      expect(created.entityIds).toEqual(['label-1']);
      expect(created.category).toBe('Tavern');
    }

    // Deleting the linked entity removes it from place.entityIds
    store.getState().execute('entity.delete', {
      mapId: 'map-1',
      entityId: 'label-1',
    });
    const afterDelete = store.getState().world?.maps['map-1']?.entities['place-1'];
    if (afterDelete?.type === 'place') {
      expect(afterDelete.entityIds).toEqual([]);
    }

    // Undo restores the linked entity and place reference
    expect(store.getState().undo()).toBe(true);
    const afterUndo = store.getState().world?.maps['map-1']?.entities['place-1'];
    if (afterUndo?.type === 'place') {
      expect(afterUndo.entityIds).toEqual(['label-1']);
    }
  });

  it('develops a child area with clipped inherited entities and opens a place interior with undo', () => {
    const store = createWorldStore();
    const { meta, maps } = createFixtureWorld();
    store.getState().loadWorld(meta, maps);

    store.getState().execute('entity.add', {
      mapId: 'map-1',
      entity: {
        id: 'bldg-1',
        type: 'area',
        layerId: 'layer-base',
        origin: 'manual',
        rev: 0,
        role: 'building',
        rings: [
          [
            { x: 100, y: 100 },
            { x: 130, y: 100 },
            { x: 130, y: 120 },
            { x: 100, y: 120 },
          ],
        ],
      },
    });

    const devRes = store.getState().execute('map.developArea', {
      parentMapId: 'map-1',
      childMapId: 'town-1',
      name: 'Market District',
      kind: 'settlement',
      rect: { x: 90, y: 90, w: 60, h: 60 },
    }) as { id: string; inheritedCount: number };

    expect(devRes.id).toBe('town-1');
    expect(devRes.inheritedCount).toBe(1);
    const childMap = store.getState().world?.maps['town-1'];
    expect(childMap?.parent).toEqual({
      mapId: 'map-1',
      x: 90,
      y: 90,
      rotation: 0,
    });

    store.getState().execute('place.create', {
      mapId: 'map-1',
      id: 'place-bldg',
      name: 'Guildhall',
      entityIds: ['bldg-1'],
    });

    const intRes = store.getState().execute('map.openInterior', {
      parentMapId: 'map-1',
      placeId: 'place-bldg',
      childMapId: 'int-1',
    }) as { id: string; created: boolean };
    expect(intRes).toEqual({ id: 'int-1', created: true });
    expect(store.getState().world?.maps['int-1']?.kind).toBe('interior');

    const place = store.getState().world?.maps['map-1']?.entities['place-bldg'];
    if (place?.type === 'place') {
      expect(place.childMapId).toBe('int-1');
    }

    // Re-opening returns existing interior
    const intRes2 = store.getState().execute('map.openInterior', {
      parentMapId: 'map-1',
      placeId: 'place-bldg',
    }) as { id: string; created: boolean };
    expect(intRes2).toEqual({ id: 'int-1', created: false });

    // Undo removes the interior and clears childMapId
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().world?.maps['int-1']).toBeUndefined();
  });
});
