import { z } from 'zod';

export const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Point = z.infer<typeof PointSchema>;

export const MapKindSchema = z.enum([
  'world',
  'region',
  'settlement',
  'site',
  'interior',
]);
export type MapKind = z.infer<typeof MapKindSchema>;

export const EntityOriginSchema = z.enum(['manual', 'generated', 'inherited']);
export type EntityOrigin = z.infer<typeof EntityOriginSchema>;

export const AreaRoleSchema = z.union([
  z.enum(['land', 'water', 'plateau', 'district', 'building', 'floor']),
  z.string().regex(/^biome:.+$/),
]);
export type AreaRole = z.infer<typeof AreaRoleSchema>;

export const PathRoleSchema = z.enum([
  'road',
  'river',
  'cliff',
  'cityWall',
  'trail',
]);
export type PathRole = z.infer<typeof PathRoleSchema>;

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
  gmOnly: z.boolean(),
});
export type Layer = z.infer<typeof LayerSchema>;

const EntityBaseShape = {
  id: z.string().min(1),
  layerId: z.string().min(1),
  origin: EntityOriginSchema,
  genId: z.string().optional(),
  groupId: z.string().optional(),
  usage: z.enum(['boundary', 'reference', 'blueprint']).optional(),
  gmOnly: z.boolean().optional(),
  name: z.string().optional(),
  rev: z.number().int().nonnegative(),
  inheritedFrom: z
    .object({
      entityId: z.string().min(1),
      parentRev: z.number().int().nonnegative(),
    })
    .optional(),
};

export const ImageEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('image'),
  assetId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().finite(),
  h: z.number().positive().finite(),
  rotation: z.number().finite(),
});

const TextureFillSchema = z.object({ assetId: z.string().min(1), metersPerPixel: z.number().positive().finite(), fitToArea: z.boolean().optional() });
export const DistrictProfileSchema = z.object({
  density: z.number().min(0).max(1).default(.65),
  wealth: z.number().min(0).max(1).default(.5),
  activity: z.number().min(0).max(1).default(.5),
  access: z.enum(['open', 'restricted', 'gated']).default('open'),
});
export type DistrictProfile = z.infer<typeof DistrictProfileSchema>;

export const FloorMaterialSchema = z.enum(['wood', 'stone', 'earth']);
export type FloorMaterial = z.infer<typeof FloorMaterialSchema>;

export const RoofShapeSchema = z.enum(['gable', 'hip', 'flat', 'spire']);
export type RoofShape = z.infer<typeof RoofShapeSchema>;

export const AreaEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('area'),
  role: AreaRoleSchema,
  waterKind: z.enum(['ocean', 'lake']).optional(),
  roomPurpose: z.string().optional(),
  floorMaterial: FloorMaterialSchema.optional(),
  roofShape: RoofShapeSchema.optional(),
  roofColor: z.string().optional(),
  rings: z.array(z.array(PointSchema).min(3)).min(1),
  elevation: z.number().finite().optional(),
  fill: z.string().optional(),
  texture: TextureFillSchema.optional(),
  district: DistrictProfileSchema.optional(),
});

export const RouteTierSchema = z.enum([
  'highway',
  'road',
  'track',
  'secret',
  'gameTrail',
  'sewer',
]);
export type RouteTier = z.infer<typeof RouteTierSchema>;

export const PathEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('path'),
  role: PathRoleSchema,
  routeTier: RouteTierSchema.optional(),
  startNodeId: z.string().optional(),
  endNodeId: z.string().optional(),
  outlet: z.enum(['water','junction','boundary','authored']).optional(),
  points: z.array(PointSchema).min(2),
  width: z.number().positive().finite(),
  closed: z.boolean(),
  texture: TextureFillSchema.optional(),
});

export const WallKindSchema = z.enum([
  'solid',
  'terrain',
  'invisible',
  'ethereal',
  'window',
]);
export type WallKind = z.infer<typeof WallKindSchema>;

export const WallEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('wall'),
  points: z.array(PointSchema).min(2),
  blocksMove: z.boolean(),
  blocksSight: z.boolean(),
  blocksLight: z.boolean().optional(),
  blocksSound: z.boolean().optional(),
  wallKind: WallKindSchema.optional(),
  texture: TextureFillSchema.optional(),
});

export const DoorEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('door'),
  a: PointSchema,
  b: PointSchema,
  kind: z.enum(['door', 'secret']),
  open: z.boolean(),
  hinge: z.enum(['a', 'b']).optional(),
  swing: z.union([z.literal(1), z.literal(-1)]).optional(),
  locked: z.boolean().optional(),
});

export const PropEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('prop'),
  assetId: z.string().min(1).optional(),
  builtin: z.string().min(1).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  scale: z.number().positive().finite(),
  flipX: z.boolean(),
  w: z.number().positive().finite().optional(),
  h: z.number().positive().finite().optional(),
  suggestedSettlement: z.boolean().optional(),
  symbolKind: z.enum(['mountain', 'hill', 'forest', 'settlement', 'stronghold', 'ruin', 'lair', 'sacred', 'travel']).optional(),
  tacticalTag: z.enum(['cover', 'concealment', 'difficult', 'hazard', 'feature']).optional(),
});

export const LightEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('light'),
  x: z.number().finite(),
  y: z.number().finite(),
  radius: z.number().positive().finite(),
  color: z.string().min(1),
});

export const LabelEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('label'),
  text: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  size: z.number().positive().finite(),
});

export const ConnectorKindSchema = z.enum([
  'portal',
  'stairsUp',
  'stairsDown',
  'spiralStairs',
  'ladder',
  'slope',
  'chute',
  'balcony',
  'rubble',
  'pit',
  'secretStair',
  'elevator',
  'waterfall',
  'siphon',
  'teleport',
  'hatch',
  'chimney',
  'passwall',
]);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

export const PortalEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('portal'),
  x: z.number().finite(),
  y: z.number().finite(),
  targetMapId: z.string().min(1),
  targetPortalId: z.string().min(1).optional(),
  connectorKind: ConnectorKindSchema.optional(),
  elevationDelta: z.number().finite().optional(),
  facing: z.number().finite().optional(),
});

export const UrbancrawlLayerTierSchema = z.enum([
  'incidental',
  'focus',
  'belligerent',
]);
export type UrbancrawlLayerTier = z.infer<typeof UrbancrawlLayerTierSchema>;

export const PlaceEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('place'),
  name: z.string().min(1),
  category: z.string(),
  notes: z.string(),
  gmNotes: z.string(),
  entityIds: z.array(z.string().min(1)),
  childMapId: z.string().min(1).optional(),
  layerTier: UrbancrawlLayerTierSchema.optional(),
  activeHours: z
    .object({
      morning: z.boolean().optional(),
      day: z.boolean().optional(),
      evening: z.boolean().optional(),
      night: z.boolean().optional(),
    })
    .optional(),
  factionLinks: z.array(z.string()).optional(),
  clueNext: z.string().optional(),
  rumours: z.array(z.string()).optional(),
  stockingRole: z.enum(['Empty', 'Monster', 'Special', 'Trap']).optional(),
});

export const EntitySchema = z.discriminatedUnion('type', [
  ImageEntitySchema,
  AreaEntitySchema,
  PathEntitySchema,
  WallEntitySchema,
  DoorEntitySchema,
  PropEntitySchema,
  LightEntitySchema,
  LabelEntitySchema,
  PortalEntitySchema,
  PlaceEntitySchema,
]);
export type Entity = z.infer<typeof EntitySchema>;
export type AreaEntity = z.infer<typeof AreaEntitySchema>;
export type PathEntity = z.infer<typeof PathEntitySchema>;
export type WallEntity = z.infer<typeof WallEntitySchema>;
export type DoorEntity = z.infer<typeof DoorEntitySchema>;
export type PropEntity = z.infer<typeof PropEntitySchema>;
export type LightEntity = z.infer<typeof LightEntitySchema>;
export type LabelEntity = z.infer<typeof LabelEntitySchema>;
export type PortalEntity = z.infer<typeof PortalEntitySchema>;
export type PlaceEntity = z.infer<typeof PlaceEntitySchema>;
export type EntityType = Entity['type'];

export const GeneratorRecordSchema = z.object({
  type: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
  regionEntityId: z.string().min(1),
  boundary: z.array(z.array(PointSchema).min(3)).optional(),
  groupId: z.string().optional(),
  algorithmVersion: z.number().int().positive().optional(),
  layerId: z.string().min(1).optional(),
  themeName: z.string().min(1).optional(),
});
export type GeneratorRecord = z.infer<typeof GeneratorRecordSchema>;

// Map ids become file names (maps/<id>.json), so they must not contain path parts.
export const MapIdSchema = z.string().regex(/^(?!\.\.?$)[^\\/:*?"<>|\x00-\x1f]+$/, 'Map id cannot contain path characters');

export const MapDocSchema = z.object({
  formatVersion: z.number().int().positive().default(2),
  id: MapIdSchema,
  name: z.string().min(1),
  kind: MapKindSchema,
  parent: z
    .object({
      mapId: z.string().min(1),
      x: z.number().finite(),
      y: z.number().finite(),
      rotation: z.number().finite(),
      footprintEntityId: z.string().min(1).optional(),
    })
    .optional(),
  bounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().positive().finite(),
    h: z.number().positive().finite(),
  }),
  grid: z.object({
    size: z.number().positive().finite(),
    visible: z.boolean(),
  }),
  layers: z.array(LayerSchema),
  entities: z.record(z.string(), EntitySchema),
  generators: z.record(z.string(), GeneratorRecordSchema),
  groups: z.record(z.string(), z.object({ name: z.string(), genId: z.string().optional(), boundary: z.array(z.array(PointSchema)).optional() })).optional(),
  outsideLandIsWater: z.boolean().optional(),
  riverWidthMode: z.enum(['cartographic', 'physical']).optional(),
  level: z.number().int().optional(),
  floorGroupId: z.string().min(1).optional(),
  elevationStories: z.number().int().positive().optional(),
  terrain: z.record(z.string(), z.object({
    algorithmVersion: z.number().int(), seed: z.number().int(),
    bounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    plates: z.array(z.object({ x: z.number(), y: z.number(), vx: z.number(), vy: z.number(), oceanic: z.boolean() })),
    cells: z.array(z.object({ x: z.number(), y: z.number(), elevation: z.number(), land: z.boolean(), plate: z.number(), downstream: z.number().int().optional() })),
  })).optional(),
  revision: z.number().int().nonnegative(),
  deleted: z.record(z.string(), z.number().int().nonnegative()),
  link: z
    .object({
      worldId: z.string().min(1),
      mapId: z.string().min(1),
      syncedTheirRev: z.number().int().nonnegative(),
      syncedMyRev: z.number().int().nonnegative(),
      // Converts the linked map's entity coordinates into this map's coordinates.
      transform: z.object({x:z.number().finite(),y:z.number().finite(),scale:z.number().positive().finite(),rotation:z.number().finite()}).optional(),
    })
    .optional(),
  fog: z.object({
    enabled: z.boolean(),
    revealed: z.array(z.array(z.array(PointSchema))),
    explored: z.array(z.array(z.array(PointSchema))).optional(),
  }),
});
export type MapDoc = z.infer<typeof MapDocSchema>;

export const ThemeSchema = z.record(z.string(), z.array(z.string()));
export type Theme = z.infer<typeof ThemeSchema>;

export const WorldMapSummarySchema = z.object({
  id: MapIdSchema,
  name: z.string().min(1),
  kind: MapKindSchema,
  parentId: z.string().min(1).optional(),
});
export type WorldMapSummary = z.infer<typeof WorldMapSummarySchema>;

export const BiomeRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  temperatureMin: z.number().min(0).max(1).default(0),
  temperatureMax: z.number().min(0).max(1).default(1),
  moistureMin: z.number().min(0).max(1).default(0),
  moistureMax: z.number().min(0).max(1).default(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8f9d70'),
}).refine(r => r.temperatureMin <= r.temperatureMax && r.moistureMin <= r.moistureMax, 'Biome minimum must not exceed maximum.');
export const DEFAULT_BIOMES = [
  { name: 'snow', temperatureMax: .18, color: '#d9e3dc' },
  { name: 'tundra', temperatureMax: .3, color: '#a8b2a0' },
  { name: 'desert', moistureMax: .25, color: '#cdb77d' },
  { name: 'rainforest', temperatureMin: .7, moistureMin: .6, color: '#416d51' },
  { name: 'forest', moistureMin: .52, color: '#648260' },
  { name: 'grassland', color: '#9eaa76' },
].map(r => BiomeRuleSchema.parse(r));
export const ClimateSchema = z.object({
  temperature: z.number().min(-.8).max(.8).default(0),
  moisture: z.number().min(-.8).max(.8).default(0),
  northLatitude: z.number().min(-90).max(90).default(70),
  southLatitude: z.number().min(-90).max(90).default(-40),
  biomes: z.array(BiomeRuleSchema).min(1).max(40).default(DEFAULT_BIOMES),
});
export type Climate = z.infer<typeof ClimateSchema>;

export const WorldMetaSchema = z.object({
  formatVersion: z.number().int().positive(),
  id: z.string().min(1),
  name: z.string().min(1),
  forkedFrom: z
    .object({
      worldId: z.string().min(1),
      worldName: z.string().min(1),
    })
    .optional(),
  maps: z.array(WorldMapSummarySchema),
  themes: z.record(z.string(), ThemeSchema),
  climate: ClimateSchema.optional(),
});
export type WorldMeta = z.infer<typeof WorldMetaSchema>;

const AssetIndexEntrySchema = z.object({
  originalName: z.string(),
  packName: z.string(),
  pxPerSquare: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  ext: z.string().min(1),
});
export type AssetIndexEntry = z.infer<typeof AssetIndexEntrySchema>;

export const AssetsIndexSchema = z.record(z.string(), AssetIndexEntrySchema);
export type AssetsIndex = z.infer<typeof AssetsIndexSchema>;

export const WALL_PRESET_DEFAULTS: Record<
  WallKind,
  { blocksMove: boolean; blocksSight: boolean; blocksLight: boolean; blocksSound: boolean }
> = {
  solid: { blocksMove: true, blocksSight: true, blocksLight: true, blocksSound: true },
  terrain: { blocksMove: false, blocksSight: true, blocksLight: true, blocksSound: false },
  invisible: { blocksMove: true, blocksSight: false, blocksLight: false, blocksSound: true },
  ethereal: { blocksMove: false, blocksSight: true, blocksLight: true, blocksSound: false },
  window: { blocksMove: true, blocksSight: false, blocksLight: false, blocksSound: true },
};

export function resolveWallChannels(wall: {
  wallKind?: WallKind;
  blocksMove: boolean;
  blocksSight: boolean;
  blocksLight?: boolean;
  blocksSound?: boolean;
}) {
  const kind: WallKind =
    wall.wallKind ??
    (wall.blocksMove && wall.blocksSight
      ? 'solid'
      : wall.blocksMove && !wall.blocksSight
        ? 'invisible'
        : !wall.blocksMove && wall.blocksSight
          ? 'terrain'
          : 'window');
  return {
    wallKind: kind,
    blocksMove: wall.blocksMove,
    blocksSight: wall.blocksSight,
    blocksLight: wall.blocksLight ?? wall.blocksSight,
    blocksSound: wall.blocksSound ?? (wall.blocksMove && kind !== 'ethereal'),
  };
}
