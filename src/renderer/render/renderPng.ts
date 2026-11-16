import { geographicEntities } from '../geom/geography';
import { applyCartographicChrome, mapBackdropStyle } from './backdrop';
import { drawFog } from './drawFog';
import { drawRoomLightingOverlay, type LightingMode } from './lighting';
import { Application, Container, Graphics, TilingSprite } from 'pixi.js';
import type { Entity, MapDoc } from '../model/schema';
import type { CameraState } from './camera';
import { playerRenderList } from '../model/player';
import { buildEntityDisplay, buildPathOutlineOverlay, buildWallNetworkOverlay, createWallHatchTest } from './drawEntity';
import { getProceduralTexture } from './proceduralTextures';
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
  roofMode?: 'detailed' | 'simple' | 'hidden';
  lightingMode?: LightingMode;
  showUndercity?: boolean;
}

export async function renderMapToPngBase64(
  options: RenderPngOptions,
): Promise<string> {
  const width = Math.min(8192, Math.max(1, Math.floor(options.width ?? 800)));
  const height = Math.min(8192, Math.max(1, Math.floor(options.height ?? 600)));
  const view = options.view ?? 'gm';
  const targetRect = options.rect ?? options.map.bounds;

  const canvas = (options.document ?? document).createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const app = new Application();
  const textureOwner = {};
  const urls = new Set<string>();
  const backdrop = mapBackdropStyle(options.map);
  await app.init({
    canvas,
    preference: 'webgl',
    autoStart: false,
    antialias: true,
    preserveDrawingBuffer: true,
    backgroundColor: backdrop.color,
    width,
    height,
    resolution: 1,
  });

  try {
    app.stage.eventMode = 'none';
    const bgTex = getProceduralTexture(backdrop.texKind);
    if (bgTex) {
      const bgTile = new TilingSprite({ texture: bgTex, width, height });
      bgTile.eventMode = 'none';
      bgTile.alpha = backdrop.texAlpha;
      app.stage.addChild(bgTile);
    }

    const worldLayer = new Container();
    worldLayer.eventMode = 'none';

    const zoom = Math.min(width / targetRect.w, height / targetRect.h);
    const cam = options.camera ?? {
      x: (width - targetRect.w * zoom) / 2 - targetRect.x * zoom,
      y: (height - targetRect.h * zoom) / 2 - targetRect.y * zoom,
      zoom,
    };
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

    const showUndercity = options.showUndercity ?? viewStore.getState().showUndercity;
    const roofMode = options.roofMode ?? viewStore.getState().roofMode;
    const lightingMode = options.lightingMode ?? viewStore.getState().lightingMode;
    const wallHatch = ['interior', 'site'].includes(options.map.kind)
      ? createWallHatchTest(Object.values(options.map.entities), options.map.generators)
      : false;
    const renderList = (view === 'player' ? playerRenderList(options.map, options.labels) : geographicEntities(options.map)) as Entity[];
    const itemsByLayer = new Map<string, Entity[]>();
    for (const r of renderList) {
      if (view === 'player' && r.gmOnly) continue;
      const list = itemsByLayer.get(r.layerId);
      if (list) list.push(r); else itemsByLayer.set(r.layerId, [r]);
    }
    const outlineDone = new Set<string>();
    const wallDone = new Set<string>();

    for (const entity of renderList) {
      if (view === 'player' && entity.gmOnly) continue;
      if (entity.type === 'path' && entity.routeTier === 'sewer' && !showUndercity) continue;
      const lc = layerMap.get(entity.layerId);
      if (!lc) continue;
      const layerItems = itemsByLayer.get(entity.layerId) ?? [];
      const needsOutlineHere =
        !outlineDone.has(entity.layerId) &&
        ((entity.type === 'path' && entity.role !== 'cityWall') ||
          (entity.type === 'area' && (entity.role === 'building' || (entity.role === 'land' && entity.name?.startsWith('Clearing ')))));
      if (needsOutlineHere) {
        outlineDone.add(entity.layerId);
        lc.addChild(buildPathOutlineOverlay(layerItems, cam.zoom, options.map.kind));
      }
      const needsWallHere =
        !wallDone.has(entity.layerId) &&
        (entity.type === 'wall' || entity.type === 'door' || entity.type === 'prop' || entity.type === 'portal');
      if (needsWallHere && layerItems.some((r) => r.type === 'wall')) {
        wallDone.add(entity.layerId);
        lc.addChild(buildWallNetworkOverlay(layerItems, cam.zoom, wallHatch));
      }
      const id = entityAssetId(entity);
      const url = id ? resolveWorldAssetUrl(worldStore.getState().worldPath, viewStore.getState().assetsIndex, id) : null;
      if (url) { urls.add(url); updateTextureUsage(textureOwner, new Set(urls)); }
      const texture = url ? await loadAssetTexture(url) : null;
      const display = buildEntityDisplay(entity, {
        selected: false,
        zoom: cam.zoom,
        cartographicRivers: (options.map.riverWidthMode ?? (['world','region'].includes(options.map.kind)?'cartographic':'physical'))==='cartographic',
        texture: texture ?? undefined,
        mapKind: options.map.kind,
        roofMode,
        wallHatch,
        separatePathOutline: true,
        separateWallPass: true,
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
    if (options.map.kind === 'interior') {
      const lighting = new Graphics();
      drawRoomLightingOverlay(
        lighting,
        options.map,
        { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom, w: width / cam.zoom, h: height / cam.zoom },
        lightingMode,
      );
      worldLayer.addChild(lighting);
    }
    if (view === 'player' && options.map.fog.enabled) {
      const fog = new Graphics();
      drawFog(fog, options.map, {x:-cam.x/cam.zoom,y:-cam.y/cam.zoom,w:width/cam.zoom,h:height/cam.zoom},1);
      worldLayer.addChild(fog);
    }
    app.stage.addChild(worldLayer);
    if (options.map.parent) {
      const b = options.map.bounds;
      const mask = new Graphics().rect(b.x, b.y, b.w, b.h).fill(0xffffff);
      mask.position.set(cam.x, cam.y);
      mask.scale.set(cam.zoom);
      app.stage.addChild(mask);
      worldLayer.mask = mask;
    }

    applyCartographicChrome(app.stage, width, height, options.map.kind);

    app.render();

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } finally {
    app.stage.destroy({ children: true });
    app.destroy(false);
    updateTextureUsage(textureOwner, new Set());
  }
}
