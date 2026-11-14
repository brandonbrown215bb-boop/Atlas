import { Graphics } from 'pixi.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapDocSchema } from '../model/schema';
import { viewStore } from '../model/viewStore';
import { createMeasureTool, getMeasurement } from './measureTool';
import type { ToolContext, ToolPointerEvent } from './types';

const pointer: ToolPointerEvent = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
function context(panelId = 'p', mapId = 'm', worldId = 'w'): ToolContext {
  return {
    panelId, worldId,
    map: MapDocSchema.parse({ formatVersion: 1, id: mapId, name: 'Map', kind: 'site', bounds: { x: 0, y: 0, w: 100, h: 100 }, grid: { size: 1.524, visible: false }, layers: [], entities: {}, generators: {}, revision: 1, deleted: {}, fog: { enabled: false, revealed: [] } }),
    camera: { x: 0, y: 0, zoom: 1 }, getSelectedIds: () => [], setSelectedIds: vi.fn(), execute: vi.fn(), executeBatch: vi.fn(), requestRedraw: vi.fn(),
  };
}
const key = (key: string) => ({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent);

describe('measure tool', () => {
  beforeEach(() => viewStore.setState({ measurements: {} }));
  it('previews, finishes without a duplicate endpoint, starts a new route and never edits the world', () => {
    const tool = createMeasureTool();
    const ctx = context();
    tool.onPointerDown({ x: 0, y: 0 }, pointer, ctx);
    tool.onPointerMove({ x: 10, y: 10 }, pointer, ctx);
    expect(getMeasurement(ctx)?.hover).toEqual({ x: 10, y: 10 });
    tool.onPointerDown({ x: 10, y: 10 }, pointer, ctx);
    tool.onPointerDown({ x: 10, y: 10 }, { ...pointer, detail: 2 }, ctx);
    expect(getMeasurement(ctx)).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], finished: true, hover: null });
    tool.onPointerMove({ x: 50, y: 50 }, pointer, ctx);
    expect(getMeasurement(ctx)?.hover).toBeNull();
    tool.onPointerDown({ x: 20, y: 30 }, pointer, ctx);
    expect(getMeasurement(ctx)?.points).toEqual([{ x: 20, y: 30 }]);
    expect(ctx.execute).not.toHaveBeenCalled();
    expect(ctx.executeBatch).not.toHaveBeenCalled();
  });
  it('handles Enter, Backspace and Escape, and keeps routes out of other maps/worlds/panels', () => {
    const tool = createMeasureTool();
    const ctx = context();
    tool.onPointerDown({ x: 0, y: 0 }, pointer, ctx);
    tool.onPointerDown({ x: 10, y: 0 }, pointer, ctx);
    tool.onKey(key('Enter'), ctx);
    expect(getMeasurement(ctx)?.finished).toBe(true);
    expect(getMeasurement(context('p', 'other'))).toBeNull();
    expect(getMeasurement(context('p', 'm', 'other-world'))).toBeNull();
    expect(getMeasurement(context('other-panel'))).toBeNull();
    tool.onKey(key('Backspace'), ctx);
    expect(getMeasurement(ctx)).toMatchObject({ finished: false, points: [{ x: 0, y: 0 }] });
    tool.onKey(key('Escape'), ctx);
    expect(getMeasurement(ctx)).toBeNull();
  });
  it('draws relative to the route origin and survives the tool being recreated for a popout', () => {
    const ctx = context();
    const tool = createMeasureTool();
    tool.onPointerDown({ x: 1e8, y: 1e8 }, pointer, ctx);
    tool.onPointerDown({ x: 1e8 + 100, y: 1e8 }, pointer, ctx);
    const gfx = new Graphics();
    const move = vi.spyOn(gfx, 'moveTo');
    const line = vi.spyOn(gfx, 'lineTo');
    createMeasureTool().drawOverlay(gfx, ctx);
    expect(gfx.position.x).toBe(1e8);
    expect(move).toHaveBeenCalledWith(0, 0);
    expect(line).toHaveBeenCalledWith(100, 0);
    gfx.destroy();
  });
});
