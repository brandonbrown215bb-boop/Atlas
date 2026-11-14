import { Assets, type Texture } from 'pixi.js';
import type { AssetsIndex, Entity } from '../model/schema';

const textureCache = new Map<string, Texture>();
const inflight = new Map<string, Promise<Texture | null>>();
const owners = new Map<object, Set<string>>();
const unloading = new Map<string, Promise<void>>();
let collectionTimer: ReturnType<typeof setTimeout> | null = null;

export function updateTextureUsage(owner: object, urls: Set<string>): void {
  if (urls.size) owners.set(owner, urls); else owners.delete(owner);
  if (collectionTimer) return;
  collectionTimer = setTimeout(() => {
    collectionTimer = null;
    const needed = new Set([...owners.values()].flatMap(s => [...s]));
    for (const url of textureCache.keys()) {
      if (needed.has(url)) continue;
      textureCache.delete(url);
      const job = Assets.unload(url).catch(() => {}).finally(() => unloading.delete(url));
      unloading.set(url, job);
    }
  }, 0);
}

export function entityAssetId(entity: Entity): string | null {
  if (entity.type === 'image' || entity.type === 'prop') return entity.assetId ?? null;
  if (entity.type === 'area' || entity.type === 'path' || entity.type === 'wall') return entity.texture?.assetId ?? null;
  return null;
}

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

  const promise = Promise.resolve(unloading.get(url)).then(() => Assets.load<Texture>(url))
    .then((tex) => {
      textureCache.set(url, tex);
      inflight.delete(url);
      onLoaded?.();
      // A view can disappear while its image is still loading.
      updateTextureUsage({}, new Set());
      return tex;
    })
    .catch((error: unknown) => {
      console.warn('Failed to load map image:', url, error);
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
