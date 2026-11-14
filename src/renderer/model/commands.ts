import { planSync } from './sync';
import { getGenerator, regionConstraints, runGenerator } from '../gen/framework';
import '../gen/dungeon/layout';
import '../gen/glade/outdoor';
import '../gen/world/world';
import { climateContext } from '../gen/world/context';
import { previewInterior } from '../gen/dungeon/interior';
import { pointInPolygon } from '../geom/hitTest';
import { validateWorld, WorldDocumentSchema } from './transfer';
import { paintFog, rectRing } from '../geom/fog';
import { z } from 'zod';
import { clipAndInheritEntities } from '../geom/clipInherit';
import { getPlaceBounds } from '../geom/places';
import { getChildRectInParent, listKeptEditedEntities } from '../geom/pullFromParent';
import { translateEntityPatch } from '../geom/transform';
import { CLOCK_TIME, measureRoute } from '../geom/measure';
import {
  EntitySchema,
  AreaEntitySchema,
  PathEntitySchema,
  LayerSchema,
  MapDocSchema,
  MapKindSchema,
  PointSchema,
  ClimateSchema,
  type Entity,
  type Layer,
  type MapDoc,
  type WorldMeta,
} from './schema';

export interface WorldDocument {
  meta: WorldMeta;
  maps: Record<string, MapDoc>;
}

export interface CommandDef<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  input: z.ZodType<TInput>;
  run: (draft: WorldDocument, input: TInput) => TResult;
}

const registry = new Map<string, CommandDef<any, any>>();

export function registerCommand<TInput, TResult>(
  def: CommandDef<TInput, TResult>,
): CommandDef<TInput, TResult> {
  registry.set(def.name, def);
  return def;
}

export function getCommand(name: string): CommandDef | undefined {
  return registry.get(name);
}

export function listCommands(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Array.from(registry.values()).map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    inputSchema: z.toJSONSchema(cmd.input) as Record<string, unknown>,
  }));
}

export function executeCommandOnDraft(
  draft: WorldDocument,
  name: string,
  rawInput: unknown,
): unknown {
  const cmd = registry.get(name);
  if (!cmd) {
    throw new Error(`Unknown command: ${name}`);
  }
  const parsed = cmd.input.parse(rawInput);
  return cmd.run(draft, parsed);
}

function getMapOrThrow(draft: WorldDocument, mapId: string): MapDoc {
  const map = draft.maps[mapId];
  if (!map) {
    throw new Error(`Map not found: ${mapId}`);
  }
  return map;
}

registerCommand({
  name: 'generator.run',
  description: 'Generate world/continent terrain, climate, rivers and themed symbols (world/region maps), dungeon/interior or glade woodland inside an area. One undo step; manual edits survive. World params: cells (8000), seaLevel, ruggedness, rivers, riverThreshold, density (0–3), settlements (0–50). Settlement suggestions are GM-only until settlement.resolveSuggestion accepts them. Climate comes from world.setClimate.',
  input: z.object({ mapId: z.string().min(1), genId: z.string().min(1).optional(), type: z.string().min(1),
    seed: z.number().int(), params: z.record(z.string(), z.unknown()).default({}), regionEntityId: z.string().min(1),
    layerId: z.string().min(1), themeName: z.string().min(1).default('default') }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const genId = input.genId ?? crypto.randomUUID();
    if (map.generators[genId]) throw new Error('Use generator.reroll for an existing run.');
    const ids = runGenerator(map, { ...input, genId, theme: draft.meta.themes[input.themeName] ?? {}, climate: climateContext(draft, map) });
    return { genId, ids };
  },
});
registerCommand({
  name: 'generator.reroll',
  description: 'Reroll untouched generated content, or dressing only, preserving all manual edits. Supply the new seed.',
  input: z.object({ mapId: z.string().min(1), genId: z.string().min(1), seed: z.number().int(),
    params: z.record(z.string(), z.unknown()).optional(), themeName:z.string().min(1).optional(), dressingOnly: z.boolean().default(false) }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId), record = map.generators[input.genId];
    if (!record) throw new Error('Generator run not found.');
    const themeName = input.themeName ?? record.themeName ?? 'default';
    const ids = runGenerator(map, { ...record, ...input, params: input.params ?? record.params,
      layerId: record.layerId ?? map.layers[0]!.id, themeName, theme: draft.meta.themes[themeName] ?? {}, climate: climateContext(draft, map) });
    return { genId: input.genId, ids };
  },
});
registerCommand({
  name: 'settlement.resolveSuggestion',
  description: 'Accept a suggested settlement as a permanent map symbol and named place, or dismiss it. One undo step. Accepted settlements survive generator rerolls.',
  input: z.object({ mapId: z.string().min(1), entityId: z.string().min(1), action: z.enum(['accept', 'dismiss']), name: z.string().trim().min(1).optional() }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId), entity = map.entities[input.entityId];
    if (entity?.type !== 'prop' || !entity.suggestedSettlement) throw new Error('Settlement suggestion not found.');
    const layer = map.layers.find(l => l.id === entity.layerId);
    if (!layer || layer.locked) throw new Error('Unlock the suggestion layer first.');
    map.revision++;
    if (input.action === 'dismiss') {
      delete map.entities[entity.id]; map.deleted[entity.id] = map.revision;
      for (const e of Object.values(map.entities)) if (e.type === 'place' && e.entityIds.includes(entity.id)) {
        e.entityIds = e.entityIds.filter(id => id !== entity.id); e.rev = map.revision;
      }
      return { id: entity.id };
    }
    entity.name = input.name ?? entity.name?.replace(' suggestion', '') ?? 'Settlement';
    entity.origin = 'manual'; entity.gmOnly = false; entity.rev = map.revision;
    delete entity.suggestedSettlement;
    const id = crypto.randomUUID();
    map.entities[id] = { id, type: 'place', name: entity.name, category: 'settlement', notes: '', gmNotes: '',
      entityIds: [entity.id], layerId: entity.layerId, origin: 'manual', rev: map.revision };
    return { id: entity.id, placeId: id };
  },
});
registerCommand({
  name: 'world.setClimate',
  description: 'Set world temperature/moisture biases (-0.8 to 0.8), north/south latitude, and first-match biome rules with custom names and colors. Reroll a continent to apply. Transfers can re-climate generated biomes on arrival.',
  input: z.object({ climate: ClimateSchema }),
  run(draft, input) { draft.meta.climate = input.climate; return input.climate; },
});
registerCommand({
  name: 'generator.accept',
  description: 'Keep this result as manual content and finish its generator run. Undo restores the run.',
  input: z.object({ mapId: z.string().min(1), genId: z.string().min(1) }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (!map.generators[input.genId]) throw new Error('Generator run not found.');
    map.revision++;
    for (const e of Object.values(map.entities)) if (e.genId === input.genId && e.origin === 'generated') {
      e.origin = 'manual'; e.rev = map.revision;
    }
    delete map.generators[input.genId];
    return { genId: input.genId };
  },
});
registerCommand({
  name: 'generator.dressArea',
  description: 'Thin out, add more, or reroll generated dressing inside an area. Manual props and the layout are kept.',
  input: z.object({mapId:z.string().min(1),genId:z.string().min(1),areaEntityId:z.string().min(1),
    action:z.enum(['thin','more','reroll']),seed:z.number().int().optional(),
    params:z.record(z.string(),z.unknown()).optional(),themeName:z.string().min(1).optional()}),
  run(draft,input) {
    const map=getMapOrThrow(draft,input.mapId), record=map.generators[input.genId], area=map.entities[input.areaEntityId];
    if(!record || area?.type!=='area') throw new Error('Choose a generator run and an area.');
    const definition=getGenerator(record.type);
    if(!definition.dress) throw new Error('This generator has no dressing pass.');
    const footprint=map.entities[record.regionEntityId];
    if(footprint?.type!=='area') throw new Error('Generator footprint is missing.');
    const layer=map.layers.find(l=>l.id===(record.layerId??map.layers[0]?.id));
    if(!layer?.visible||layer.locked) throw new Error('Choose a visible, unlocked layer.');
    const scoped=Object.values(map.entities).filter(e=>e.genId===input.genId&&e.origin==='generated'&&e.type==='prop'&&pointInPolygon(e,area.rings));
    if(scoped.some(e=>map.layers.find(l=>l.id===e.layerId)?.locked)) throw new Error('Unlock the dressing layers first.');
    const removed=input.action==='more'?[]:input.action==='thin'?scoped.filter((_,i)=>i%2===0):scoped;
    const removeIds=new Set(removed.map(e=>e.id));
    const seed=input.seed??((record.seed+1)>>>0);
    const params=definition.params.parse(input.params??record.params),themeName=input.themeName??record.themeName??'default';
    const output=input.action==='thin'?[]:definition.dress({seed,params,region:footprint.rings,
      constraints:[...regionConstraints(map,footprint.rings,footprint.id),...Object.values(map.entities).filter(e=>e.type==='prop'&&e.origin==='generated'&&!removeIds.has(e.id))],
      theme:draft.meta.themes[themeName]??{},grid:map.grid.size},
      Object.values(map.entities).filter(e=>e.genId===input.genId&&e.type!=='prop'))
      .filter(e=>e.type==='prop'&&pointInPolygon(e,area.rings));
    if(!removed.length&&!output.length) return {ids:[],removed:[]};
    map.revision++;
    record.params=params;record.themeName=themeName;
    for(const e of removed) {delete map.entities[e.id];map.deleted[e.id]=map.revision;}
    const ids=output.map(e=>{
      const id=`${input.genId}:${map.revision}:${e.id}`;
      if(map.entities[id]) throw new Error(`Generated id already exists: ${id}`);
      map.entities[id]=EntitySchema.parse({...e,id,genId:input.genId,layerId:layer.id,rev:map.revision});
      return id;
    });
    for(const e of Object.values(map.entities)) if(e.type==='place'&&e.entityIds.some(id=>removeIds.has(id))) {
      e.entityIds=e.entityIds.filter(id=>!removeIds.has(id));e.rev=map.revision;
    }
    return {ids,removed:[...removeIds]};
  },
});
registerCommand({
  name:'map.generateInterior',
  description:'Generate an interior from a settlement building footprint and its doors, linking it to the existing or newly created place. One undo step.',
  input:z.object({parentMapId:z.string().min(1),buildingId:z.string().min(1),placeId:z.string().min(1).optional(),
    childMapId:z.string().min(1).optional(),name:z.string().trim().min(1).optional(),seed:z.number().int(),
    params:z.record(z.string(),z.unknown()).default({}),themeName:z.string().min(1).default('default'),
    expectedParentRevision:z.number().int().nonnegative().optional()}),
  run(draft,input) {
    const parent=getMapOrThrow(draft,input.parentMapId), building=parent.entities[input.buildingId];
    if(input.expectedParentRevision!==undefined && parent.revision!==input.expectedParentRevision) throw new Error('The building map changed. Preview the interior again.');
    if(building?.type!=='area'||building.role!=='building') throw new Error('Choose a building footprint.');
    const layer=parent.layers.find(l=>l.id===building.layerId);
    if(!layer?.visible||layer.locked) throw new Error('Choose a visible, unlocked building.');
    const matches=Object.values(parent.entities).filter(e=>e.type==='place'&&e.entityIds.includes(building.id));
    if(!input.placeId&&matches.length>1) throw new Error('This building belongs to several places. Supply placeId.');
    const place=input.placeId?parent.entities[input.placeId]:matches[0];
    if(place&&(place.type!=='place'||!place.entityIds.includes(building.id))) throw new Error('Place is not linked to this building.');
    if(input.placeId&&!place) throw new Error('Place not found.');
    if(place?.type==='place'&&place.childMapId) throw new Error('This place already has an interior. Open it instead.');
    const id=input.childMapId??crypto.randomUUID();
    if(draft.maps[id]) throw new Error('Interior map id already exists.');
    const child=previewInterior(parent,{...input,childMapId:id,name:input.name??`${place?.name??building.name??'Building'} Interior`,
      theme:draft.meta.themes[input.themeName]??{}});
    draft.maps[id]=child;
    draft.meta.maps.push({id,name:child.name,kind:'interior',parentId:parent.id});
    parent.revision++;
    if(building.origin==='generated') {building.origin='manual';building.rev=parent.revision;}
    if(place?.type==='place') {place.childMapId=id;place.rev=parent.revision;}
    else {
      const placeId=crypto.randomUUID();
      parent.entities[placeId]={id:placeId,type:'place',layerId:building.layerId,origin:'manual',rev:parent.revision,
        name:building.name??'Building',category:String(input.params.purpose??''),notes:'',gmNotes:'',entityIds:[building.id],childMapId:id};
    }
    return {id,genId:'interior-generator'};
  },
});

// --- Core Entity Commands ---

const AssetReferenceShape = {
  packAssetId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
};
registerCommand({
  name: 'prop.stamp',
  description: 'Stamp a prop. Supply packAssetId for copy-on-use, assetId with w/h for imported art, or builtin (tree, rock, table, bed, etc.) for flat art. Sizes are metres before scale.',
  input: z.object({ ...AssetReferenceShape, mapId: z.string().min(1), layerId: z.string().min(1), id: z.string().min(1).optional(),
    builtin: z.string().min(1).optional(),
    x: z.number().finite(), y: z.number().finite(), w: z.number().positive().finite().optional(), h: z.number().positive().finite().optional(),
    rotation: z.number().finite().default(0), scale: z.number().positive().finite().default(1), flipX: z.boolean().default(false) }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const layer = map.layers.find(l => l.id === input.layerId);
    if (!layer?.visible || layer.locked) throw new Error('Choose a visible, unlocked layer.');
    if (!input.builtin && (!input.assetId || !input.w || !input.h)) throw new Error('An imported asset and its dimensions, or a built-in prop, are required.');
    const id = input.id ?? `prop-${crypto.randomUUID()}`;
    if (map.entities[id]) throw new Error(`Entity already exists: ${id}`);
    map.revision++;
    map.entities[id] = { type: 'prop', id, layerId: layer.id, origin: 'manual', rev: map.revision,
      assetId: input.assetId, builtin:input.builtin, w: input.w ?? 1.524, h: input.h ?? 1.524, x: input.x, y: input.y, rotation: input.rotation, scale: input.scale, flipX: input.flipX };
    delete map.deleted[id];
    return { id };
  },
});
registerCommand({
  name: 'entity.setTexture',
  description: 'Apply a repeating texture to selected areas, paths or walls. Supply packAssetId for copy-on-use or assetId and metersPerPixel; clear:true removes texture.',
  input: z.object({ ...AssetReferenceShape, mapId: z.string().min(1), entityIds: z.array(z.string().min(1)).min(1),
    metersPerPixel: z.number().positive().finite().optional(), clear: z.boolean().default(false) }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (!input.clear && (!input.assetId || !input.metersPerPixel)) throw new Error('An imported texture and its scale are required.');
    const entities = input.entityIds.map(id => {
      const e = map.entities[id];
      if (!e || (e.type !== 'area' && e.type !== 'path' && e.type !== 'wall')) throw new Error('Textures apply to areas, paths and walls.');
      const layer = map.layers.find(l => l.id === e.layerId);
      if (!layer?.visible || layer.locked) throw new Error('Choose a visible, unlocked layer.');
      return e;
    });
    map.revision++;
    for (const e of entities) {
      if (input.clear) delete e.texture;
      else e.texture = { assetId: input.assetId!, metersPerPixel: input.metersPerPixel! };
      e.origin = 'manual'; e.rev = map.revision;
    }
    return { ids: input.entityIds };
  },
});

const EntityAddInputSchema = z.object({
  mapId: z.string().min(1),
  entity: EntitySchema,
});

registerCommand({
  name: 'entity.add',
  description: 'Add a new entity to a map.',
  input: EntityAddInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (map.entities[input.entity.id]) {
      throw new Error(`Entity already exists: ${input.entity.id}`);
    }
    map.revision += 1;
    const entity: Entity = {
      ...input.entity,
      rev: map.revision,
    };
    map.entities[entity.id] = entity;
    delete map.deleted[entity.id];
    return { id: entity.id };
  },
});

const EntityUpdateInputSchema = z.object({
  mapId: z.string().min(1),
  entityId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

registerCommand({
  name: 'entity.update',
  description: 'Update fields on an existing entity. Marks generated/inherited entities as manual.',
  input: EntityUpdateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const existing = map.entities[input.entityId];
    if (!existing) {
      throw new Error(`Entity not found: ${input.entityId}`);
    }
    map.revision += 1;
    const candidate = {
      ...existing,
      ...input.patch,
      id: existing.id,
      type: existing.type,
      origin: existing.origin === 'manual' ? 'manual' : 'manual',
      rev: map.revision,
    };
    const validated = EntitySchema.parse(candidate);
    map.entities[existing.id] = validated;
    return { id: validated.id };
  },
});

const EntityDeleteInputSchema = z.object({
  mapId: z.string().min(1),
  entityId: z.string().min(1),
});

registerCommand({
  name: 'entity.delete',
  description: 'Delete an entity from a map and record its deletion revision.',
  input: EntityDeleteInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (!map.entities[input.entityId]) {
      throw new Error(`Entity not found: ${input.entityId}`);
    }
    map.revision += 1;
    delete map.entities[input.entityId];
    map.deleted[input.entityId] = map.revision;
    for (const ent of Object.values(map.entities)) {
      if (ent.type === 'place' && ent.entityIds.includes(input.entityId)) {
        ent.entityIds = ent.entityIds.filter((id) => id !== input.entityId);
        ent.rev = map.revision;
      }
    }
    return { id: input.entityId };
  },
});

const EntityDuplicateInputSchema = z.object({
  mapId: z.string().min(1),
  entityIds: z.array(z.string().min(1)).min(1),
  dx: z.number().finite().default(1),
  dy: z.number().finite().default(1),
});

registerCommand({
  name: 'entity.duplicate',
  description: 'Duplicate one or more entities on a map with an optional offset.',
  input: EntityDuplicateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const createdIds: string[] = [];
    map.revision += 1;
    for (const sourceId of input.entityIds) {
      const existing = map.entities[sourceId];
      if (!existing) {
        throw new Error(`Entity not found: ${sourceId}`);
      }
      const newId = crypto.randomUUID();
      const offsetPatch = translateEntityPatch(existing, input.dx, input.dy);
      const clone = EntitySchema.parse({
        ...existing,
        ...offsetPatch,
        id: newId,
        origin: 'manual',
        genId: undefined,
        inheritedFrom: undefined,
        rev: map.revision,
      });
      map.entities[newId] = clone;
      createdIds.push(newId);
    }
    return { ids: createdIds };
  },
});

// --- Layer Commands ---

registerCommand({
  name: 'map.importSvg',
  description: 'Import flattened SVG area/path entities as manual geometry in one undo step. Coordinates and path widths are metres.',
  input: z.object({
    mapId: z.string().min(1),
    layerId: z.string().min(1),
    shapes: z.array(z.discriminatedUnion('type', [
      AreaEntitySchema.omit({ id: true, layerId: true, origin: true, rev: true, genId: true, inheritedFrom: true }),
      PathEntitySchema.omit({ id: true, layerId: true, origin: true, rev: true, genId: true, inheritedFrom: true }),
    ])).min(1).max(10000),
  }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const layer = map.layers.find((l) => l.id === input.layerId);
    if (!layer) throw new Error('Import layer no longer exists.');
    if (layer.locked || !layer.visible) throw new Error('Choose a visible, unlocked layer for the import.');
    map.revision += 1;
    const ids = input.shapes.map((shape) => {
      const id = crypto.randomUUID();
      map.entities[id] = {
        ...shape, id, layerId: layer.id, origin: 'manual', rev: map.revision,
      };
      return id;
    });
    return { ids };
  },
});

const LayerAddInputSchema = z.object({
  mapId: z.string().min(1),
  layer: LayerSchema,
  index: z.number().int().nonnegative().optional(),
});

registerCommand({
  name: 'layer.add',
  description: 'Add a layer to a map.',
  input: LayerAddInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (map.layers.some((l) => l.id === input.layer.id)) {
      throw new Error(`Layer already exists: ${input.layer.id}`);
    }
    map.revision += 1;
    const layer: Layer = { ...input.layer };
    if (input.index !== undefined && input.index <= map.layers.length) {
      map.layers.splice(input.index, 0, layer);
    } else {
      map.layers.push(layer);
    }
    return { id: layer.id };
  },
});

const LayerUpdateInputSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
  patch: LayerSchema.omit({ id: true }).partial(),
});

registerCommand({
  name: 'layer.update',
  description: 'Update layer visibility, lock, name, or gmOnly flag.',
  input: LayerUpdateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const layer = map.layers.find((l) => l.id === input.layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${input.layerId}`);
    }
    map.revision += 1;
    Object.assign(layer, input.patch);
    return { id: layer.id };
  },
});

const LayerDeleteInputSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
});

registerCommand({
  name: 'layer.delete',
  description: 'Delete a layer from a map.',
  input: LayerDeleteInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const idx = map.layers.findIndex((l) => l.id === input.layerId);
    if (idx === -1) {
      throw new Error(`Layer not found: ${input.layerId}`);
    }
    if (map.layers.length <= 1) {
      throw new Error('Cannot delete the last layer of a map');
    }
    map.revision += 1;
    map.layers.splice(idx, 1);
    return { id: input.layerId };
  },
});

const LayerReorderInputSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
  toIndex: z.number().int().nonnegative(),
});

registerCommand({
  name: 'layer.reorder',
  description: 'Move a layer to a new draw-order index on a map.',
  input: LayerReorderInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const fromIndex = map.layers.findIndex((l) => l.id === input.layerId);
    if (fromIndex === -1) {
      throw new Error(`Layer not found: ${input.layerId}`);
    }
    const clamped = Math.min(input.toIndex, map.layers.length - 1);
    if (fromIndex === clamped) {
      return { id: input.layerId, index: clamped };
    }
    map.revision += 1;
    const [layer] = map.layers.splice(fromIndex, 1);
    map.layers.splice(clamped, 0, layer!);
    return { id: input.layerId, index: clamped };
  },
});

// --- Map Commands ---

registerCommand({
  name: 'map.measureRoute',
  description: 'Measure a route in metre coordinates. Returns feet/miles, optional constant-speed travel duration and 24-hour arrival with day offset. Speed is miles/hour; departure is HH:MM. Read-only: creates no undo step or dirty files.',
  input: z.object({
    mapId: z.string().min(1),
    points: z.array(PointSchema).min(2).max(10000),
    speedMph: z.number().positive().finite().optional(),
    departure: z.string().regex(CLOCK_TIME).optional(),
  }),
  run(draft, input) {
    getMapOrThrow(draft, input.mapId);
    return measureRoute(input.points, input.speedMph, input.departure);
  },
});

const MapCreateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: MapKindSchema,
  parentId: z.string().min(1).optional(),
  bounds: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      w: z.number().positive().finite(),
      h: z.number().positive().finite(),
    })
    .optional(),
  gridSize: z.number().positive().finite().optional(),
});

registerCommand({
  name: 'map.create',
  description: 'Create a new map in the world.',
  input: MapCreateInputSchema,
  run(draft, input) {
    if (draft.maps[input.id]) {
      throw new Error(`Map already exists: ${input.id}`);
    }
    const defaultGrid =
      input.kind === 'interior' || input.kind === 'site' ? 1.524 : 100;
    const map = MapDocSchema.parse({
      formatVersion: 1,
      id: input.id,
      name: input.name,
      kind: input.kind,
      parent: input.parentId
        ? { mapId: input.parentId, x: 0, y: 0, rotation: 0 }
        : undefined,
      bounds: input.bounds ?? { x: 0, y: 0, w: 1000, h: 1000 },
      grid: {
        size: input.gridSize ?? defaultGrid,
        visible: input.kind === 'interior' || input.kind === 'site',
      },
      layers: [
        {
          id: 'layer-base',
          name: 'Base',
          visible: true,
          locked: false,
          gmOnly: false,
        },
      ],
      entities: {},
      generators: {},
      revision: 1,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    });
    draft.maps[map.id] = map;
    draft.meta.maps.push({
      id: map.id,
      name: map.name,
      kind: map.kind,
      parentId: input.parentId,
    });
    return { id: map.id };
  },
});

const ThemeSetRoleInputSchema = z.object({
  themeName: z.string().min(1).default('default'),
  role: z.string().min(1),
  assetIds: z.array(z.string().min(1)).default([]),
  packAssetIds: z.array(z.string().min(1)).optional(),
});

registerCommand({
  name: 'theme.setRole',
  description: 'Assign asset ids to a generator role in a world theme.',
  input: ThemeSetRoleInputSchema,
  run(draft, input) {
    if (input.packAssetIds?.length) throw new Error('Copy pack assets into the world before assigning the role.');
    const theme = (draft.meta.themes[input.themeName] ??= {});
    theme[input.role] = [...new Set(input.assetIds)];
    return { themeName: input.themeName, role: input.role };
  },
});

// --- Place Commands ---

const PlaceCreateInputSchema = z.object({
  mapId: z.string().min(1),
  id: z.string().min(1).optional(),
  layerId: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  category: z.string().default(''),
  notes: z.string().default(''),
  gmNotes: z.string().default(''),
  entityIds: z.array(z.string().min(1)).default([]),
  gmOnly: z.boolean().optional(),
  childMapId: z.string().min(1).optional(),
});

registerCommand({
  name: 'place.create',
  description: 'Create a persistent place entity from selected entity IDs on a map.',
  input: PlaceCreateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const id = input.id ?? crypto.randomUUID();
    if (map.entities[id]) {
      throw new Error(`Entity already exists: ${id}`);
    }
    const layerId = input.layerId ?? map.layers[0]?.id;
    if (!layerId || !map.layers.some((l) => l.id === layerId)) {
      throw new Error(`Layer not found: ${layerId ?? '(none)'}`);
    }
    const uniqueEntityIds: string[] = [];
    const seen = new Set<string>();
    for (const eid of input.entityIds) {
      if (seen.has(eid)) continue;
      const target = map.entities[eid];
      if (!target) {
        throw new Error(`Linked entity not found: ${eid}`);
      }
      if (target.type === 'place') {
        throw new Error(`Cannot link a place to another place: ${eid}`);
      }
      seen.add(eid);
      uniqueEntityIds.push(eid);
    }
    map.revision += 1;
    const place = EntitySchema.parse({
      id,
      type: 'place',
      layerId,
      origin: 'manual',
      rev: map.revision,
      gmOnly: input.gmOnly,
      name: input.name,
      category: input.category,
      notes: input.notes,
      gmNotes: input.gmNotes,
      entityIds: uniqueEntityIds,
      childMapId: input.childMapId,
    });
    map.entities[id] = place;
    delete map.deleted[id];
    return { id };
  },
});

const MapDevelopAreaInputSchema = z.object({
  parentMapId: z.string().min(1),
  childMapId: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  kind: MapKindSchema,
  rect: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().positive().finite(),
    h: z.number().positive().finite(),
  }),
});

function buildChildMapDoc(
  id: string,
  name: string,
  kind: z.infer<typeof MapKindSchema>,
  parentMap: MapDoc,
  rect: { x: number; y: number; w: number; h: number },
): MapDoc {
  const defaultGrid =
    kind === 'interior' || kind === 'site'
      ? 1.524
      : kind === 'settlement'
        ? 10
        : 100;
  const inherited = clipAndInheritEntities(parentMap, rect, 'layer-base');
  const entities: Record<string, Entity> = {};
  for (const ent of inherited) {
    entities[ent.id] = ent;
  }
  return MapDocSchema.parse({
    formatVersion: 1,
    id,
    name,
    kind,
    parent: {
      mapId: parentMap.id,
      x: rect.x,
      y: rect.y,
      rotation: 0,
    },
    bounds: { x: 0, y: 0, w: rect.w, h: rect.h },
    grid: {
      size: defaultGrid,
      visible: kind === 'interior' || kind === 'site',
    },
    layers: [
      {
        id: 'layer-base',
        name: 'Base',
        visible: true,
        locked: false,
        gmOnly: false,
      },
    ],
    entities,
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  });
}

registerCommand({
  name: 'map.developArea',
  description: 'Create a child map from a rectangular area of a parent map, clipping and inheriting parent geometry.',
  input: MapDevelopAreaInputSchema,
  run(draft, input) {
    const parentMap = getMapOrThrow(draft, input.parentMapId);
    const id = input.childMapId ?? crypto.randomUUID();
    if (draft.maps[id]) {
      throw new Error(`Map already exists: ${id}`);
    }
    const childMap = buildChildMapDoc(
      id,
      input.name,
      input.kind,
      parentMap,
      input.rect,
    );
    draft.maps[childMap.id] = childMap;
    draft.meta.maps.push({
      id: childMap.id,
      name: childMap.name,
      kind: childMap.kind,
      parentId: parentMap.id,
    });
    return {
      id: childMap.id,
      inheritedCount: Object.keys(childMap.entities).length,
    };
  },
});

const MapOpenInteriorInputSchema = z.object({
  parentMapId: z.string().min(1),
  placeId: z.string().min(1),
  childMapId: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  w: z.number().positive().finite().optional(),
  h: z.number().positive().finite().optional(),
});

registerCommand({
  name: 'map.openInterior',
  description: 'Open or create an interior child map linked to a place entity.',
  input: MapOpenInteriorInputSchema,
  run(draft, input) {
    const parentMap = getMapOrThrow(draft, input.parentMapId);
    const place = parentMap.entities[input.placeId];
    if (!place || place.type !== 'place') {
      throw new Error(`Place not found: ${input.placeId}`);
    }
    if (place.childMapId && draft.maps[place.childMapId]) {
      return { id: place.childMapId, created: false };
    }
    const id = input.childMapId ?? crypto.randomUUID();
    if (draft.maps[id]) {
      throw new Error(`Map already exists: ${id}`);
    }
    const bounds = getPlaceBounds(parentMap, place);
    const rect = bounds
      ? {
          x: bounds.minX,
          y: bounds.minY,
          w: Math.max(5, bounds.maxX - bounds.minX),
          h: Math.max(5, bounds.maxY - bounds.minY),
        }
      : {
          x: 0,
          y: 0,
          w: input.w ?? 30,
          h: input.h ?? 30,
        };
    const childMap = buildChildMapDoc(
      id,
      input.name ?? `${place.name} Interior`,
      'interior',
      parentMap,
      rect,
    );
    draft.maps[childMap.id] = childMap;
    draft.meta.maps.push({
      id: childMap.id,
      name: childMap.name,
      kind: 'interior',
      parentId: parentMap.id,
    });
    parentMap.revision += 1;
    place.childMapId = childMap.id;
    place.rev = parentMap.revision;
    return { id: childMap.id, created: true };
  },
});

const MapPullFromParentInputSchema = z.object({
  mapId: z.string().min(1),
});

registerCommand({
  name: 'map.pullFromParent',
  description: 'Re-clip parent geometry into a child map, replacing unedited inherited entities while keeping manual edits.',
  input: MapPullFromParentInputSchema,
  run(draft, input) {
    const childMap = getMapOrThrow(draft, input.mapId);
    if (!childMap.parent) {
      throw new Error(`Map has no parent: ${input.mapId}`);
    }
    const parentMap = getMapOrThrow(draft, childMap.parent.mapId);
    const rect = getChildRectInParent(childMap);
    if (!rect) {
      throw new Error(`Invalid parent rect for map: ${input.mapId}`);
    }
    const targetLayerId = childMap.layers[0]?.id;
    if (!targetLayerId) {
      throw new Error(`Child map has no layers: ${input.mapId}`);
    }

    childMap.revision += 1;
    let replacedCount = 0;
    for (const [eid, ent] of Object.entries(childMap.entities)) {
      if (ent.origin === 'inherited') {
        delete childMap.entities[eid];
        childMap.deleted[eid] = childMap.revision;
        replacedCount += 1;
      }
    }

    const keptEdited = listKeptEditedEntities(childMap);
    const editedParentIds = new Set(keptEdited.map((k) => k.parentEntityId));

    const fresh = clipAndInheritEntities(parentMap, rect, targetLayerId);
    let addedCount = 0;
    for (const ent of fresh) {
      if (ent.inheritedFrom && editedParentIds.has(ent.inheritedFrom.entityId)) {
        continue;
      }
      const next = { ...ent, rev: childMap.revision };
      childMap.entities[next.id] = next;
      delete childMap.deleted[next.id];
      addedCount += 1;
    }

    return {
      mapId: childMap.id,
      replacedCount,
      addedCount,
      keptEdited,
    };
  },
});

registerCommand({
  name:'fog.paint', description:'Enable/disable fog, reveal/hide a brush stroke (radius in metres), or reveal/hide the whole map. One stroke is one undo step.',
  input:z.object({mapId:z.string().min(1),mode:z.enum(['enable','disable','reveal','hide','revealAll','hideAll']),points:z.array(PointSchema).max(10000).default([]),radius:z.number().positive().finite().default(3)}),
  run(draft,input) {
    const map = getMapOrThrow(draft,input.mapId);
    if (input.mode === 'enable' || input.mode === 'disable') map.fog.enabled = input.mode === 'enable';
    else {
      map.fog.enabled = true;
      if (input.mode === 'revealAll') map.fog.revealed = [[rectRing(map.bounds)]];
      else if (input.mode === 'hideAll') map.fog.revealed = [];
      else map.fog.revealed = paintFog(map.fog.revealed,input.points,input.radius,input.mode === 'hide');
    }
    map.revision++;
  },
});

registerCommand({
  name:'world.applyTransfer',description:'Apply a validated transfer result to the open world as one undo step. Refuses if the world changed while the transfer was being prepared.',
  input:z.object({before:WorldDocumentSchema,after:WorldDocumentSchema}),
  run(draft,input) {
    // Saved snapshots are schema-parsed; normalize the live document's field order too.
    if(JSON.stringify(WorldDocumentSchema.parse(draft))!==JSON.stringify(input.before)) throw new Error('World changed during transfer. The target copy is safe; reopen it or retry from the current source.');
    const next=validateWorld(input.after);
    if(next.meta.id!==draft.meta.id) throw new Error('Transfer cannot replace the open world identity');
    draft.meta=next.meta;draft.maps=next.maps;
  },
});

registerCommand({
  name:'map.syncLinked',description:'Pull entity changes from the linked map. Conflicts default to mine; choose mine/theirs per entity. The entire sync is one undo step.',
  input:z.object({mapId:z.string().min(1),otherWorldId:z.string().min(1),otherMap:MapDocSchema,choices:z.record(z.string(),z.enum(['mine','theirs'])).default({})}),
  run(draft,input) {
    const mine=getMapOrThrow(draft,input.mapId);
    if(mine.link?.worldId!==input.otherWorldId || input.otherMap.link?.worldId!==draft.meta.id || input.otherMap.link?.mapId!==mine.id)throw new Error('The linked world identity does not match.');
    const result=planSync(mine,input.otherMap,input.choices);
    if(result.updated) {
      draft.maps[mine.id]=result.map;
      validateWorld(draft);
    }
    return {conflicts:result.conflicts,taken:result.taken,updated:result.updated};
  },
});
