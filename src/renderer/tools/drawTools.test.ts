import { describe, expect, it } from 'vitest';
import { createWorldStore } from '../model/store';
import type { MapDoc, WorldMeta } from '../model/schema';
import { viewStore } from '../model/viewStore';
import { createAreaTool } from './areaTool';
import { createPathTool } from './pathTool';
import type { ToolContext, ToolPointerEvent } from './types';

function makePointer(overrides: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

function makeFixture() {
  const store = createWorldStore();
  const meta: WorldMeta = {
    formatVersion: 1,
    id: 'w1',
    name: 'Test World',
    maps: [{ id: 'm1', name: 'Site', kind: 'site' }],
    themes: { default: {} },
  };
  const map: MapDoc = {
    formatVersion: 1,
    id: 'm1',
    name: 'Site',
    kind: 'site',
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    grid: { size: 2, visible: true },
    layers: [
      { id: 'l1', name: 'Base', visible: true, locked: false, gmOnly: false },
    ],
    entities: {},
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };
  store.getState().loadWorld(meta, { m1: map });

  let selectedIds: string[] = [];
  const makeCtx = (): ToolContext => ({
    panelId: 'map-1',
    map: store.getState().world!.maps['m1']!,
    camera: { x: 0, y: 0, zoom: 10 },
    getSelectedIds: () => selectedIds,
    setSelectedIds: (ids) => {
      selectedIds = ids;
    },
    execute: (name, input) => store.getState().execute(name, input),
    executeBatch: (calls, label) => store.getState().executeBatch(calls, label),
    requestRedraw: () => {},
  });

  return { store, makeCtx, getSelected: () => selectedIds };
}

describe('AreaTool & PathTool', () => {
  it('areaTool places points, snaps to grid, and finishes on double-click', () => {
    viewStore.getState().setDrawMode('click');
    viewStore.getState().setSnapToGrid(true);
    viewStore.getState().setAreaRole('district');

    const { store, makeCtx } = makeFixture();
    const areaTool = createAreaTool();

    areaTool.onPointerDown({ x: 0.2, y: 0.3 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 9.8, y: 0.1 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 10.1, y: 9.9 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 10.1, y: 9.9 }, makePointer({ detail: 2 }), makeCtx());

    const entities = Object.values(store.getState().world!.maps['m1']!.entities);
    expect(entities).toHaveLength(1);
    const area = entities[0]!;
    expect(area.type).toBe('area');
    if (area.type === 'area') {
      expect(area.role).toBe('district');
      expect(area.rings[0]).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]);
    }
  });

  it('pathTool creates smoothed path in freehand mode', () => {
    viewStore.getState().setDrawMode('freehand');
    viewStore.getState().setSnapToGrid(false);
    viewStore.getState().setPathRole('river');
    viewStore.getState().setPathWidth(4);
    viewStore.getState().setPathClosed(false);

    const { store, makeCtx } = makeFixture();
    const pathTool = createPathTool();

    pathTool.onPointerDown({ x: 0, y: 0 }, makePointer(), makeCtx());
    pathTool.onPointerMove({ x: 5, y: 0.1 }, makePointer(), makeCtx());
    pathTool.onPointerMove({ x: 10, y: 0 }, makePointer(), makeCtx());
    pathTool.onPointerMove({ x: 15, y: 5 }, makePointer(), makeCtx());
    pathTool.onPointerUp({ x: 15, y: 5 }, makePointer(), makeCtx());

    const entities = Object.values(store.getState().world!.maps['m1']!.entities);
    expect(entities).toHaveLength(1);
    const path = entities[0]!;
    expect(path.type).toBe('path');
    if (path.type === 'path') {
      expect(path.role).toBe('river');
      expect(path.width).toBe(4);
      expect(path.points.length).toBeGreaterThanOrEqual(2);
    }

    // Reset viewStore defaults
    viewStore.getState().setDrawMode('click');
    viewStore.getState().setSnapToGrid(false);
  });
});
