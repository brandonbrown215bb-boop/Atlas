import type { Theme } from './schema';

export const THEME_ROLES = ['tree','rock','table','bed','chair','barrel','crate','door','bridge','roof','mountain','hill','forest','floorTexture','wallTexture','pathTexture'] as const;

export function themeAssets(theme: Theme | undefined, role: string): string[] {
  const assets = theme?.[role];
  return assets?.length ? assets : [`builtin:${role}`];
}

export function themeRoles(theme: Theme | undefined): string[] {
  return [...new Set<string>([...THEME_ROLES,...Object.keys(theme ?? {})])];
}
