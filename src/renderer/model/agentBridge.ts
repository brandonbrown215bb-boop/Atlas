import { copyMapToWorld, forkOpenWorld } from '../export/transferActions';
import { TransferInputSchema } from './transfer';
import { exportUvtt } from '../export/uvtt';
import { exportPlayerImage } from '../export/playerImage';
import { z } from 'zod';
import { listCommands } from './commands';
import { EntitySchema, MapDocSchema, type Entity, type MapDoc, type WorldMeta } from './schema';
import { worldStore } from './store';
import { viewStore } from './viewStore';
import { renderMapToPngBase64 } from '../render/renderPng';
import { executeAssetCommands } from '../assets/commands';
import { themeAssets, themeRoles } from './themes';

function entityIntersectsBbox(
  entity: Entity,
  bbox: { x: number; y: number; w: number; h: number },
): boolean {
  const minX = bbox.x;
  const minY = bbox.y;
  const maxX = bbox.x + bbox.w;
  const maxY = bbox.y + bbox.h;
  const inBox = (x: number, y: number) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;

  switch (entity.type) {
    case 'image':
      return !(
        entity.x + entity.w < minX ||
        entity.x > maxX ||
        entity.y + entity.h < minY ||
        entity.y > maxY
      );
    case 'area':
      return entity.rings.some((ring) => ring.some((pt) => inBox(pt.x, pt.y)));
    case 'path':
    case 'wall':
      return entity.points.some((pt) => inBox(pt.x, pt.y));
    case 'door':
      return inBox(entity.a.x, entity.a.y) || inBox(entity.b.x, entity.b.y);
    case 'prop':
    case 'light':
    case 'label':
    case 'portal':
      return inBox(entity.x, entity.y);
    case 'place':
      return true;
  }
}

export async function handleAgentCall(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'world_loaded': {
      const { meta, maps, worldDir, assetsIndex } = params as {
        meta: WorldMeta;
        maps: Record<string, MapDoc>;
        worldDir: string;
        assetsIndex?: Record<string, never>;
      };
      viewStore.getState().setAssetsIndex(assetsIndex ?? {});
      worldStore.getState().loadWorld(meta, maps, worldDir);
      return { ok: true };
    }

    case 'world_status': {
      const s = worldStore.getState();
      if (!s.world) {
        return { open: false };
      }
      return {
        open: true,
        worldId: s.world.meta.id,
        name: s.world.meta.name,
        worldDir: s.worldPath,
        activeMapId: s.activeMapId,
        dirty: s.dirtyWorld || Object.keys(s.dirtyMapIds).length > 0,
      };
    }

    case 'schema_get': {
      return {
        mapDoc: z.toJSONSchema(MapDocSchema),
        entity: z.toJSONSchema(EntitySchema),
      };
    }

    case 'command_list': {
      return listCommands();
    }
    case 'asset_search': return window.atlasApi.searchAssets(params);
    case 'theme_get': {
      const state = worldStore.getState();
      if (!state.world) throw new Error('No world is open');
      const themeName = String(params.themeName ?? 'default');
      const theme = state.world.meta.themes[themeName] ?? {};
      return { themeName, roles:theme, resolved:Object.fromEntries(themeRoles(theme).map(role => [role,themeAssets(theme,role)])) };
    }

    case 'command_run': {
      const commands = params['commands'] as Array<{
        name: string;
        input: unknown;
      }>;
      const label =
        typeof params['label'] === 'string' ? params['label'] : undefined;
      const results = commands.some(c => ['prop.stamp','entity.setTexture','theme.setRole'].includes(c.name))
        ? await executeAssetCommands(commands, label) : worldStore.getState().executeBatch(commands, label);
      return { results };
    }

    case 'undo': {
      return { undone: worldStore.getState().undo() };
    }

    case 'redo': {
      return { redone: worldStore.getState().redo() };
    }

    case 'map_list': {
      const s = worldStore.getState();
      if (!s.world) throw new Error('No world is open');
      return s.world.meta.maps;
    }

    case 'map_get': {
      const s = worldStore.getState();
      if (!s.world) throw new Error('No world is open');
      const mapId = String(params['mapId'] ?? '');
      const map = s.world.maps[mapId];
      if (!map) throw new Error(`Map not found: ${mapId}`);

      const typeFilter = params['type'] as string | undefined;
      const layerFilter = params['layerId'] as string | undefined;
      const originFilter = params['origin'] as string | undefined;
      const bbox = params['bbox'] as
        | { x: number; y: number; w: number; h: number }
        | undefined;

      const filteredEntities: Record<string, Entity> = {};
      for (const [id, ent] of Object.entries(map.entities)) {
        if (typeFilter && ent.type !== typeFilter) continue;
        if (layerFilter && ent.layerId !== layerFilter) continue;
        if (originFilter && ent.origin !== originFilter) continue;
        if (bbox && !entityIntersectsBbox(ent, bbox)) continue;
        filteredEntities[id] = ent;
      }

      return {
        ...map,
        entities: filteredEntities,
      };
    }

    case 'world_fork': return forkOpenWorld(String(params.targetDir),String(params.name));
    case 'world_copy_map': return copyMapToWorld(String(params.targetDir),TransferInputSchema.parse(params));
    case 'export_uvtt':
    case 'export_player_image': {
      const state=worldStore.getState();
      const map=state.world?.maps[String(params.mapId ?? state.activeMapId ?? '')];
      if(!map) throw new Error('Map not found');
      const image=await exportPlayerImage(map, params.pixelsPerSquare as number | undefined, params.rect as {x:number;y:number;w:number;h:number}|undefined);
      if(method==='export_uvtt') {
        const uvtt=exportUvtt(map,image.data,params.pixelsPerSquare as number | undefined,image.rect);
        return {...uvtt,width:image.width,height:image.height,capped:image.capped,report:[image.report,uvtt.report].filter(Boolean).join(' ')};
      }
      return image;
    }
    case 'render_png': {
      const s = worldStore.getState();
      if (!s.world) throw new Error('No world is open');
      const mapId = String(params['mapId'] ?? s.activeMapId ?? '');
      const map = s.world.maps[mapId];
      if (!map) throw new Error(`Map not found: ${mapId}`);
      const base64 = await renderMapToPngBase64({
        map,
        rect: params['rect'] as
          | { x: number; y: number; w: number; h: number }
          | undefined,
        width: params['width'] as number | undefined,
        height: params['height'] as number | undefined,
        view: params['view'] as 'gm' | 'player' | undefined,
      });
      return { mimeType: 'image/png', data: base64 };
    }

    default:
      throw new Error(`Unknown agent method: ${method}`);
  }
}

export function startAgentBridge(): () => void {
  return window.atlasApi.onAgentCall(async (reqId, method, params) => {
    try {
      const result = await handleAgentCall(method, params);
      window.atlasApi.sendAgentReply(reqId, { ok: true, result });
    } catch (err) {
      window.atlasApi.sendAgentReply(reqId, {
        ok: false,
        error: (err as Error).message,
      });
    }
  });
}
