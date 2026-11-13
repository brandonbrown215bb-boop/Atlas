import { describe, expect, it } from 'vitest';
import type { MapDoc, PlaceEntity } from '../model/schema';
import {
  filterPlaces,
  getPlaceBounds,
  getPlaceCenter,
  listPlaceCategories,
} from './places';

function makeFixtureMap(): MapDoc {
  return {
    formatVersion: 1,
    id: 'm1',
    name: 'Town',
    kind: 'settlement',
    bounds: { x: 0, y: 0, w: 200, h: 200 },
    grid: { size: 5, visible: true },
    layers: [
      { id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false },
    ],
    entities: {
      a1: {
        id: 'a1',
        type: 'area',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        role: 'building',
        rings: [
          [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 40 },
            { x: 10, y: 40 },
          ],
        ],
      },
      p1: {
        id: 'p1',
        type: 'portal',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        x: 50,
        y: 60,
        targetMapId: 'm2',
      },
      pl1: {
        id: 'pl1',
        type: 'place',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        name: 'The Rusty Anchor',
        category: 'Tavern',
        notes: 'Popular dockside inn',
        gmNotes: 'Smuggler cellar beneath',
        entityIds: ['a1', 'p1', 'missing-id'],
      },
      pl2: {
        id: 'pl2',
        type: 'place',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        name: 'Ironworks',
        category: 'Shop',
        notes: 'Blacksmith',
        gmNotes: '',
        entityIds: [],
      },
    },
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };
}

describe('places geometry and filtering helpers', () => {
  it('computes merged bounds and center across valid linked entities', () => {
    const map = makeFixtureMap();
    const place = map.entities.pl1 as PlaceEntity;
    const bounds = getPlaceBounds(map, place);
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBe(10);
    expect(bounds!.minY).toBe(20);
    expect(bounds!.maxX).toBeGreaterThan(50);
    expect(bounds!.maxY).toBeGreaterThan(60);

    const center = getPlaceCenter(map, place);
    expect(center).toEqual({
      x: (bounds!.minX + bounds!.maxX) / 2,
      y: (bounds!.minY + bounds!.maxY) / 2,
    });
  });

  it('returns null bounds and center for a place with no valid entities', () => {
    const map = makeFixtureMap();
    const emptyPlace = map.entities.pl2 as PlaceEntity;
    expect(getPlaceBounds(map, emptyPlace)).toBeNull();
    expect(getPlaceCenter(map, emptyPlace)).toBeNull();
  });

  it('lists unique sorted categories and filters by query and category', () => {
    const map = makeFixtureMap();
    const places = [map.entities.pl1 as PlaceEntity, map.entities.pl2 as PlaceEntity];

    expect(listPlaceCategories(places)).toEqual(['Shop', 'Tavern']);
    expect(filterPlaces(places, '', '')).toHaveLength(2);
    expect(filterPlaces(places, '', 'Tavern').map((p) => p.id)).toEqual(['pl1']);
    expect(filterPlaces(places, 'smuggler', '').map((p) => p.id)).toEqual(['pl1']);
    expect(filterPlaces(places, 'blacksmith', 'Shop').map((p) => p.id)).toEqual(['pl2']);
    expect(filterPlaces(places, 'rusty', 'Shop')).toEqual([]);
  });
});
