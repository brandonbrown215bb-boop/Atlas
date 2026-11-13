import { describe, expect, it } from 'vitest';
import type { MapDoc } from '../model/schema';
import { mapToScreen } from '../render/camera';
import {
  childMapParentRect,
  childToParentCamera,
  findZoomInChild,
  parentToChildCamera,
  shouldDrawChildInline,
  shouldZoomOutToParent,
} from './childMaps';

function makeChildMap(overrides: Partial<MapDoc> = {}): MapDoc {
  return {
    formatVersion: 1,
    id: 'child-1',
    name: 'Town',
    kind: 'settlement',
    parent: { mapId: 'parent-1', x: 200, y: 100, rotation: 0 },
    bounds: { x: 0, y: 0, w: 400, h: 300 },
    grid: { size: 5, visible: true },
    layers: [{ id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false }],
    entities: {},
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
    ...overrides,
  };
}

describe('childMaps continuous zoom and inline helpers', () => {
  it('excludes interiors from inline parent rect', () => {
    const settlement = makeChildMap({ kind: 'settlement' });
    const interior = makeChildMap({ kind: 'interior' });
    expect(childMapParentRect(settlement)).toEqual({ x: 200, y: 100, w: 400, h: 300 });
    expect(childMapParentRect(interior)).toBeNull();
  });

  it('draws child inline only when on-screen and larger than 64px', () => {
    const rect = { x: 200, y: 100, w: 400, h: 300 };
    expect(shouldDrawChildInline({ x: 0, y: 0, zoom: 0.1 }, rect, 800, 600)).toBe(false);
    expect(shouldDrawChildInline({ x: 0, y: 0, zoom: 0.5 }, rect, 800, 600)).toBe(true);
    expect(shouldDrawChildInline({ x: -1000, y: 0, zoom: 0.5 }, rect, 800, 600)).toBe(false);
  });

  it('preserves exact screen position across parent <-> child camera conversion', () => {
    const parentCam = { x: -300, y: -150, zoom: 2 };
    const childParent = { x: 200, y: 100 };
    const childCam = parentToChildCamera(parentCam, childParent, 'settlement');

    const parentScreen = mapToScreen(parentCam, 250, 140);
    const childScreen = mapToScreen(childCam, 50, 40);
    expect(childScreen.x).toBeCloseTo(parentScreen.x, 6);
    expect(childScreen.y).toBeCloseTo(parentScreen.y, 6);

    const back = childToParentCamera(childCam, childParent, 'region');
    expect(back.zoom).toBe(0.2); // clamped to region max (1/5 = 0.2)
  });

  it('detects zoom-in child when covering most of viewport and zoom-out when smaller than bounds', () => {
    const child = makeChildMap();
    const camZoomedIn = { x: -350, y: -150, zoom: 2 };
    expect(findZoomInChild(camZoomedIn, 'region', [child], 800, 600)?.id).toBe('child-1');

    const camZoomedOut = { x: 250, y: 200, zoom: 0.5 };
    expect(shouldZoomOutToParent(camZoomedOut, child, 800, 600)).toBe(true);
  });
});
