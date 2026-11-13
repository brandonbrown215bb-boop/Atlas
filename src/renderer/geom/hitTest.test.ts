import { describe, expect, it } from 'vitest';
import type { Entity, MapDoc } from '../model/schema';
import {
  boxSelectEntities,
  getEntityBounds,
  getSelectionBounds,
  hitTestEntity,
  pickTopEntity,
  pointInPolygon,
} from './hitTest';
import {
  applyEntityPatch,
  rotateEntityPatch,
  scaleEntityPatch,
  translateEntityPatch,
} from './transform';

function makeMap(entities: Entity[], layers?: MapDoc['layers']): MapDoc {
  const entityMap: Record<string, Entity> = {};
  for (const e of entities) {
    entityMap[e.id] = e;
  }
  return {
    formatVersion: 1,
    id: 'm1',
    name: 'Test Map',
    kind: 'site',
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    grid: { size: 1.524, visible: true },
    layers: layers ?? [
      { id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false },
      { id: 'l2', name: 'Top', visible: true, locked: false, gmOnly: false },
    ],
    entities: entityMap,
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };
}

describe('geom hitTest', () => {
  it('detects point in polygon with holes', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const hole = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, [outer, hole])).toBe(true);
    expect(pointInPolygon({ x: 10, y: 10 }, [outer, hole])).toBe(false);
    expect(pointInPolygon({ x: 25, y: 10 }, [outer, hole])).toBe(false);
  });

  it('hit-tests rotated image entities accurately', () => {
    const img: Entity = {
      id: 'img1',
      layerId: 'l1',
      origin: 'manual',
      rev: 1,
      type: 'image',
      assetId: 'a1',
      x: 10,
      y: 10,
      w: 10,
      h: 4,
      rotation: Math.PI / 2,
    };
    // Rotated +90deg around (10,10): (0..10, 0..4) maps to (6..10, 10..20)
    expect(hitTestEntity(img, { x: 8, y: 15 }, 0.2)).toBe(true);
    expect(hitTestEntity(img, { x: 15, y: 12 }, 0.2)).toBe(false);
  });

  it('picks topmost visible unlocked entity and ignores hidden/locked layers', () => {
    const bottom: Entity = {
      id: 'a1',
      layerId: 'l1',
      origin: 'manual',
      rev: 1,
      type: 'area',
      role: 'land',
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
      ],
    };
    const top: Entity = {
      id: 'a2',
      layerId: 'l2',
      origin: 'manual',
      rev: 1,
      type: 'area',
      role: 'floor',
      rings: [
        [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 },
        ],
      ],
    };

    const m1 = makeMap([bottom, top]);
    expect(pickTopEntity(m1, { x: 10, y: 10 }, 0.5)?.id).toBe('a2');

    const mLockedTop = makeMap([bottom, top], [
      { id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false },
      { id: 'l2', name: 'Top', visible: true, locked: true, gmOnly: false },
    ]);
    expect(pickTopEntity(mLockedTop, { x: 10, y: 10 }, 0.5)?.id).toBe('a1');

    const mHiddenAll = makeMap([bottom, top], [
      { id: 'l1', name: 'Base', visible: false, locked: false, gmOnly: false },
      { id: 'l2', name: 'Top', visible: false, locked: false, gmOnly: false },
    ]);
    expect(pickTopEntity(mHiddenAll, { x: 10, y: 10 }, 0.5)).toBeNull();
  });

  it('box selects only visible unlocked entities', () => {
    const e1: Entity = {
      id: 'p1',
      layerId: 'l1',
      origin: 'manual',
      rev: 1,
      type: 'prop',
      builtin: 'crate',
      x: 10,
      y: 10,
      rotation: 0,
      scale: 1,
      flipX: false,
    };
    const e2: Entity = {
      id: 'p2',
      layerId: 'l2',
      origin: 'manual',
      rev: 1,
      type: 'prop',
      builtin: 'barrel',
      x: 12,
      y: 12,
      rotation: 0,
      scale: 1,
      flipX: false,
    };
    const m = makeMap([e1, e2], [
      { id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false },
      { id: 'l2', name: 'Top', visible: true, locked: true, gmOnly: false },
    ]);
    expect(boxSelectEntities(m, { minX: 0, minY: 0, maxX: 20, maxY: 20 })).toEqual(['p1']);
  });
});

describe('geom transform', () => {
  it('translates, rotates, and scales an area around pivot', () => {
    const area: Entity = {
      id: 'a1',
      layerId: 'l1',
      origin: 'generated',
      genId: 'g1',
      rev: 1,
      type: 'area',
      role: 'floor',
      rings: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
    };

    const moved = applyEntityPatch(area, translateEntityPatch(area, 5, -2));
    expect(getEntityBounds(moved)).toEqual({ minX: 5, minY: -2, maxX: 15, maxY: 8 });
    expect(moved.origin).toBe('manual');

    const rotated = applyEntityPatch(area, rotateEntityPatch(area, { x: 5, y: 5 }, Math.PI / 2));
    const rotBounds = getSelectionBounds([rotated])!;
    expect(rotBounds.minX).toBeCloseTo(0, 5);
    expect(rotBounds.maxX).toBeCloseTo(10, 5);

    const scaled = applyEntityPatch(area, scaleEntityPatch(area, { x: 0, y: 0 }, 2, 0.5));
    expect(getEntityBounds(scaled)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 5 });
  });
});
