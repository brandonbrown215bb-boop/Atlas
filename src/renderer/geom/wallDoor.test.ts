import { describe, expect, it } from 'vitest';
import type { MapDoc } from '../model/schema';
import { findDoorPlacementOnWall } from './wallDoor';

const baseMap: MapDoc = {
  formatVersion: 1,
  id: 'm1',
  name: 'Dungeon',
  kind: 'interior',
  bounds: { x: 0, y: 0, w: 50, h: 50 },
  grid: { size: 1.524, visible: true },
  layers: [
    { id: 'l1', name: 'Walls', visible: true, locked: false, gmOnly: false },
    { id: 'l2', name: 'Locked', visible: true, locked: true, gmOnly: false },
  ],
  entities: {
    w1: {
      id: 'w1',
      layerId: 'l1',
      origin: 'manual',
      rev: 1,
      type: 'wall',
      points: [
        { x: 0, y: 10 },
        { x: 20, y: 10 },
      ],
      blocksMove: true,
      blocksSight: true,
    },
    wLocked: {
      id: 'wLocked',
      layerId: 'l2',
      origin: 'manual',
      rev: 1,
      type: 'wall',
      points: [
        { x: 0, y: 20 },
        { x: 20, y: 20 },
      ],
      blocksMove: true,
      blocksSight: true,
    },
  },
  generators: {},
  revision: 1,
  deleted: {},
  fog: { enabled: false, revealed: [] },
};

describe('geom wallDoor', () => {
  it('snaps door placement onto an unlocked visible wall segment', () => {
    const placement = findDoorPlacementOnWall(baseMap, { x: 10, y: 10.2 }, 1, 2);
    expect(placement).not.toBeNull();
    expect(placement!.wallId).toBe('w1');
    expect(placement!.a).toEqual({ x: 9, y: 10 });
    expect(placement!.b).toEqual({ x: 11, y: 10 });
  });

  it('clamps door endpoints inside the wall segment and ignores locked walls', () => {
    const nearEnd = findDoorPlacementOnWall(baseMap, { x: 0.2, y: 10 }, 1, 2);
    expect(nearEnd!.a.x).toBeCloseTo(0, 5);
    expect(nearEnd!.b.x).toBeCloseTo(2, 5);

    const onLocked = findDoorPlacementOnWall(baseMap, { x: 10, y: 20 }, 1, 2);
    expect(onLocked).toBeNull();
  });
});
