import type { Pack } from '../renderer/model/packs';
import type { Theme } from '../renderer/model/schema';

// Paths in the local packs. The world gets portable copies through theme.setRole.
const libraryArt: Record<string, Record<string, readonly string[]>> = {
  'Nimblehold Core': {
    stoneFloorTexture: ['generation/floors/surfaces/stone/stone_floor_surface/stone_floor_surface.png'],
    woodFloorTexture: ['generation/floors/surfaces/wood/wood_floor_surface/wood_floor_surface.png'],
    earthFloorTexture: ['generation/terrain/flatterrains/summer/ground_Rock_Standard.png'],
    stoneWallTexture: ['generation/walls/surfaces/stone/stone_wall_surface/stone_wall_surface.png'],
    woodWallTexture: ['generation/walls/surfaces/wood/wood_wall_surface/wood_wall_surface.png'],
    trailTexture: ['generation/terrain/paths/dirtpath1/dirtpath1_w1.png'],
    roadTexture: ['generation/terrain/paths/dirtpath1/dirtpath1_w3.png'],
    campfire: ['objects/Camp/Light/campfire1/campfire1.png'],
    ruinedPillar: ['objects/Ruins/Stone/pillarbroken1/pillarbroken1.png', 'objects/Ruins/Stone/pillarbroken3/pillarbroken3.png'],
  },
  'CH - Seasons v1,6': { well: ['objects/well_stone_01A.png'] },
  'CH - Buildings v1,1': {
    waystone: ['objects/Waystone_01.png', 'objects/Waystone_03.png'],
    marketCross: ['objects/Cross_01.png'],
    pillar: ['objects/Pillar_Stone_01.png'],
    hearth: ['objects/Fireplace_Square_01.png'],
    barricade: ['objects/Barricade_Wooden_Spiked_02.png'],
  },
  'CH - Crosshead v1,1': {
    headstone: ['objects/gravestone_01.png'],
    rock: ['objects/boulder_01.png', 'objects/boulder_03.png'],
    bridge: ['objects/bridge_wood_01.png'],
    sewerGrate: ['objects/grate_02.png'],
  },
  'CH - Dungeondraft v1,0': {
    altar: ['objects/altar_1aa.png'],
    barrel: ['objects/barrel_1a.png'],
    crate: ['objects/crate_1a.png'],
    table: ['objects/table_1a.png'],
    chair: ['objects/chair_1a.png'],
    bed: ['objects/bed_1a.png'],
    strongbox: ['objects/chest_1a.png'],
    boat: ['objects/ship_boat_1a.png', 'objects/ship_boat_3a.png'],
  },
  'CH - BIOMES Summer New v1,4': {
    tree: ['objects/trees_1a.png', 'objects/trees_2a.png', 'objects/trees_3a.png'],
    bush: ['objects/bush_1a.png'],
    tuft: ['objects/grass_1a.png', 'objects/grass_3a.png'],
    clearingTexture: ['terrain/ch_grass_base.png'],
  },
  'CH - Gardens v1,1': {
    hedge: ['objects/hedge_path_edge.png'],
    streamTexture: ['paths/water_shallow.png'],
  },
  'CH - Into The Woods': {
    pondTexture: ['materials/water_tile.png'],
    caveRock: ['objects/rock_01.png', 'objects/rock_02.png'],
  },
  'CH - Sea v0,4': { stalagmite: ['objects/stalagmite_01.png', 'objects/stalagmite_05.png'] },
  'CH - Ruins v1,0': {
    ruin: ['objects/roof_tower_01.png'],
    ruinWallTexture: ['paths/wall_stone2_ruins.png'],
  },
  'CH - Scenes v0,9': {
    marketStall: ['objects/awning_7a.png', 'objects/awning_1a.png', 'objects/awning_2b.png'],
    streetTexture: ['patterns/normal/tiles_street_1a.png'],
    plazaTexture: ['patterns/normal/tiles_street_1a.png'],
  },
  'CH - Team v0,7': { dock: ['paths/dock.png'] },
  'CH - Tomb & Anvil v1,2': { sarcophagus: ['objects/sarcophagus_l_6a.png'] },
  'CH - Mechanism v0,7': { pumpWheel: ['objects/waterwheel_1.png'] },
  'CH - Worldmap': {
    mountain: ['objects/mountain_1a.png', 'objects/mountain_2a.png'],
    hill: ['objects/hill_1a.png'],
  },
  'CHR - Town Maps v0,5': {
    travel: ['objects/inn_01.png'],
    sacred: ['objects/church_01.png'],
    stronghold: ['objects/wood_walls_tower.png'],
    settlement: ['objects/house_01.png', 'objects/house_03.png'],
    atlasBridge: ['objects/wood_bridge_01.png'],
    villageGreenTexture: ['terrain/chr_grass.png'],
  },
  'TC Artificial Assets V1.60': {
    marketStall: [
      'objects/TC Artificial Assets/TC Food/TC_Traders Post Asset Pack_MarketStand2.webp',
      'objects/TC Artificial Assets/TC Food/TC_Traders Post Asset Pack_MarketStand3.webp',
    ],
    burialBell: ['objects/TC Artificial Assets/TC Tools & Machines/TC Tools/TC_Traders Post Asset Pack_Handbell.webp'],
    winch: ['objects/TC Artificial Assets/TC Misc/TC_Anchor Winch_2x2.webp'],
  },
  'TC Natural Assets V1.34': {
    lair: ['objects/TC Natural Assets/TC Minerals/TC Stone Structures/TC_Cave Entrance 01_2x2.webp'],
    standingStone: ['objects/TC Natural Assets/TC Minerals/TC_Standing Stone 01_2x2.webp'],
  },
  'TC Buildings Assets V1.14': {
    innRoof: ['objects/TC Roofs/TC City Roofs/TC_Mannered Bear Inn_4x3.webp', 'objects/TC Roofs/TC City Roofs/TC_Warty Hag Inn_4x3.webp'],
    millRoof: ['objects/TC Roofs/TC City Roofs/TC_Town Map Asset Pack_Windmill.webp'],
    barnRoof: ['objects/TC Roofs/TC City Roofs/TC_Town Map Asset Pack_Barn.webp'],
    chapelRoof: ['objects/TC Roofs/TC City Roofs/TC_Town Map Asset Pack_Church.webp'],
    lighthouse: ['objects/TC Roofs/TC Buildings Roofs/TC_Arcane Lighthouse Roof Asset_6x6.webp'],
  },
  'TMC Taverns 2': {
    bar: ['objects/MAD_Taverns2_Print_Bar_Counter_3x6_3x7.png'],
    rug: ['objects/MAD_Taverns2_Print_Fancy_Rug_Small_2x1.png'],
  },
  'TMC Undercavern': {
    caveFungus: ['objects/MAD_XX_PurpleFungus_04.png', 'objects/MAD_XX_YellowFungus_Medium_01.png'],
  },
};

export function findLibraryArt(packs: readonly Pack[]): Theme {
  const picks: Theme = {};
  for (const [packName, roles] of Object.entries(libraryArt)) {
    const pack = packs.find(item => item.name.toLowerCase() === packName.toLowerCase());
    if (!pack) continue;
    const assets = new Map(pack.assets.map(asset => [asset.relativePath.toLowerCase(), asset.id]));
    for (const [role, paths] of Object.entries(roles)) {
      const matches = paths.map(path => assets.get(path.toLowerCase())).filter(id => id !== undefined);
      if (matches.length) (picks[role] ??= []).push(...matches);
    }
  }
  return picks;
}
