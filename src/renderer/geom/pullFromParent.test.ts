import { describe, expect, it } from 'vitest';
import type { MapDoc } from '../model/schema';
import { hasParentChanged, listKeptEditedEntities } from './pullFromParent';

function makePair(): { parent: MapDoc; child: MapDoc } {
  const parent: MapDoc = {
    formatVersion: 1,
    id: 'p1',
    name: 'Parent',
    kind: 'region',
    bounds: { x: 0, y: 0, w: 1000, h: 1000 },
    grid: { size: 100, visible: false },
    layers: [{ id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false }],
    entities: {
      a1: {
        id: 'a1',
        type: 'area',
        layerId: 'l1',
        origin: 'manual',
        rev: 2,
        role: 'land',
        rings: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
        ],
      },
    },
    generators: {},
    revision: 2,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };

  const child: MapDoc = {
    formatVersion: 1,
    id: 'c1',
    name: 'Child',
    kind: 'settlement',
    parent: { mapId: 'p1', x: 0, y: 0, rotation: 0 },
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    grid: { size: 10, visible: false },
    layers: [{ id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false }],
    entities: {
      inh1: {
        id: 'inh1',
        type: 'area',
        layerId: 'l1',
        origin: 'inherited',
        rev: 1,
        inheritedFrom: { entityId: 'a1', parentRev: 2 },
        role: 'land',
        rings: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
        ],
      },
    },
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };

  return { parent, child };
}

describe('pullFromParent helpers', () => {
  it('detects when parent has changed due to updated, deleted, or newly added entities', () => {
    const { parent, child } = makePair();
    expect(hasParentChanged(child, parent)).toBe(false);

    // Parent entity updated
    parent.entities.a1!.rev = 3;
    parent.revision = 3;
    expect(hasParentChanged(child, parent)).toBe(true);

    // Reset and test parent entity deleted
    parent.entities.a1!.rev = 2;
    parent.revision = 2;
    expect(hasParentChanged(child, parent)).toBe(false);
    delete parent.entities.a1;
    parent.revision = 4;
    expect(hasParentChanged(child, parent)).toBe(true);
  });

  it('lists edited inherited entities that are now manual', () => {
    const { child } = makePair();
    expect(listKeptEditedEntities(child)).toEqual([]);
    child.entities.inh1!.origin = 'manual';
    expect(listKeptEditedEntities(child)).toEqual([
      { id: 'inh1', type: 'area', name: undefined, parentEntityId: 'a1' },
    ]);
  });
});
