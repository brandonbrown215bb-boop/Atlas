import { geographicEntities } from '../geom/geography';
import { drawFog } from './drawFog';
import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import type { Entity, MapDoc } from '../model/schema';
import type { CameraState } from './camera';
import { playerRenderList } from '../model/player';
import { buildEntityDisplay } from './drawEntity';
import { getProceduralTexture } from './proceduralTextures';
import { entityAssetId, loadAssetTexture, resolveWorldAssetUrl, updateTextureUsage } from './textures';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

function mapBackdropStyle(map: MapDoc): { color: number; texKind: 'water' | 'grass' | 'stone' | 'parchment'; texAlpha: number } {
  if (map.kind === 'world' || map.kind === 'region') {
    return { color: 0x3a5c68, texKind: 'water', texAlpha: 0.45 };
  }
  if (map.kind === 'settlement') {
    return { color: 0xc8ba9b, texKind: 'grass', texAlpha: 0.24 };
  }
  if (map.kind === 'site') {
    const hasTrees = Object.values(map.entities).some(
      (e) => e.type === 'prop' && (e.builtin === 'tree' || e.builtin === 'builtin:tree'),
    );
    if (hasTrees) {
      return { color: 0x67754f, texKind: 'grass', texAlpha: 0.55 };
    }
    return { color: 0x2b221a, texKind: 'parchment', texAlpha: 0.08 };
  }
  return { color: 0x2b221a, texKind: 'parchment', texAlpha: 0.08 };
}

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

    for (const entity of (view === 'player' ? playerRenderList(options.map, options.labels) : geographicEntities(options.map)) as Entity[]) {
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
        cartographicRivers: (options.map.riverWidthMode ?? (['world','region'].includes(options.map.kind)?'cartographic':'physical'))==='cartographic',
        texture: texture ?? undefined,
        mapKind: options.map.kind,
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

    // Subtle parchment grain + warm sepia edge vignette for cohesive cartographic finish
    const parchmentTex = getProceduralTexture('parchment');
    if (parchmentTex) {
      const grain = new TilingSprite({ texture: parchmentTex, width, height });
      grain.eventMode = 'none';
      grain.alpha = 0.12;
      app.stage.addChild(grain);
    }
    const vignetteTex = getProceduralTexture('vignette');
    if (vignetteTex) {
      const vig = new Sprite(vignetteTex);
      vig.eventMode = 'none';
      vig.width = width;
      vig.height = height;
      app.stage.addChild(vig);
    }

    if ((options.map.kind === 'world' || options.map.kind === 'region' || options.map.kind === 'settlement') && width >= 400 && height >= 400) {
      const chrome = new Graphics();
      chrome.eventMode = 'none';
      const pad = 10;
      chrome.rect(pad, pad, width - pad * 2, height - pad * 2).stroke({ color: 0x3b2a1a, width: 2, alpha: 0.55 });
      chrome.rect(pad + 5, pad + 5, width - (pad + 5) * 2, height - (pad + 5) * 2).stroke({ color: 0x3b2a1a, width: 1, alpha: 0.35 });
      // Compass rose in bottom-right corner
      const rx = width - 58, ry = height - 58, rad = 26;
      chrome.circle(rx, ry, rad).fill({ color: 0xf0e4c8, alpha: 0.72 }).stroke({ color: 0x3b2a1a, width: 1.5, alpha: 0.75 });
      chrome.circle(rx, ry, rad * 0.76).stroke({ color: 0x3b2a1a, width: 0.8, alpha: 0.45 });
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 - Math.PI / 2;
        const p1 = { x: rx + Math.cos(a) * rad * 0.92, y: ry + Math.sin(a) * rad * 0.92 };
        const p2 = { x: rx + Math.cos(a + 0.38) * rad * 0.25, y: ry + Math.sin(a + 0.38) * rad * 0.25 };
        const p3 = { x: rx + Math.cos(a - 0.38) * rad * 0.25, y: ry + Math.sin(a - 0.38) * rad * 0.25 };
        chrome.moveTo(rx, ry).lineTo(p1.x, p1.y).lineTo(p2.x, p2.y).closePath().fill({ color: i === 0 ? 0x8f3328 : 0x3b2a1a, alpha: 0.85 });
        chrome.moveTo(rx, ry).lineTo(p1.x, p1.y).lineTo(p3.x, p3.y).closePath().fill({ color: i === 0 ? 0xc8634a : 0x7c6852, alpha: 0.85 });
      }
      app.stage.addChild(chrome);
    }

    app.render();

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  } finally {
    app.stage.destroy({ children: true });
    app.destroy(false);
    updateTextureUsage(textureOwner, new Set());
  }
}
