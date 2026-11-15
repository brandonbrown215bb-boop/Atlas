import { describe, expect, it } from 'vitest';
import { createWorldStore } from '../model/store';
import type { MapDoc, WorldMeta } from '../model/schema';
import { viewStore } from '../model/viewStore';
import { createAreaTool } from './areaTool';
import { createDoorTool } from './doorTool';
import { createLabelTool } from './labelTool';
import { createLightTool } from './lightTool';
import { createPathTool } from './pathTool';
import { createPointEditTool } from './pointEditTool';
import { createWallTool } from './wallTool';
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
    worldId: 'w1',
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
  it('selects an individual building after entering Edit parts with the whole group selected', () => {
    const f = makeFixture();
    for (const [id, x] of [['left', 10], ['right', 50]] as const) f.store.getState().execute('entity.add', { mapId: 'm1', entity: {
      id, type: 'area', role: 'building', groupId: 'town', layerId: 'l1', origin: 'generated', rev: 0,
      rings: [[{ x, y: 10 }, { x: x + 20, y: 10 }, { x: x + 20, y: 30 }, { x, y: 30 }]],
    } });
    f.makeCtx().setSelectedIds(['left', 'right']);
    viewStore.setState({ editParts: true });
    try {
      createSelectTool().onPointerDown({ x: 20, y: 20 }, makePointer(), f.makeCtx());
      expect(f.getSelected()).toEqual(['left']);
    } finally { viewStore.setState({ editParts: false }); }
  });
  it.each([
    ['area', createAreaTool, 3],
    ['path', createPathTool, 2],
    ['wall', createWallTool, 2],
  ] as const)('%s undoes draft points, redoes them, and protects map history until finished or cancelled', (_name, createTool, minimum) => {
    viewStore.getState().setDrawMode('click');
    viewStore.getState().setSnapToGrid(false);
    viewStore.getState().setWallSnapToGrid(false);
    const { store, makeCtx } = makeFixture();
    store.getState().execute('layer.add', { mapId: 'm1', layer: {
      id: 'land', name: 'Land', visible: true, locked: false, gmOnly: false,
    } });
    const before = store.getState();
    const tool = createTool();
    const key = (value: string, ctrlKey = true, shiftKey = false) => {
      let prevented = false;
      const handled = tool.onKey({ key: value, ctrlKey, shiftKey,
        preventDefault() { prevented = true; },
      } as KeyboardEvent, makeCtx());
      if (handled && ctrlKey) expect(prevented).toBe(true);
      return handled;
    };
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
    for (const point of points) tool.onPointerDown(point, makePointer(), makeCtx());
    for (let i = 0; i < points.length + 2; i++) expect(key('z')).toBe(true);
    expect(key('Enter', false)).toBe(false);
    expect(store.getState().world).toBe(before.world);
    expect(store.getState().history).toBe(before.history);
    // Both redo shortcuts restore points; a new point discards the old branch.
    expect(key('y')).toBe(true);
    expect(key('Z', true, true)).toBe(true);
    expect(key('Backspace', false)).toBe(true);
    tool.onPointerDown({ x: 40, y: 0 }, makePointer(), makeCtx());
    expect(key('y')).toBe(true);
    if (minimum === 3) tool.onPointerDown({ x: 40, y: 40 }, makePointer(), makeCtx());
    expect(key('Enter', false)).toBe(true);
    const entity = Object.values(store.getState().world!.maps.m1!.entities)[0]!;
    const drawnPoints = entity.type === 'area' ? entity.rings[0] :
      entity.type === 'path' || entity.type === 'wall' ? entity.points : [];
    expect(drawnPoints).toEqual(minimum === 3 ?
      [points[0], { x: 40, y: 0 }, { x: 40, y: 40 }] :
      [points[0], { x: 40, y: 0 }]);
    expect(key('z')).toBe(false); // Finished drawing returns to world Undo.
    tool.onPointerDown({ x: 60, y: 60 }, makePointer(), makeCtx());
    expect(key('z')).toBe(true);
    expect(key('Escape', false)).toBe(true);
    expect(key('z')).toBe(false);
    viewStore.getState().setWallSnapToGrid(true);
  });

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

  it('pointEditTool drags vertex, inserts on segment, deletes vertex, and carves a hole', () => {
    viewStore.getState().setSnapToGrid(false);
    viewStore.getState().setPointEditMode('edit');

    const { store, makeCtx } = makeFixture();
    const areaTool = createAreaTool();
    viewStore.getState().setDrawMode('click');
    areaTool.onPointerDown({ x: 0, y: 0 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 20, y: 0 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 20, y: 20 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 0, y: 20 }, makePointer(), makeCtx());
    areaTool.onPointerDown({ x: 0, y: 20 }, makePointer({ detail: 2 }), makeCtx());

    const areaId = Object.keys(store.getState().world!.maps['m1']!.entities)[0]!;
    const pointEdit = createPointEditTool();

    // Drag vertex (20,0) -> (25,0)
    pointEdit.onPointerDown({ x: 20, y: 0 }, makePointer(), makeCtx());
    pointEdit.onPointerMove({ x: 25, y: 0 }, makePointer(), makeCtx());
    pointEdit.onPointerUp({ x: 25, y: 0 }, makePointer(), makeCtx());
    let ent = store.getState().world!.maps['m1']!.entities[areaId]!;
    expect(ent.type === 'area' && ent.rings[0]![1]).toEqual({ x: 25, y: 0 });

    // Click segment (0,0)-(25,0) at (12,0) to insert vertex, then delete it
    pointEdit.onPointerDown({ x: 12, y: 0 }, makePointer(), makeCtx());
    pointEdit.onPointerUp({ x: 12, y: 0 }, makePointer(), makeCtx());
    ent = store.getState().world!.maps['m1']!.entities[areaId]!;
    expect(ent.type === 'area' && ent.rings[0]).toHaveLength(5);

    pointEdit.onKey(
      { key: 'Delete', preventDefault() {} } as unknown as KeyboardEvent,
      makeCtx(),
    );
    ent = store.getState().world!.maps['m1']!.entities[areaId]!;
    expect(ent.type === 'area' && ent.rings[0]).toHaveLength(4);

    // Subtract mode: carve a hole
    viewStore.getState().setPointEditMode('subtract');
    pointEdit.onPointerDown({ x: 5, y: 5 }, makePointer(), makeCtx());
    pointEdit.onPointerDown({ x: 15, y: 5 }, makePointer(), makeCtx());
    pointEdit.onPointerDown({ x: 15, y: 15 }, makePointer(), makeCtx());
    pointEdit.onPointerDown({ x: 5, y: 15 }, makePointer(), makeCtx());
    const beforeCarve = store.getState();
    expect(pointEdit.onKey({ key: 'z', ctrlKey: true, preventDefault() {} } as KeyboardEvent, makeCtx())).toBe(true);
    expect(store.getState().world).toBe(beforeCarve.world);
    expect(store.getState().history).toBe(beforeCarve.history);
    expect(pointEdit.onKey({ key: 'y', ctrlKey: true, preventDefault() {} } as KeyboardEvent, makeCtx())).toBe(true);
    pointEdit.onPointerDown({ x: 5, y: 15 }, makePointer({ detail: 2 }), makeCtx());

    ent = store.getState().world!.maps['m1']!.entities[areaId]!;
    expect(ent.type === 'area' && ent.rings).toHaveLength(2);

    viewStore.getState().setPointEditMode('edit');
  });

  it('wallTool snaps to grid by default, doorTool places secret door on wall, lightTool and labelTool place entities', () => {
    const { store, makeCtx } = makeFixture();
    const wallTool = createWallTool();
    const doorTool = createDoorTool();
    const lightTool = createLightTool();
    const labelTool = createLabelTool();

    // Wall snaps to grid (size = 2)
    wallTool.onPointerDown({ x: 0.3, y: 9.7 }, makePointer(), makeCtx());
    wallTool.onPointerDown({ x: 19.6, y: 10.2 }, makePointer(), makeCtx());
    wallTool.onPointerDown({ x: 19.6, y: 10.2 }, makePointer({ detail: 2 }), makeCtx());

    const wall = Object.values(store.getState().world!.maps['m1']!.entities).find(
      (e) => e.type === 'wall',
    );
    expect(wall).toBeDefined();
    if (wall?.type === 'wall') {
      expect(wall.points).toEqual([
        { x: 0, y: 10 },
        { x: 20, y: 10 },
      ]);
    }

    // Secret door placed on the wall
    viewStore.getState().setDoorKind('secret');
    const placed = doorTool.onPointerDown({ x: 10, y: 10.3 }, makePointer(), makeCtx());
    expect(placed).toBe(true);
    const door = Object.values(store.getState().world!.maps['m1']!.entities).find(
      (e) => e.type === 'door',
    );
    expect(door).toBeDefined();
    if (door?.type === 'door') {
      expect(door.kind).toBe('secret');
      expect(door.gmOnly).toBe(true);
      expect(door.a.y).toBe(10);
      expect(door.b.y).toBe(10);
    }

    // Light and label
    viewStore.getState().setLightRadius(12);
    lightTool.onPointerDown({ x: 5, y: 5 }, makePointer(), makeCtx());
    viewStore.getState().setLabelText('Crypt');
    labelTool.onPointerDown({ x: 8, y: 8 }, makePointer(), makeCtx());

    const entities = Object.values(store.getState().world!.maps['m1']!.entities);
    expect(entities.some((e) => e.type === 'light' && e.radius === 12)).toBe(true);
    expect(entities.some((e) => e.type === 'label' && e.text === 'Crypt')).toBe(true);

    viewStore.getState().setDoorKind('door');
  });
});
