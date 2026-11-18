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

  it('scales inherited world symbols down proportionally into smaller region rects', () => {
    const parent = makeParentMap();
    parent.kind = 'world';
    parent.entities.mtn = {
      id: 'mtn',
      type: 'prop',
      layerId: 'l1',
      origin: 'generated',
      rev: 1,
      symbolKind: 'mountain',
      builtin: 'mountain',
      x: 150,
      y: 150,
      w: 100,
      h: 100,
      scale: 1,
      rotation: 0,
      flipX: false,
    };
    const inherited = clipAndInheritEntities(parent, { x: 100, y: 100, w: 100, h: 100 }, 'child-l1');
    const mtn = inherited.find((e) => e.type === 'prop' && e.symbolKind === 'mountain');
    expect(mtn?.type === 'prop' && mtn.w).toBeLessThan(100);
    expect(mtn?.type === 'prop' && mtn.w).toBeCloseTo(22, 5);
  });

  it('draws inherited relief, roads and town labels at region scale', () => {
    const parent = makeParentMap();
    parent.kind = 'world';
    const prop = { layerId: 'l1', origin: 'generated' as const, rev: 1, scale: 1, rotation: 0, flipX: false };
    parent.entities.mtn = { ...prop, id: 'mtn', type: 'prop', symbolKind: 'mountain', x: 150, y: 150, w: 100, h: 100 };
    parent.entities.town = { ...prop, id: 'town', type: 'prop', symbolKind: 'settlement', name: 'Oldtown', x: 120, y: 180, w: 50, h: 50 };
    parent.entities.townLabel = { id: 'townLabel', type: 'label', layerId: 'l1', origin: 'generated', rev: 1, text: 'Oldtown', x: 120, y: 190, size: 16 };
    parent.entities.road1 = { ...parent.entities.road1!, routeTier: 'road' } as MapDoc['entities'][string];
    const inherited = clipAndInheritEntities(parent, { x: 100, y: 100, w: 100, h: 100 }, 'child-l1', undefined, 'region');
    const find = (id: string) => inherited.find((e) => e.inheritedFrom?.entityId === id);
    const [mtn, town, label, road] = ['mtn', 'town', 'townLabel', 'road1'].map(find);
    expect(mtn?.type === 'prop' && mtn.w).toBeCloseTo(12, 5); // 100 × 0.1 × 1.2
    expect(town?.type === 'prop' && town.w).toBeCloseTo(7, 5); // 50 × 0.1 × 1.4
    expect(road?.type === 'path' && road.width).toBeCloseTo(0.64, 5); // 4 × 0.1 × 1.6
    expect(label?.type === 'label' && label.y).toBeCloseTo(80 + 10 * 0.13, 5); // label pulled in toward its icon
  });

  it('makes a settlement child the town itself: adopts its Place, drops world icons and their labels, narrows roads', () => {
    const parent = makeParentMap();
    parent.kind = 'world';
    const prop = { layerId: 'l1', origin: 'generated' as const, rev: 1, scale: 1, rotation: 0, flipX: false };
    parent.entities.town = { ...prop, id: 'town', type: 'prop', symbolKind: 'settlement', name: 'Oldtown', x: 150, y: 150, w: 50, h: 50 };
    parent.entities.townLabel = { id: 'townLabel', type: 'label', layerId: 'l1', origin: 'generated', rev: 1, text: 'Oldtown', x: 150, y: 165, size: 16 };
    parent.entities.road1 = { ...parent.entities.road1!, width: 572 } as MapDoc['entities'][string];
    parent.entities.townPlace = { id: 'townPlace', type: 'place', layerId: 'l1', origin: 'generated', rev: 1, name: 'Oldtown', category: 'Settlement',
      notes: 'Village known for dark ale. Trouble: bandits tax the road. (Heartland (Low Risk))', gmNotes: '', rumours: ['A rumour.'], entityIds: ['town', 'townLabel'] };
    const inherited = clipAndInheritEntities(parent, { x: 100, y: 100, w: 100, h: 100 }, 'child-l1', undefined, 'settlement');
    expect(inherited.some(e => e.type === 'prop')).toBe(false);
    // The town's own label goes with its icon; other labels (a GM's note) stay.
    expect(inherited.filter(e => e.type === 'label').map(e => e.type === 'label' && e.text)).toEqual(['Inside']);
    const place = inherited.find(e => e.type === 'place');
    expect(place).toMatchObject({ name: 'Oldtown', origin: 'inherited', entityIds: [], rumours: ['A rumour.'] });
    const road = inherited.find(e => e.inheritedFrom?.entityId === 'road1');
    expect(road?.type === 'path' && road.width).toBe(9);
  });

  it('makes a site child the ruin itself: adopts its Place and drops its world icon', () => {
    const parent = makeParentMap();
    const prop = { layerId: 'l1', origin: 'generated' as const, rev: 1, scale: 1, rotation: 0, flipX: false };
    parent.entities.ruin = { ...prop, id: 'ruin', type: 'prop', symbolKind: 'ruin', builtin: 'ruin', name: 'Barrow of Ithmar', x: 150, y: 150, w: 50, h: 50 };
    parent.entities.ruinPlace = { id: 'ruinPlace', type: 'place', layerId: 'l1', origin: 'generated', rev: 1, name: 'Barrow of Ithmar', category: 'Ruin',
      notes: 'Ancient stonework.', gmNotes: 'Occupants: restless dead.', entityIds: ['ruin'] };
    const inherited = clipAndInheritEntities(parent, { x: 100, y: 100, w: 100, h: 100 }, 'child-l1', undefined, 'site');
    expect(inherited.some(e => e.type === 'prop')).toBe(false);
    expect(inherited.find(e => e.type === 'place')).toMatchObject({ name: 'Barrow of Ithmar', category: 'Ruin', origin: 'inherited', gmNotes: 'Occupants: restless dead.' });
  });
});
