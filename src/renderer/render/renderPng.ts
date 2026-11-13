import { Application, Container } from 'pixi.js';
import type { Entity, MapDoc } from '../model/schema';
import { fitBoundsCamera } from './camera';
import { buildEntityDisplay } from './drawEntity';

export interface RenderPngOptions {
  map: MapDoc;
  rect?: { x: number; y: number; w: number; h: number };
  width?: number;
  height?: number;
  view?: 'gm' | 'player';
}

export async function renderMapToPngBase64(
  options: RenderPngOptions,
): Promise<string> {
  const width = Math.min(2048, Math.max(64, Math.floor(options.width ?? 800)));
  const height = Math.min(2048, Math.max(64, Math.floor(options.height ?? 600)));
  const view = options.view ?? 'gm';
  const targetRect = options.rect ?? options.map.bounds;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const app = new Application();
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

    const cam = fitBoundsCamera(targetRect, width, height, options.map.kind);
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

    for (const entity of Object.values(options.map.entities) as Entity[]) {
      if (view === 'player' && entity.gmOnly) continue;
      const lc = layerMap.get(entity.layerId);
      if (!lc) continue;
      const display = buildEntityDisplay(entity, {
        selected: false,
        zoom: cam.zoom,
      });
      lc.addChild(display);
    }

    app.stage.addChild(worldLayer);
    app.render();

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } finally {
    app.destroy(true, { children: true, texture: true });
  }
}
