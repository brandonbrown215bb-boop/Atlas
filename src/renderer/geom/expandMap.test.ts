import { describe, expect, it } from 'vitest';
import { migrateMapData } from '../model/migrate';
import { MapDocSchema } from '../model/schema';
import { createWorldStore } from '../model/store';
import { expandNeighborMap } from './expandMap';

describe('expandMap neighbor seam continuity, floor stacking, and label rearrange', () => {
  it('mirrors border coastline, roads, and terrain cells seamlessly onto an East neighbor map', () => {
    const source = MapDocSchema.parse({
      formatVersion: 2,
      id: 'region-w',
      name: 'West Reach',
      kind: 'region',
      bounds: { x: 0, y: 0, w: 1000, h: 800 },
      grid: { size: 100, visible: false },
      layers: [{ id: 'base', name: 'Base', visible: true, locked: false, gmOnly: false }],
      entities: {
        road: {
          id: 'road',
          type: 'path',
          role: 'road',
          routeTier: 'highway',
          layerId: 'base',
          origin: 'manual',
          rev: 1,
          points: [{ x: 600, y: 400 }, { x: 1000, y: 400 }],
          width: 10,
          closed: false,
        },
        land: {
          id: 'land',
          type: 'area',
          role: 'land',
          layerId: 'base',
          origin: 'manual',
          rev: 1,
          rings: [[{ x: 800, y: 200 }, { x: 1000, y: 200 }, { x: 1000, y: 600 }, { x: 800, y: 600 }]],
        },
      },
      generators: {},
      revision: 1,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    });

    const east = expandNeighborMap(source, 'E', 'region-e', 'East Reach');
    const seamRoad = Object.values(east.entities).find((e) => e.type === 'path');
    expect(seamRoad?.type).toBe('path');
    if (seamRoad?.type === 'path') {
      expect(seamRoad.points.some((p) => p.x === 0 && Math.abs(p.y - 400) < 1)).toBe(true);
    }
    const seamLand = Object.values(east.entities).find((e) => e.type === 'area');
    expect(seamLand?.origin).toBe('manual');
    expect(seamLand?.inheritedFrom).toBeUndefined();
  });

  it('stacks floors via map.createFloor with aligned stair portals and rearranges labels cleanly', () => {
    const store = createWorldStore();
    const s = () => store.getState();
    const m1 = MapDocSchema.parse({
      formatVersion: 2,
      id: 'inn-1f',
      name: 'Wayside Inn',
      kind: 'interior',
      bounds: { x: 0, y: 0, w: 20, h: 20 },
      grid: { size: 1, visible: true },
      layers: [{ id: 'base', name: 'Base', visible: true, locked: false, gmOnly: false }],
      entities: {
        hall: { id: 'hall', type: 'area', role: 'floor', layerId: 'base', origin: 'manual', rev: 0, rings: [[{ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 18 }, { x: 2, y: 18 }]] },
        lbl1: { id: 'lbl1', type: 'label', layerId: 'base', origin: 'manual', rev: 0, text: 'Common Room', x: 10, y: 10, size: 16 },
        lbl2: { id: 'lbl2', type: 'label', layerId: 'base', origin: 'manual', rev: 0, text: ' Hearthfire Kitchen', x: 10, y: 10, size: 16 },
      },
      generators: {},
      revision: 1,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    });
    s().loadWorld({ id: 'w', name: 'World', formatVersion: 1, maps: [{ id: 'inn-1f', name: 'Wayside Inn', kind: 'interior' }], themes: {} }, { 'inn-1f': m1 });
    s().execute('map.createFloor', { sourceMapId: 'inn-1f', levelDelta: 1, newId: 'inn-2f' });
    const firstFloor = s().world!.maps['inn-1f']!;
    const secondFloor = s().world!.maps['inn-2f']!;
    expect(firstFloor.elevationStories).toBe(2);
    expect(secondFloor.level).toBe(1);
    expect(secondFloor.floorGroupId).toBe(firstFloor.floorGroupId);
    expect(Object.values(secondFloor.entities).some((e) => e.type === 'portal' && e.connectorKind === 'stairsDown' && e.targetMapId === 'inn-1f')).toBe(true);

    s().execute('map.rearrangeLabels', { mapId: 'inn-1f' });
    const after1 = s().world!.maps['inn-1f']!.entities.lbl1!;
    const after2 = s().world!.maps['inn-1f']!.entities.lbl2!;
    if (after1.type === 'label' && after2.type === 'label') {
      expect(Math.hypot(after1.x - after2.x, after1.y - after2.y)).toBeGreaterThan(2);
    }
    s().undo();
    const reverted2 = s().world!.maps['inn-1f']!.entities.lbl2!;
    if (reverted2.type === 'label') expect(reverted2.x).toBe(10);
  });

  it('migrates legacy formatVersion 1 maps seamlessly without breaking missing optional N08 fields', () => {
    const legacy = {
      formatVersion: 1,
      id: 'legacy-map',
      name: 'Legacy Town',
      kind: 'settlement',
      bounds: { x: 0, y: 0, w: 300, h: 200 },
      grid: { size: 10, visible: false },
      layers: [{ id: 'l', name: 'Base', visible: true, locked: false, gmOnly: false }],
      entities: {
        w1: { id: 'w1', type: 'wall', origin: 'manual', layerId: 'l', rev: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], blocksMove: true, blocksSight: true },
        d1: { id: 'd1', type: 'door', origin: 'manual', layerId: 'l', rev: 0, a: { x: 10, y: 0 }, b: { x: 12, y: 0 }, kind: 'door', open: false },
        p1: { id: 'p1', type: 'place', origin: 'manual', layerId: 'l', rev: 0, name: 'Inn', category: 'Tavern', notes: '', gmNotes: '', entityIds: [] },
      },
      generators: {},
      revision: 0,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    };
    const migrated = migrateMapData(legacy);
    expect(migrated.formatVersion).toBe(2);
    expect(migrated.entities.w1?.type).toBe('wall');
    expect(migrated.entities.d1?.type).toBe('door');
    expect(migrated.entities.p1?.type).toBe('place');
  });
});
