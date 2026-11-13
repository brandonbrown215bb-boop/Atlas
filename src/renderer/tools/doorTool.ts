import type { Graphics } from 'pixi.js';
import { findDoorPlacementOnWall, type WallDoorPlacement } from '../geom/wallDoor';
import { viewStore } from '../model/viewStore';
import type { MapTool, ToolContext } from './types';

export function createDoorTool(): MapTool {
  let hoverPlacement: WallDoorPlacement | null = null;

  const computePlacement = (pt: { x: number; y: number }, ctx: ToolContext) => {
    const tol = Math.max(0.5, 12 / Math.max(0.0005, ctx.camera.zoom));
    const doorWidth = ctx.map.grid.size > 0 ? ctx.map.grid.size : 1.524;
    return findDoorPlacementOnWall(ctx.map, pt, tol, doorWidth);
  };

  return {
    id: 'door',

    onPointerDown(pt, e, ctx) {
      if (e.button !== 0) {
        return false;
      }
      const placement = computePlacement(pt, ctx);
      if (!placement) {
        return false;
      }
      const kind = viewStore.getState().doorKind;
      const id = `door-${crypto.randomUUID().slice(0, 8)}`;
      ctx.execute('entity.add', {
        mapId: ctx.map.id,
        entity: {
          id,
          type: 'door',
          layerId: placement.layerId,
          origin: 'manual',
          rev: 0,
          a: placement.a,
          b: placement.b,
          kind,
          open: false,
          gmOnly: kind === 'secret' ? true : undefined,
        },
      });
      ctx.setSelectedIds([id]);
      hoverPlacement = null;
      ctx.requestRedraw();
      return true;
    },

    onPointerMove(pt, _e, ctx) {
      hoverPlacement = computePlacement(pt, ctx);
      ctx.requestRedraw();
    },

    onPointerUp() {},

    onKey() {
      return false;
    },

    drawOverlay(gfx: Graphics, ctx: ToolContext) {
      if (!hoverPlacement) {
        return;
      }
      const zoom = Math.max(0.0005, ctx.camera.zoom);
      const strokeW = Math.max(0.25, 3 / zoom);
      const kind = viewStore.getState().doorKind;
      const color = kind === 'secret' ? 0xc084fc : 0xd97706;
      gfx
        .moveTo(hoverPlacement.a.x, hoverPlacement.a.y)
        .lineTo(hoverPlacement.b.x, hoverPlacement.b.y)
        .stroke({ width: strokeW, color, alpha: 0.9 });
    },
  };
}
