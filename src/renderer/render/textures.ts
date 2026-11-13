import { Assets, type Texture } from 'pixi.js';
import type { AssetsIndex } from '../model/schema';

const textureCache = new Map<string, Texture>();
const inflight = new Map<string, Promise<Texture | null>>();

export function buildWorldAssetUrl(
  worldPath: string,
  assetId: string,
  ext: string,
): string {
  const normalized = worldPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const encodedPath = normalized
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `atlas-file://local/${encodedPath}/assets/${encodeURIComponent(assetId)}.${encodeURIComponent(ext)}`;
}

export function getCachedAssetTexture(url: string): Texture | undefined {
  return textureCache.get(url);
}

export function loadAssetTexture(
  url: string,
  onLoaded?: () => void,
): Promise<Texture | null> {
  const existing = textureCache.get(url);
  if (existing) {
    return Promise.resolve(existing);
  }
  const pending = inflight.get(url);
  if (pending) {
    if (onLoaded) {
      void pending.then((tex) => {
        if (tex) onLoaded();
      });
    }
    return pending;
  }

  const promise = Assets.load<Texture>(url)
    .then((tex) => {
      textureCache.set(url, tex);
      inflight.delete(url);
      onLoaded?.();
      return tex;
    })
    .catch(() => {
      inflight.delete(url);
      return null;
    });

  inflight.set(url, promise);
  return promise;
}

export function resolveWorldAssetUrl(
  worldPath: string | null,
  assetsIndex: AssetsIndex,
  assetId: string,
): string | null {
  if (!worldPath) return null;
  const entry = assetsIndex[assetId];
  if (!entry) return null;
  return buildWorldAssetUrl(worldPath, assetId, entry.ext);
}
