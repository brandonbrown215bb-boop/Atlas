import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import type { MapDoc, MapKind } from '../model/schema';
import { getProceduralTexture, type ProceduralTextureKind } from './proceduralTextures';

export interface BackdropStyle {
  color: number;
  texKind: ProceduralTextureKind;
  texAlpha: number;
}

export function mapBackdropStyle(
  mapOrKind: Pick<MapDoc, 'kind' | 'outsideLandIsWater'> & Partial<Pick<MapDoc, 'generators'>> | MapKind,
  outsideLandIsWater?: boolean,
): BackdropStyle {
  const kind = typeof mapOrKind === 'string' ? mapOrKind : mapOrKind.kind;
  // A site holding a dungeon is underground: rock, not lawn.
  const underground = typeof mapOrKind !== 'string' && kind === 'site'
    && Object.values(mapOrKind.generators ?? {}).some(g => g.type === 'dungeon');
  if (underground) return { color: 0x2b221a, texKind: 'parchment', texAlpha: 0.14 };
  const oceanOutside =
    typeof mapOrKind === 'string' ? outsideLandIsWater : mapOrKind.outsideLandIsWater;
  if (kind === 'world' || (kind === 'region' && oceanOutside !== false)) {
    return { color: 0x3a5c68, texKind: 'water', texAlpha: 0.45 };
  }
  if (kind === 'settlement' || kind === 'site' || kind === 'region') {
    return { color: 0x67754f, texKind: 'grass', texAlpha: 0.42 };
  }
  return { color: 0x2b221a, texKind: 'parchment', texAlpha: 0.14 };
}

export function applyCartographicChrome(
  stage: Container,
  width: number,
  height: number,
  kind: MapKind,
  options: { grainAlpha?: number; includeCompass?: boolean; vignetteAlpha?: number } = {},
): void {
  const parchmentTex = getProceduralTexture('parchment');
  if (parchmentTex) {
    const grain = new TilingSprite({ texture: parchmentTex, width, height });
    grain.eventMode = 'none';
    grain.alpha = options.grainAlpha ?? 0.12;
    stage.addChild(grain);
  }
  const vignetteTex = getProceduralTexture('vignette');
  if (vignetteTex) {
    const vig = new Sprite(vignetteTex);
    vig.eventMode = 'none';
    vig.width = width;
    vig.height = height;
    vig.alpha = options.vignetteAlpha ?? 1;
    stage.addChild(vig);
  }

  if (kind === 'world' || kind === 'region') {
    // Soft outer frontier mist bevel around parchment bounds
    const mist = new Graphics();
    mist.eventMode = 'none';
    mist.rect(0, 0, width, height).stroke({ color: 0x16242b, width: 32, alpha: 0.22 });
    mist.rect(14, 14, Math.max(1, width - 28), Math.max(1, height - 28)).stroke({ color: 0xf4ead2, width: 10, alpha: 0.08 });
    stage.addChild(mist);
  }

  if (
    options.includeCompass !== false &&
    (kind === 'world' || kind === 'region' || kind === 'settlement') &&
    width >= 400 &&
    height >= 400
  ) {
    const chrome = new Graphics();
    chrome.eventMode = 'none';
    const pad = 10;
    chrome
      .rect(pad, pad, width - pad * 2, height - pad * 2)
      .stroke({ color: 0x3b2a1a, width: 2, alpha: 0.55 });
    chrome
      .rect(pad + 5, pad + 5, width - (pad + 5) * 2, height - (pad + 5) * 2)
      .stroke({ color: 0x3b2a1a, width: 1, alpha: 0.35 });
    const rx = width - 58;
    const ry = height - 58;
    const rad = 26;
    chrome
      .circle(rx, ry, rad)
      .fill({ color: 0xf0e4c8, alpha: 0.72 })
      .stroke({ color: 0x3b2a1a, width: 1.5, alpha: 0.75 });
    chrome
      .circle(rx, ry, rad * 0.76)
      .stroke({ color: 0x3b2a1a, width: 0.8, alpha: 0.45 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 - Math.PI / 2;
      const p1 = { x: rx + Math.cos(a) * rad * 0.92, y: ry + Math.sin(a) * rad * 0.92 };
      const p2 = { x: rx + Math.cos(a + 0.38) * rad * 0.25, y: ry + Math.sin(a + 0.38) * rad * 0.25 };
      const p3 = { x: rx + Math.cos(a - 0.38) * rad * 0.25, y: ry + Math.sin(a - 0.38) * rad * 0.25 };
      chrome
        .moveTo(rx, ry)
        .lineTo(p1.x, p1.y)
        .lineTo(p2.x, p2.y)
        .closePath()
        .fill({ color: i === 0 ? 0x8f3328 : 0x3b2a1a, alpha: 0.85 });
      chrome
        .moveTo(rx, ry)
        .lineTo(p1.x, p1.y)
        .lineTo(p3.x, p3.y)
        .closePath()
        .fill({ color: i === 0 ? 0xc8634a : 0x7c6852, alpha: 0.85 });
    }
    stage.addChild(chrome);
  }
}
