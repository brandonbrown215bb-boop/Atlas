import type { Graphics } from 'pixi.js';
import { pickTopEntity } from '../geom/hitTest';
import {
  booleanAreaRings,
  deleteVertexPatch,
  findNearestSegment,
  findNearestVertex,
  getEntityPointLists,
  insertVertexPatch,
  isPointEditableEntity,
  moveVertexPatch,
} from '../geom/pointEdit';
import { snapPointToGrid } from '../geom/simplify';
import { applyEntityPatch } from '../geom/transform';
import type { Entity, MapDoc, Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import type { MapTool, ToolContext } from './types';

function getSingleEditableEntity(
  map: MapDoc,
  selectedIds: readonly string[],
): Entity | null {
  if (selectedIds.length !== 1) return null;
  const entity = map.entities[selectedIds[0]!];
  if (!entity || !isPointEditableEntity(entity)) return null;
  const layer = map.layers.find((l) => l.id === entity.layerId);
  if (!layer || !layer.visible || layer.locked) return null;
  return entity;
}

export function createPointEditTool(): MapTool {
  let activeVertex: {
    entityId: string;
    ringIndex: number;
    pointIndex: number;
  } | null = null;
  let draggingVertex: {
    entity: Entity;
    ringIndex: number;
    pointIndex: number;
    startPt: Point;
    moved: boolean;
  } | null = null;
  let pendingPatch: Record<string, unknown> | null = null;
  let previewMap = new Map<string, Entity>();

  // Boolean add/subtract clip polygon state
  let clipPoints: Point[] = [];
  let hoverPt: Point | null = null;
  let lastClickTime = 0;
  let lastClickPt: Point | null = null;

  const clearDrag = () => {
    draggingVertex = null;
    pendingPatch = null;
    previewMap.clear();
  };

  const clearClip = () => {
    clipPoints = [];
    lastClickTime = 0;
    lastClickPt = null;
  };

  const snapIfNeeded = (pt: Point, ctx: ToolContext): Point => {
    return viewStore.getState().snapToGrid
      ? snapPointToGrid(pt, ctx.map.grid.size)
      : pt;
  };

  const applyBooleanClip = (
    targetArea: Extract<Entity, { type: 'area' }>,
    ring: Point[],
    op: 'union' | 'difference',
    ctx: ToolContext,
  ) => {
    if (ring.length < 3) return;
    const result = booleanAreaRings(targetArea.rings, ring, op);
    if (result.length === 0) {
      ctx.execute('entity.delete', {
        mapId: ctx.map.id,
        entityId: targetArea.id,
      });
      ctx.setSelectedIds([]);
      return;
    }

    const calls: Array<{ name: string; input: unknown }> = [
      {
        name: 'entity.update',
        input: {
          mapId: ctx.map.id,
          entityId: targetArea.id,
          patch: { rings: result[0]! },
        },
      },
    ];
    const nextIds = [targetArea.id];
    for (let i = 1; i < result.length; i++) {
      const newId = `area-${crypto.randomUUID().slice(0, 8)}`;
      nextIds.push(newId);
      calls.push({
        name: 'entity.add',
        input: {
          mapId: ctx.map.id,
          entity: {
            id: newId,
            type: 'area',
            layerId: targetArea.layerId,
            origin: 'manual',
            rev: 0,
            role: targetArea.role,
            elevation: targetArea.elevation,
            fill: targetArea.fill,
            gmOnly: targetArea.gmOnly,
            rings: result[i]!,
          },
        },
      });
    }
    ctx.executeBatch(calls, `pointEdit.${op}`);
    ctx.setSelectedIds(nextIds);
  };

  return {
    id: 'pointEdit',

    getPreviewEntities() {
      return previewMap.size > 0 ? previewMap : null;
    },

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      const mode = viewStore.getState().pointEditMode;
      const snapped = snapIfNeeded(pt, ctx);
      hoverPt = snapped;
      const tol = 8 / Math.max(0.0005, ctx.camera.zoom);

      if (mode === 'add' || mode === 'subtract') {
        let target = getSingleEditableEntity(ctx.map, ctx.getSelectedIds());
        if (!target || target.type !== 'area') {
          const hit = pickTopEntity(ctx.map, pt, tol);
          if (hit && hit.type === 'area') {
            ctx.setSelectedIds([hit.id]);
            target = hit;
          }
        }
        if (!target || target.type !== 'area') {
          return false;
        }

        const now = Date.now();
        const isDoubleClick =
          (e.detail !== undefined && e.detail >= 2) ||
          (lastClickPt !== null &&
            now - lastClickTime < 350 &&
            Math.hypot(snapped.x - lastClickPt.x, snapped.y - lastClickPt.y) <= tol);
        lastClickTime = now;
        lastClickPt = snapped;

        if (isDoubleClick && clipPoints.length >= 3) {
          const ring = [...clipPoints];
          clearClip();
          applyBooleanClip(
            target,
            ring,
            mode === 'add' ? 'union' : 'difference',
            ctx,
          );
          ctx.requestRedraw();
          return true;
        }

        const prev = clipPoints[clipPoints.length - 1];
        if (!prev || prev.x !== snapped.x || prev.y !== snapped.y) {
          clipPoints.push(snapped);
        }
        ctx.requestRedraw();
        return true;
      }

      // Edit vertices mode
      clearDrag();
      const selected = getSingleEditableEntity(ctx.map, ctx.getSelectedIds());
      if (selected) {
        const vHit = findNearestVertex(selected, pt, tol);
        if (vHit) {
          activeVertex = {
            entityId: selected.id,
            ringIndex: vHit.ringIndex,
            pointIndex: vHit.pointIndex,
          };
          draggingVertex = {
            entity: selected,
            ringIndex: vHit.ringIndex,
            pointIndex: vHit.pointIndex,
            startPt: pt,
            moved: false,
          };
          ctx.requestRedraw();
          return true;
        }

        const sHit = findNearestSegment(selected, pt, tol);
        if (sHit) {
          const newPt = snapIfNeeded(sHit.projected, ctx);
          const patch = insertVertexPatch(
            selected,
            sHit.ringIndex,
            sHit.insertIndex,
            newPt,
          );
          if (patch) {
            ctx.execute('entity.update', {
              mapId: ctx.map.id,
              entityId: selected.id,
              patch,
            });
            const updated = ctx.map.entities[selected.id];
            activeVertex = {
              entityId: selected.id,
              ringIndex: sHit.ringIndex,
              pointIndex: sHit.insertIndex,
            };
            if (updated) {
              draggingVertex = {
                entity: applyEntityPatch(updated, patch),
                ringIndex: sHit.ringIndex,
                pointIndex: sHit.insertIndex,
                startPt: pt,
                moved: false,
              };
            }
            ctx.requestRedraw();
            return true;
          }
        }
      }

      // Otherwise pick an editable entity
      const hit = pickTopEntity(ctx.map, pt, tol);
      if (hit && isPointEditableEntity(hit)) {
        ctx.setSelectedIds([hit.id]);
        activeVertex = null;
        ctx.requestRedraw();
        return true;
      }

      ctx.setSelectedIds([]);
      activeVertex = null;
      ctx.requestRedraw();
      return false;
    },

    onPointerMove(pt, _e, ctx) {
      const mode = viewStore.getState().pointEditMode;
      const snapped = snapIfNeeded(pt, ctx);
      hoverPt = snapped;

      if (mode === 'add' || mode === 'subtract') {
        if (clipPoints.length > 0) {
          ctx.requestRedraw();
        }
        return;
      }

      if (!draggingVertex) {
        return;
      }

      const dist = Math.hypot(
        pt.x - draggingVertex.startPt.x,
        pt.y - draggingVertex.startPt.y,
      );
      if (dist > 1 / Math.max(0.0005, ctx.camera.zoom)) {
        draggingVertex.moved = true;
      }
      if (!draggingVertex.moved) {
        return;
      }

      const patch = moveVertexPatch(
        draggingVertex.entity,
        draggingVertex.ringIndex,
        draggingVertex.pointIndex,
        snapped,
      );
      pendingPatch = patch;
      previewMap.clear();
      previewMap.set(
        draggingVertex.entity.id,
        applyEntityPatch(draggingVertex.entity, patch),
      );
      ctx.requestRedraw();
    },

    onPointerUp(_pt, _e, ctx) {
      if (!draggingVertex) {
        return;
      }
      const drag = draggingVertex;
      const patch = pendingPatch;
      clearDrag();

      if (drag.moved && patch) {
        ctx.execute('entity.update', {
          mapId: ctx.map.id,
          entityId: drag.entity.id,
          patch,
        });
      }
      ctx.requestRedraw();
    },

    onKey(e, ctx) {
      const mode = viewStore.getState().pointEditMode;
      if (mode === 'add' || mode === 'subtract') {
        if (e.key === 'Escape' && clipPoints.length > 0) {
          clearClip();
          ctx.requestRedraw();
          return true;
        }
        if (e.key === 'Backspace' && clipPoints.length > 0) {
          e.preventDefault();
          clipPoints.pop();
          ctx.requestRedraw();
          return true;
        }
        if (e.key === 'Enter' && clipPoints.length >= 3) {
          const target = getSingleEditableEntity(ctx.map, ctx.getSelectedIds());
          if (target && target.type === 'area') {
            e.preventDefault();
            const ring = [...clipPoints];
            clearClip();
            applyBooleanClip(
              target,
              ring,
              mode === 'add' ? 'union' : 'difference',
              ctx,
            );
            ctx.requestRedraw();
            return true;
          }
        }
        return false;
      }

      if (e.key === 'Escape') {
        if (draggingVertex) {
          clearDrag();
          ctx.requestRedraw();
          return true;
        }
        if (activeVertex) {
          activeVertex = null;
          ctx.requestRedraw();
          return true;
        }
        return false;
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        activeVertex
      ) {
        const selected = getSingleEditableEntity(ctx.map, ctx.getSelectedIds());
        if (selected && selected.id === activeVertex.entityId) {
          const patch = deleteVertexPatch(
            selected,
            activeVertex.ringIndex,
            activeVertex.pointIndex,
          );
          if (patch) {
            e.preventDefault();
            activeVertex = null;
            ctx.execute('entity.update', {
              mapId: ctx.map.id,
              entityId: selected.id,
              patch,
            });
            ctx.requestRedraw();
            return true;
          }
        }
      }
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      const strokeW = 1.5 / zoom;
      const r = 4.5 / zoom;
      const mode = viewStore.getState().pointEditMode;

      const selected = getSingleEditableEntity(ctx.map, ctx.getSelectedIds());
      if (selected) {
        const displayEnt = previewMap.get(selected.id) ?? selected;
        const lists = getEntityPointLists(displayEnt);
        for (let rIdx = 0; rIdx < lists.length; rIdx++) {
          const list = lists[rIdx]!;
          for (let pIdx = 0; pIdx < list.length; pIdx++) {
            const p = list[pIdx]!;
            const isActive =
              activeVertex?.entityId === selected.id &&
              activeVertex.ringIndex === rIdx &&
              activeVertex.pointIndex === pIdx;
            gfx
              .rect(p.x - r, p.y - r, r * 2, r * 2)
              .fill({ color: isActive ? 0x38bdf8 : 0x111827 })
              .stroke({
                width: strokeW,
                color: isActive ? 0xffffff : 0xfbbf24,
              });
          }
        }
      }

      if ((mode === 'add' || mode === 'subtract') && clipPoints.length > 0) {
        const color = mode === 'add' ? 0x22c55e : 0xef4444;
        const preview = hoverPt ? [...clipPoints, hoverPt] : clipPoints;
        if (preview.length >= 3) {
          gfx.moveTo(preview[0]!.x, preview[0]!.y);
          for (let i = 1; i < preview.length; i++) {
            gfx.lineTo(preview[i]!.x, preview[i]!.y);
          }
          gfx.closePath();
          gfx.fill({ color, alpha: 0.2 });
        }
        gfx.moveTo(preview[0]!.x, preview[0]!.y);
        for (let i = 1; i < preview.length; i++) {
          gfx.lineTo(preview[i]!.x, preview[i]!.y);
        }
        if (preview.length >= 3) {
          gfx.closePath();
        }
        gfx.stroke({ width: strokeW, color, alpha: 0.95 });
        for (const p of clipPoints) {
          gfx.circle(p.x, p.y, r).fill({ color });
        }
      }
    },
  };
}
