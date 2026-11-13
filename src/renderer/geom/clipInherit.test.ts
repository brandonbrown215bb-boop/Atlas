import { describe, expect, it } from 'vitest';
import type { MapDoc } from '../model/schema';
import {
  clipAndInheritEntities,
  clipPolylineToRect,
  clipSegmentToRect,
} from './clipInherit';

function makeParentMap(): MapDoc {
  return {
    formatVersion: 1,
    id: 'parent-1',
    name: 'Parent',
    kind: 'region',
    bounds: { x: 0, y: 0, w: 1000, h: 1000 },
    grid: { size: 100, visible: false },
    layers: [
      { id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false },
    ],
    entities: {
      land1: {
        id: 'land1',
        type: 'area',
        layerId: 'l1',
        origin: 'manual',
        rev: 3,
        role: 'land',
        rings: [
          [
            { x: 50, y: 50 },
            { x: 250, y: 50 },
            { x: 250, y: 250 },
            { x: 50, y: 250 },
          ],
        ],
      },
      road1: {
        id: 'road1',
        type: 'path',
        layerId: 'l1',
        origin: 'manual',
        rev: 2,
        role: 'road',
        width: 4,
        closed: false,
        points: [
          { x: 0, y: 150 },
          { x: 300, y: 150 },
        ],
      },
      labelIn: {
        id: 'labelIn',
        type: 'label',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        text: 'Inside',
        x: 150,
        y: 120,
        size: 16,
      },
      labelOut: {
        id: 'labelOut',
        type: 'label',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        text: 'Outside',
        x: 500,
        y: 500,
        size: 16,
      },
    },
    generators: {},
    revision: 3,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };
}

describe('clipInherit', () => {
  it('clips segments and polylines to a rectangle', () => {
    const rect = { x: 100, y: 100, w: 100, h: 100 };
    expect(clipSegmentToRect({ x: 0, y: 150 }, { x: 300, y: 150 }, rect)).toEqual([
      { x: 100, y: 150 },
      { x: 200, y: 150 },
    ]);
    expect(clipSegmentToRect({ x: 0, y: 0 }, { x: 50, y: 50 }, rect)).toBeNull();

    const chains = clipPolylineToRect(
      [
        { x: 50, y: 150 },
        { x: 150, y: 150 },
        { x: 150, y: 250 },
      ],
      false,
      rect,
    );
    expect(chains).toEqual([
      [
        { x: 100, y: 150 },
        { x: 150, y: 150 },
        { x: 150, y: 200 },
      ],
    ]);
  });

  it('clips parent entities into child local coordinates with inheritedFrom metadata', () => {
    const parent = makeParentMap();
    let seq = 0;
    const inherited = clipAndInheritEntities(
      parent,
      { x: 100, y: 100, w: 100, h: 100 },
      'child-layer',
      () => `inh-${++seq}`,
    );

    const area = inherited.find((e) => e.type === 'area');
    expect(area).toBeDefined();
    expect(area?.origin).toBe('inherited');
    expect(area?.inheritedFrom).toEqual({ entityId: 'land1', parentRev: 3 });
    if (area?.type === 'area') {
      const xs = area.rings[0]!.map((p) => p.x);
      const ys = area.rings[0]!.map((p) => p.y);
      expect(Math.min(...xs)).toBeCloseTo(0, 6);
      expect(Math.max(...xs)).toBeCloseTo(100, 6);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...ys)).toBeCloseTo(100, 6);
    }

    const path = inherited.find((e) => e.type === 'path');
    expect(path).toBeDefined();
    if (path?.type === 'path') {
      expect(path.points).toEqual([
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ]);
      expect(path.inheritedFrom).toEqual({ entityId: 'road1', parentRev: 2 });
    }

    const labels = inherited.filter((e) => e.type === 'label');
    expect(labels).toHaveLength(1);
    if (labels[0]?.type === 'label') {
      expect(labels[0].text).toBe('Inside');
      expect(labels[0].x).toBe(50);
      expect(labels[0].y).toBe(20);
    }
  });
});
