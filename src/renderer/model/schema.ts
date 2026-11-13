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

export const AreaEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('area'),
  role: AreaRoleSchema,
  rings: z.array(z.array(PointSchema).min(3)).min(1),
  elevation: z.number().finite().optional(),
  fill: z.string().optional(),
});

export const PathEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('path'),
  role: PathRoleSchema,
  points: z.array(PointSchema).min(2),
  width: z.number().positive().finite(),
  closed: z.boolean(),
});

export const WallEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('wall'),
  points: z.array(PointSchema).min(2),
  blocksMove: z.boolean(),
  blocksSight: z.boolean(),
});

export const DoorEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('door'),
  a: PointSchema,
  b: PointSchema,
  kind: z.enum(['door', 'secret']),
  open: z.boolean(),
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

export const PortalEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('portal'),
  x: z.number().finite(),
  y: z.number().finite(),
  targetMapId: z.string().min(1),
  targetPortalId: z.string().min(1).optional(),
});

export const PlaceEntitySchema = z.object({
  ...EntityBaseShape,
  type: z.literal('place'),
  name: z.string().min(1),
  category: z.string(),
  notes: z.string(),
  gmNotes: z.string(),
  entityIds: z.array(z.string().min(1)),
  childMapId: z.string().min(1).optional(),
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
export type PlaceEntity = z.infer<typeof PlaceEntitySchema>;
export type EntityType = Entity['type'];

export const GeneratorRecordSchema = z.object({
  type: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
  regionEntityId: z.string().min(1),
});
export type GeneratorRecord = z.infer<typeof GeneratorRecordSchema>;

export const MapDocSchema = z.object({
  formatVersion: z.number().int().positive().default(1),
  id: z.string().min(1),
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
  revision: z.number().int().nonnegative(),
  deleted: z.record(z.string(), z.number().int().nonnegative()),
  link: z
    .object({
      worldId: z.string().min(1),
      mapId: z.string().min(1),
      syncedTheirRev: z.number().int().nonnegative(),
      syncedMyRev: z.number().int().nonnegative(),
    })
    .optional(),
  fog: z.object({
    enabled: z.boolean(),
    revealed: z.array(z.array(z.array(PointSchema))),
  }),
});
export type MapDoc = z.infer<typeof MapDocSchema>;

export const ThemeSchema = z.record(z.string(), z.array(z.string()));
export type Theme = z.infer<typeof ThemeSchema>;

export const WorldMapSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: MapKindSchema,
  parentId: z.string().min(1).optional(),
});
export type WorldMapSummary = z.infer<typeof WorldMapSummarySchema>;

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
});
export type WorldMeta = z.infer<typeof WorldMetaSchema>;

export const AssetIndexEntrySchema = z.object({
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
