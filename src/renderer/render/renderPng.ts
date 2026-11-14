import { Application, Container, Graphics } from 'pixi.js';
import type { Entity, MapDoc } from '../model/schema';
import type { CameraState } from './camera';
import { playerRenderList } from '../model/player';
import { buildEntityDisplay } from './drawEntity';
import { entityAssetId, loadAssetTexture, resolveWorldAssetUrl, updateTextureUsage } from './textures';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

export interface RenderPngOptions {
  map: MapDoc;
  rect?: { x: number; y: number; w: number; h: number };
  width?: number;
  height?: number;
  view?: 'gm' | 'player';
  labels?: boolean;
  grid?: boolean;
  camera?: CameraState;
  document?: Document;
}

export async function renderMapToPngBase64(
  options: RenderPngOptions,
): Promise<string> {
  const width = Math.min(2048, Math.max(64, Math.floor(options.width ?? 800)));
  const height = Math.min(2048, Math.max(64, Math.floor(options.height ?? 600)));
  const view = options.view ?? 'gm';
  const targetRect = options.rect ?? options.map.bounds;

  const canvas = (options.document ?? document).createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const app = new Application();
  const textureOwner = {};
  const urls = new Set<string>();
  await app.init({
    canvas,
    preference: 'webgl',
    autoStart: false,
    antialias: true,
    preserveDrawingBuffer: true,
    backgroundColor: 0x0d1117,
    width,
    height,
    resolution: 1,
  });

  try {
    app.stage.eventMode = 'none';
    const worldLayer = new Container();
    worldLayer.eventMode = 'none';

    const zoom = Math.min(width / targetRect.w, height / targetRect.h);
    const cam = options.camera ?? { x: -targetRect.x * zoom, y: -targetRect.y * zoom, zoom };
    worldLayer.position.set(cam.x, cam.y);
    worldLayer.scale.set(cam.zoom);

    const layerMap = new Map<string, Container>();
    for (const layer of options.map.layers) {
      if (!layer.visible) continue;
      if (view === 'player' && layer.gmOnly) continue;
      const lc = new Container();
      lc.eventMode = 'none';
      layerMap.set(layer.id, lc);
      worldLayer.addChild(lc);
    }

    for (const entity of (view === 'player' ? playerRenderList(options.map, options.labels) : Object.values(options.map.entities)) as Entity[]) {
      if (view === 'player' && entity.gmOnly) continue;
      const lc = layerMap.get(entity.layerId);
      if (!lc) continue;
      const id = entityAssetId(entity);
      const url = id ? resolveWorldAssetUrl(worldStore.getState().worldPath, viewStore.getState().assetsIndex, id) : null;
      if (url) { urls.add(url); updateTextureUsage(textureOwner, new Set(urls)); }
      const texture = url ? await loadAssetTexture(url) : null;
      const display = buildEntityDisplay(entity, {
        selected: false,
        zoom: cam.zoom,
        texture: texture ?? undefined,
      });
      lc.addChild(display);
    }

    if (options.grid) {
      const grid = new Graphics();
      const step = options.map.grid.size;
      if (step * cam.zoom >= 4) {
        const x0 = -cam.x / cam.zoom, y0 = -cam.y / cam.zoom;
        for (let x = Math.floor(x0 / step) * step; x <= x0 + width / cam.zoom; x += step)
          grid.moveTo(x, y0).lineTo(x, y0 + height / cam.zoom);
        for (let y = Math.floor(y0 / step) * step; y <= y0 + height / cam.zoom; y += step)
          grid.moveTo(x0, y).lineTo(x0 + width / cam.zoom, y);
        grid.stroke({ color: 0xffffff, alpha: 0.2, width: 1 / cam.zoom });
      }
      worldLayer.addChild(grid);
    }
    app.stage.addChild(worldLayer);
    app.render();

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } finally {
    app.destroy(true, { children: true });
    updateTextureUsage(textureOwner, new Set());
  }
}
