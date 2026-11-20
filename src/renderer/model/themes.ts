import type { Theme } from './schema';

export const THEME_ROLES = [
  'tree','rock','altar','table','bed','chair','barrel','crate','door','bridge','roof','mountain','hill','forest','settlement',
  'hearth','bar','rug','pillar','sarcophagus','burialBell','pumpWheel','barricade','winch','strongbox',
  'well','marketCross','marketStall','headstone','standingStone','dock','boat','sewerGrate',
  'waystone','campfire','bush','hedge','tuft','caveFungus','caveRock','stalagmite','ruinedPillar','shrineAltar',
  'stronghold','ruin','lair','sacred','travel','lighthouse','atlasBridge',
  'roofWealthy','innRoof','millRoof','chapelRoof','barnRoof',
  'floorTexture','stoneFloorTexture','woodFloorTexture','earthFloorTexture',
  'wallTexture','stoneWallTexture','woodWallTexture','caveWallTexture','ruinWallTexture','cityWallTexture',
  'pathTexture','roadTexture','trailTexture','streetTexture','streamTexture','pondTexture','clearingTexture',
  'plazaTexture','villageGreenTexture','fieldTexture',
] as const;

export function themeAssets(theme: Theme | undefined, role: string): string[] {
  const assets = theme?.[role];
  return assets?.length ? assets : [`builtin:${role}`];
}

export function themeRoles(theme: Theme | undefined): string[] {
  return [...new Set<string>([...THEME_ROLES,...Object.keys(theme ?? {})])];
}
