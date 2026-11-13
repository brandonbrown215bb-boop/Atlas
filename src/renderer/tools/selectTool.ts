import type { Graphics } from 'pixi.js';
import {
  boxSelectEntities,
  getSelectionBounds,
  pickTopEntity,
  type BBox,
} from '../geom/hitTest';
import {
  applyEntityPatch,
  rotateEntityPatch,
  scaleEntityPatch,
  translateEntityPatch,
} from '../geom/transform';
import type { Entity, MapDoc, Point } from '../model/schema';
import type { MapTool, ToolContext, ToolPointerEvent } from './types';

type ScaleHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface HandlePos {
  id: ScaleHandleId;
  x: number;
  y: number;
}

type DragState =
  | {
      mode: 'marquee';
      start: Point;
      current: Point;
      shiftKey: boolean;
    }
  | {
      mode: 'move';
      start: Point;
      snapshots: Entity[];
      moved: boolean;
    }
  | {
      mode: 'rotate';
      start: Point;
      pivot: Point;
      startAngle: number;
      snapshots: Entity[];
      moved: boolean;
    }
  | {
      mode: 'scale';
      handle: ScaleHandleId;
      pivot: Point;
      origWidth: number;
      origHeight: number;
      start: Point;
      snapshots: Entity[];
      moved: boolean;
    };

function getUnlockedVisibleEntities(
  map: MapDoc,
  ids: readonly string[],
): Entity[] {
  const layerMap = new Map(map.layers.map((l) => [l.id, l]));
  const result: Entity[] = [];
  for (const id of ids) {
    const entity = map.entities[id];
    if (!entity) continue;
    const layer = layerMap.get(entity.layerId);
    if (!layer || !layer.visible || layer.locked) continue;
    result.push(entity);
  }
  return result;
}

function getScaleHandles(b: BBox): HandlePos[] {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return [
    { id: 'nw', x: b.minX, y: b.minY },
    { id: 'n', x: cx, y: b.minY },
    { id: 'ne', x: b.maxX, y: b.minY },
    { id: 'e', x: b.maxX, y: cy },
    { id: 'se', x: b.maxX, y: b.maxY },
    { id: 's', x: cx, y: b.maxY },
    { id: 'sw', x: b.minX, y: b.maxY },
    { id: 'w', x: b.minX, y: cy },
  ];
}

function getRotateHandle(b: BBox, zoom: number): Point {
  const cx = (b.minX + b.maxX) / 2;
  const stem = 24 / Math.max(0.0005, zoom);
  return { x: cx, y: b.minY - stem };
}

function getOppositePivot(b: BBox, handle: ScaleHandleId): Point {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  switch (handle) {
    case 'nw':
      return { x: b.maxX, y: b.maxY };
    case 'n':
      return { x: cx, y: b.maxY };
    case 'ne':
      return { x: b.minX, y: b.maxY };
    case 'e':
      return { x: b.minX, y: cy };
    case 'se':
      return { x: b.minX, y: b.minY };
    case 's':
      return { x: cx, y: b.minY };
    case 'sw':
      return { x: b.maxX, y: b.minY };
    case 'w':
      return { x: b.maxX, y: cy };
  }
}

export function createSelectTool(): MapTool {
  let drag: DragState | null = null;
  let pendingPatches = new Map<string, Record<string, unknown>>();
  let previewEntities = new Map<string, Entity>();

  const clearPreview = () => {
    pendingPatches.clear();
    previewEntities.clear();
  };

  return {
    id: 'select',

    getPreviewEntities() {
      return previewEntities.size > 0 ? previewEntities : null;
    },

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      clearPreview();
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      const tolerance = 8 / zoom;
      const selectedEntities = getUnlockedVisibleEntities(
        ctx.map,
        ctx.getSelectedIds(),
      );
      const bounds = getSelectionBounds(selectedEntities);

      if (bounds && selectedEntities.length > 0) {
        const rotHandle = getRotateHandle(bounds, zoom);
        if (Math.hypot(pt.x - rotHandle.x, pt.y - rotHandle.y) <= tolerance * 1.2) {
          const pivot = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          };
          drag = {
            mode: 'rotate',
            start: pt,
            pivot,
            startAngle: Math.atan2(pt.y - pivot.y, pt.x - pivot.x),
            snapshots: selectedEntities,
            moved: false,
          };
          return true;
        }

        for (const h of getScaleHandles(bounds)) {
          if (
            Math.abs(pt.x - h.x) <= tolerance &&
            Math.abs(pt.y - h.y) <= tolerance
          ) {
            drag = {
              mode: 'scale',
              handle: h.id,
              pivot: getOppositePivot(bounds, h.id),
              origWidth: Math.max(0.05, bounds.maxX - bounds.minX),
              origHeight: Math.max(0.05, bounds.maxY - bounds.minY),
              start: pt,
              snapshots: selectedEntities,
              moved: false,
            };
            return true;
          }
        }
      }

      const hit = pickTopEntity(ctx.map, pt, tolerance);
      if (hit) {
        const current = ctx.getSelectedIds();
        if (e.shiftKey) {
          if (current.includes(hit.id)) {
            ctx.setSelectedIds(current.filter((id) => id !== hit.id));
          } else {
            ctx.setSelectedIds([...current, hit.id]);
          }
          ctx.requestRedraw();
          return true;
        }
        const nextSelection = current.includes(hit.id) ? current : [hit.id];
        if (!current.includes(hit.id)) {
          ctx.setSelectedIds(nextSelection);
        }
        const movable = getUnlockedVisibleEntities(ctx.map, nextSelection);
        if (movable.length > 0) {
          drag = {
            mode: 'move',
            start: pt,
            snapshots: movable,
            moved: false,
          };
        }
        ctx.requestRedraw();
        return true;
      }

      if (!e.shiftKey) {
        ctx.setSelectedIds([]);
      }
      drag = {
        mode: 'marquee',
        start: pt,
        current: pt,
        shiftKey: e.shiftKey,
      };
      ctx.requestRedraw();
      return true;
    },

    onPointerMove(pt, e, ctx) {
      if (!drag) {
        return;
      }

      if (drag.mode === 'marquee') {
        drag.current = pt;
        ctx.requestRedraw();
        return;
      }

      const distMoved = Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y);
      if (distMoved > 1 / Math.max(0.0005, ctx.camera.zoom)) {
        drag.moved = true;
      }
      if (!drag.moved) {
        return;
      }

      pendingPatches.clear();
      previewEntities.clear();

      if (drag.mode === 'move') {
        const dx = pt.x - drag.start.x;
        const dy = pt.y - drag.start.y;
        for (const entity of drag.snapshots) {
          const patch = translateEntityPatch(entity, dx, dy);
          pendingPatches.set(entity.id, patch);
          previewEntities.set(entity.id, applyEntityPatch(entity, patch));
        }
      } else if (drag.mode === 'rotate') {
        const currentAngle = Math.atan2(
          pt.y - drag.pivot.y,
          pt.x - drag.pivot.x,
        );
        let deltaAngle = currentAngle - drag.startAngle;
        if (e.shiftKey) {
          const step = Math.PI / 12; // 15 degrees
          deltaAngle = Math.round(deltaAngle / step) * step;
        }
        for (const entity of drag.snapshots) {
          const patch = rotateEntityPatch(entity, drag.pivot, deltaAngle);
          pendingPatches.set(entity.id, patch);
          previewEntities.set(entity.id, applyEntityPatch(entity, patch));
        }
      } else if (drag.mode === 'scale') {
        let sx = 1;
        let sy = 1;
        const dxFromPivot = pt.x - drag.pivot.x;
        const dyFromPivot = pt.y - drag.pivot.y;
        const startDx = drag.start.x - drag.pivot.x;
        const startDy = drag.start.y - drag.pivot.y;

        if (drag.handle.includes('e') || drag.handle.includes('w')) {
          if (Math.abs(startDx) > 1e-4) {
            sx = Math.max(0.05, dxFromPivot / startDx);
          }
        }
        if (drag.handle.includes('n') || drag.handle.includes('s')) {
          if (Math.abs(startDy) > 1e-4) {
            sy = Math.max(0.05, dyFromPivot / startDy);
          }
        }
        if (
          e.shiftKey &&
          (drag.handle === 'nw' ||
            drag.handle === 'ne' ||
            drag.handle === 'se' ||
            drag.handle === 'sw')
        ) {
          const uniform = Math.max(sx, sy);
          sx = uniform;
          sy = uniform;
        }

        for (const entity of drag.snapshots) {
          const patch = scaleEntityPatch(entity, drag.pivot, sx, sy);
          pendingPatches.set(entity.id, patch);
          previewEntities.set(entity.id, applyEntityPatch(entity, patch));
        }
      }

      ctx.requestRedraw();
    },

    onPointerUp(_pt, e, ctx) {
      if (!drag) {
        return;
      }
      const activeDrag = drag;
      drag = null;

      if (activeDrag.mode === 'marquee') {
        const box: BBox = {
          minX: Math.min(activeDrag.start.x, activeDrag.current.x),
          minY: Math.min(activeDrag.start.y, activeDrag.current.y),
          maxX: Math.max(activeDrag.start.x, activeDrag.current.x),
          maxY: Math.max(activeDrag.start.y, activeDrag.current.y),
        };
        const minSize = 3 / Math.max(0.0005, ctx.camera.zoom);
        if (box.maxX - box.minX >= minSize || box.maxY - box.minY >= minSize) {
          const hits = boxSelectEntities(ctx.map, box);
          if (e.shiftKey || activeDrag.shiftKey) {
            const merged = new Set([...ctx.getSelectedIds(), ...hits]);
            ctx.setSelectedIds(Array.from(merged));
          } else {
            ctx.setSelectedIds(hits);
          }
        }
        ctx.requestRedraw();
        return;
      }

      if (activeDrag.moved && pendingPatches.size > 0) {
        const calls = Array.from(pendingPatches.entries()).map(
          ([entityId, patch]) => ({
            name: 'entity.update',
            input: { mapId: ctx.map.id, entityId, patch },
          }),
        );
        clearPreview();
        ctx.executeBatch(calls, `select.${activeDrag.mode}`);
      } else {
        clearPreview();
      }
      ctx.requestRedraw();
    },

    onKey(e, ctx) {
      if (e.key === 'Escape') {
        if (drag) {
          drag = null;
          clearPreview();
          ctx.requestRedraw();
          return true;
        }
        if (ctx.getSelectedIds().length > 0) {
          ctx.setSelectedIds([]);
          ctx.requestRedraw();
          return true;
        }
        return false;
      }

      const selectedEntities = getUnlockedVisibleEntities(
        ctx.map,
        ctx.getSelectedIds(),
      );
      if (selectedEntities.length === 0) {
        return false;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const calls = selectedEntities.map((entity) => ({
          name: 'entity.delete',
          input: { mapId: ctx.map.id, entityId: entity.id },
        }));
        ctx.executeBatch(calls, 'select.delete');
        ctx.setSelectedIds([]);
        return true;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const step = ctx.map.grid.size > 0 ? ctx.map.grid.size : 1;
        const result = ctx.execute('entity.duplicate', {
          mapId: ctx.map.id,
          entityIds: selectedEntities.map((ent) => ent.id),
          dx: step,
          dy: step,
        }) as { ids?: string[] } | undefined;
        if (result?.ids) {
          ctx.setSelectedIds(result.ids);
        }
        return true;
      }

      let dx = 0;
      let dy = 0;
      const baseStep = ctx.map.grid.size > 0 ? ctx.map.grid.size : 1;
      const step = e.shiftKey
        ? baseStep * 5
        : e.altKey
          ? baseStep * 0.25
          : baseStep;

      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        const calls = selectedEntities.map((entity) => ({
          name: 'entity.update',
          input: {
            mapId: ctx.map.id,
            entityId: entity.id,
            patch: translateEntityPatch(entity, dx, dy),
          },
        }));
        ctx.executeBatch(calls, 'select.nudge');
        return true;
      }

      return false;
    },

    drawOverlay(gfx, ctx) {
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      const strokeW = 1.5 / zoom;
      const handleSize = 8 / zoom;

      if (drag && drag.mode === 'marquee') {
        const x = Math.min(drag.start.x, drag.current.x);
        const y = Math.min(drag.start.y, drag.current.y);
        const w = Math.abs(drag.current.x - drag.start.x);
        const h = Math.abs(drag.current.y - drag.start.y);
        gfx
          .rect(x, y, w, h)
          .fill({ color: 0x38bdf8, alpha: 0.12 })
          .stroke({ width: strokeW, color: 0x38bdf8, alpha: 0.9 });
      }

      const selectedEntities = getUnlockedVisibleEntities(
        ctx.map,
        ctx.getSelectedIds(),
      ).map((ent) => previewEntities.get(ent.id) ?? ent);

      const bounds = getSelectionBounds(selectedEntities);
      if (!bounds) {
        return;
      }

      const bw = bounds.maxX - bounds.minX;
      const bh = bounds.maxY - bounds.minY;
      gfx
        .rect(bounds.minX, bounds.minY, bw, bh)
        .stroke({ width: strokeW, color: 0xfbbf24, alpha: 0.95 });

      for (const h of getScaleHandles(bounds)) {
        gfx
          .rect(
            h.x - handleSize / 2,
            h.y - handleSize / 2,
            handleSize,
            handleSize,
          )
          .fill({ color: 0x111827 })
          .stroke({ width: strokeW, color: 0xfbbf24 });
      }

      const rot = getRotateHandle(bounds, zoom);
      const topCenterX = (bounds.minX + bounds.maxX) / 2;
      gfx
        .moveTo(topCenterX, bounds.minY)
        .lineTo(rot.x, rot.y)
        .stroke({ width: strokeW, color: 0xfbbf24 });
      gfx
        .circle(rot.x, rot.y, handleSize * 0.65)
        .fill({ color: 0xfbbf24 })
        .stroke({ width: strokeW, color: 0x111827 });
    },
  };
}
