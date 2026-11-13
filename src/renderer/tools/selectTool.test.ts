import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createWorldStore } from '../model/store';
import type { MapDoc, WorldMeta } from '../model/schema';
import { createSelectTool } from './selectTool';
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
      { id: 'l2', name: 'Locked', visible: true, locked: true, gmOnly: false },
    ],
    entities: {
      a1: {
        id: 'a1',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        type: 'area',
        role: 'floor',
        rings: [
          [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
        ],
      },
      p1: {
        id: 'p1',
        layerId: 'l1',
        origin: 'manual',
        rev: 1,
        type: 'prop',
        builtin: 'crate',
        x: 35,
        y: 15,
        rotation: 0,
        scale: 1,
        flipX: false,
      },
      lockedProp: {
        id: 'lockedProp',
        layerId: 'l2',
        origin: 'manual',
        rev: 1,
        type: 'prop',
        builtin: 'barrel',
        x: 15,
        y: 15,
        rotation: 0,
        scale: 1,
        flipX: false,
      },
    },
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  };
  store.getState().loadWorld(meta, { m1: map });

  let selectedIds: string[] = [];
  const tool = createSelectTool();
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

  return { store, tool, makeCtx, getSelected: () => selectedIds };
}

describe('SelectTool', () => {
  it('click selects, shift-click toggles, and ignores locked layer', () => {
    const { tool, makeCtx, getSelected } = makeFixture();
    // Click at (15,15) hits a1 (lockedProp on l2 is skipped)
    tool.onPointerDown({ x: 15, y: 15 }, makePointer(), makeCtx());
    tool.onPointerUp({ x: 15, y: 15 }, makePointer(), makeCtx());
    expect(getSelected()).toEqual(['a1']);

    // Shift-click p1 adds it
    tool.onPointerDown({ x: 35, y: 15 }, makePointer({ shiftKey: true }), makeCtx());
    tool.onPointerUp({ x: 35, y: 15 }, makePointer({ shiftKey: true }), makeCtx());
    expect(getSelected()).toEqual(['a1', 'p1']);

    // Shift-click a1 removes it
    tool.onPointerDown({ x: 15, y: 15 }, makePointer({ shiftKey: true }), makeCtx());
    tool.onPointerUp({ x: 15, y: 15 }, makePointer({ shiftKey: true }), makeCtx());
    expect(getSelected()).toEqual(['p1']);
  });

  it('box selects multiple unlocked entities', () => {
    const { tool, makeCtx, getSelected } = makeFixture();
    tool.onPointerDown({ x: 0, y: 0 }, makePointer(), makeCtx());
    tool.onPointerMove({ x: 40, y: 25 }, makePointer(), makeCtx());
    tool.onPointerUp({ x: 40, y: 25 }, makePointer(), makeCtx());
    expect(getSelected().sort()).toEqual(['a1', 'p1']);
  });

  it('moves selection as one undoable command and supports nudge, duplicate, delete', () => {
    const { store, tool, makeCtx, getSelected } = makeFixture();
    // Select p1 and drag it by (+5, +5)
    tool.onPointerDown({ x: 35, y: 15 }, makePointer(), makeCtx());
    tool.onPointerMove({ x: 40, y: 20 }, makePointer(), makeCtx());
    tool.onPointerUp({ x: 40, y: 20 }, makePointer(), makeCtx());

    let p1 = store.getState().world!.maps['m1']!.entities['p1']!;
    expect(p1.type === 'prop' && p1.x).toBe(40);
    expect(p1.type === 'prop' && p1.y).toBe(20);

    // Undo restores exact position
    store.getState().undo();
    p1 = store.getState().world!.maps['m1']!.entities['p1']!;
    expect(p1.type === 'prop' && p1.x).toBe(35);

    // Arrow nudge right (grid size = 2)
    tool.onKey(
      { key: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} } as unknown as KeyboardEvent,
      makeCtx(),
    );
    p1 = store.getState().world!.maps['m1']!.entities['p1']!;
    expect(p1.type === 'prop' && p1.x).toBe(37);

    // Duplicate (Ctrl+D)
    tool.onKey(
      { key: 'd', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false, preventDefault() {} } as unknown as KeyboardEvent,
      makeCtx(),
    );
    expect(getSelected().length).toBe(1);
    const dupId = getSelected()[0]!;
    expect(dupId).not.toBe('p1');
    expect(store.getState().world!.maps['m1']!.entities[dupId]).toBeDefined();

    // Delete duplicate
    tool.onKey(
      { key: 'Delete', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} } as unknown as KeyboardEvent,
      makeCtx(),
    );
    expect(getSelected()).toEqual([]);
    expect(store.getState().world!.maps['m1']!.entities[dupId]).toBeUndefined();

    // Overlay draws without throwing
    const gfx = new Graphics();
    tool.drawOverlay(gfx, makeCtx());
    gfx.destroy();
  });
});
