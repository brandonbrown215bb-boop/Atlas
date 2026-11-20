import type { GeneratorInput } from './framework';

type ArtInput = Pick<GeneratorInput<unknown>, 'seed' | 'theme' | 'assets'>;

// Artwork choices use their own seed so changing a palette doesn't move the map.
export function pickThemeAsset(input: ArtInput, roles: readonly string[], key: string): string | undefined {
  for (const role of roles) {
    const assets = Object.hasOwn(input.theme, role) ? input.theme[role] : undefined;
    if (!assets?.length) continue;
    let hash = input.seed ^ 0x811c9dc5;
    for (const char of `${role}/${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
    return assets[(hash >>> 0) % assets.length];
  }
}

export function propArt(input: ArtInput, roles: readonly string[], key: string, fallback: string) {
  const asset = pickThemeAsset(input, roles, key);
  if (!asset || asset.startsWith('builtin:')) return { builtin: asset?.slice(8) ?? fallback };
  return { assetId: asset, builtin: fallback };
}

export function surfaceTexture(input: ArtInput, roles: readonly string[], span?: number) {
  const assetId = pickThemeAsset(input, roles, 'surface');
  const entry = assetId ? input.assets?.[assetId] : undefined;
  if (!assetId || !entry) return undefined;
  // Line art fills its cross section. Repeating area art uses its imported scale.
  return { assetId, metersPerPixel: span === undefined ? 1.524 / entry.pxPerSquare : span / entry.height };
}

export function roofTexture(input: ArtInput, roles: readonly string[], key: string) {
  const assetId = pickThemeAsset(input, roles, key);
  return assetId && !assetId.startsWith('builtin:') ? { assetId, metersPerPixel: 1, fitToArea: true } : undefined;
}
