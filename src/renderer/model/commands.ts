import { cityDiagnostics } from '../gen/city/diagnostics';
import { restoreMissingLayers } from './migrate';
import { affineFromRings, inheritTerrain, transformChildren } from '../geom/groupTransform';
import { defaultBounds } from './mapDefaults';
import { planSync } from './sync';
import { getGenerator, isDressingProp, regionConstraints, runGenerator } from '../gen/framework';
import '../gen/dungeon/layout';
import '../gen/glade/outdoor';
import '../gen/world/world';
import { SHEET_SIZE } from '../gen/city/city';
import { climateContext } from '../gen/world/context';
import { previewInterior } from '../gen/dungeon/interior';
import { distanceToSegment, getEntityBounds, pointInPolygon } from '../geom/hitTest';
import { validateWorld, WorldDocumentSchema } from './transfer';
import { mergeFogPolygons, paintFog, rectRing } from '../geom/fog';
import { castLosPolygons } from '../geom/visibility';
import { z } from 'zod';
import { isDraft, original } from 'immer';
import { clipAndInheritEntities } from '../geom/clipInherit';
import { getPlaceBounds } from '../geom/places';
import { getChildRectInParent, listKeptEditedEntities } from '../geom/pullFromParent';
import { translateEntityPatch } from '../geom/transform';
import { resolveGeography, geographicEntities, isOcean, polygonArea } from '../geom/geography';
import { fromPolygons, toPolygons } from '../geom/fog';
import clipping from '../geom/polygonClipping';
import { rearrangeLabels } from '../gen/world/decoration';
import { createStackedFloorMap, expandNeighborMap, formatFloorLabel } from '../geom/expandMap';
import { CLOCK_TIME, measureRoute } from '../geom/measure';
import {
  EntitySchema,
  AreaEntitySchema,
  PathEntitySchema,
  LayerSchema,
  MapDocSchema,
  MapIdSchema,
  MapKindSchema,
  PointSchema,
  ClimateSchema,
  type AssetsIndex,
  type Entity,
  type Layer,
  type MapDoc,
  type WorldMeta,
  type Point,
} from './schema';

export interface WorldDocument {
  meta: WorldMeta;
  maps: Record<string, MapDoc>;
}

export interface CommandDef<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  input: z.ZodType<TInput>;
  run: (draft: WorldDocument, input: TInput, assets: AssetsIndex) => TResult;
}

const registry = new Map<string, CommandDef<any, any>>();

function registerCommand<TInput, TResult>(
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
  assets: AssetsIndex = {},
): unknown {
  const cmd = registry.get(name);
  if (!cmd) {
    throw new Error(`Unknown command: ${name}`);
  }
  const parsed = cmd.input.parse(rawInput);
  return cmd.run(draft, parsed, assets);
}

function getMapOrThrow(draft: WorldDocument, mapId: string): MapDoc {
  const map = draft.maps[mapId];
  if (!map) {
    throw new Error(`Map not found: ${mapId}`);
  }
  return map;
}

function assertEditableLayer(map: MapDoc, layerId: string): void {
  const layer = map.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer not found: ${layerId}`);
  if (layer.locked) throw new Error(`Unlock the layer "${layer.name}" first.`);
}

// Fields that move or reshape an entity; notes, names and door state stay editable on locked layers.
const GEOMETRY_FIELDS = ['x', 'y', 'w', 'h', 'rotation', 'rings', 'points', 'a', 'b', 'closed'];

registerCommand({
  name: 'generator.run',
  description: 'Generate world/continent terrain, climate, rivers and themed symbols (world/region maps), dungeon/interior or glade woodland inside an area. One undo step; manual edits survive. World params: cells (8000), seaLevel, ruggedness, rivers, riverThreshold, density (0–3), settlements (0–50). Settlement suggestions are GM-only until settlement.resolveSuggestion accepts them. Climate comes from world.setClimate.',
  input: z.object({ mapId: z.string().min(1), genId: z.string().min(1).optional(), type: z.string().min(1),
    seed: z.number().int(), params: z.record(z.string(), z.unknown()).default({}), regionEntityId: z.string().min(1).optional(),
    entireMap: z.boolean().default(false), useBoundaryAsExtent: z.boolean().default(false),
    layerId: z.string().min(1), themeName: z.string().min(1).default('default') }),
  run(draft, input, assets) {
    const map = getMapOrThrow(draft, input.mapId);
    const genId = input.genId ?? crypto.randomUUID();
    if (map.generators[genId]) throw new Error('Use generator.reroll for an existing run.');
    let regionEntityId = input.entireMap ? undefined : input.regionEntityId;
    // A blank standalone settlement still has the default one-mile sheet; shrink it to the
    // settlement's size so a village isn't a dot in fields. Undo restores the old sheet.
    const def = defaultBounds('settlement');
    if (input.type === 'city' && input.entireMap && !map.parent && Object.keys(map.entities).length === 0
      && Math.abs(map.bounds.w - def.w) < 1 && Math.abs(map.bounds.h - def.h) < 1) {
      const scale = input.params.scale;
      const size = SHEET_SIZE[scale === 'hamlet' || scale === 'village' || scale === 'city' ? scale : 'town'];
      map.bounds = { x: map.bounds.x + (map.bounds.w - size) / 2, y: map.bounds.y + (map.bounds.h - size) / 2, w: size, h: size };
    }
    if (!regionEntityId && (input.entireMap || input.type === 'world')) {
      regionEntityId = `boundary-${genId}`;
      map.entities[regionEntityId] = { id: regionEntityId, type: 'area', role: 'land', usage: 'boundary', layerId: input.layerId, origin: 'manual', rev: map.revision, rings: [rectRing(map.bounds)] };
    }
    if (!regionEntityId) throw new Error('Select a generation area.');
    const source = map.entities[regionEntityId];
    if (input.type === 'world' && input.params.mode === 'populate' && source?.type === 'area' && source.usage !== 'boundary') {
      // Keep authored coastlines (and their existing groups) intact. The generated
      // detail needs its own movable boundary rather than borrowing that entity.
      regionEntityId = `boundary-${genId}`;
      if (map.entities[regionEntityId]) throw new Error('Generation boundary id already exists.');
      map.entities[regionEntityId] = { id: regionEntityId, type: 'area', role: 'land', usage: 'boundary', name: source.name,
        layerId: input.layerId, origin: 'manual', rev: map.revision, rings: source.rings.map(r => r.map(p => ({ ...p }))) };
    }
    const boundary = map.entities[regionEntityId];
    if (input.useBoundaryAsExtent && !map.parent && boundary?.type === 'area') {
      const p = boundary.rings[0]!;
      const x = Math.min(...p.map(q=>q.x)), y = Math.min(...p.map(q=>q.y));
      map.bounds = { x, y, w: Math.max(...p.map(q=>q.x))-x, h: Math.max(...p.map(q=>q.y))-y };
    }
    const ids = runGenerator(map, { ...input, regionEntityId, genId, theme: draft.meta.themes[input.themeName] ?? {}, assets, climate: climateContext(draft, map),
      takenNames: input.type === 'world' || input.type === 'dungeon' ? namesInUse(draft, map.id, genId) : undefined });
    return { genId, ids };
  },
});
registerCommand({
  name: 'generator.reroll',
  description: 'Reroll untouched generated content, or dressing only, preserving all manual edits. Supply the new seed.',
  input: z.object({ mapId: z.string().min(1), genId: z.string().min(1), seed: z.number().int(),
    params: z.record(z.string(), z.unknown()).optional(), themeName:z.string().min(1).optional(), dressingOnly: z.boolean().default(false), entireMap: z.boolean().default(false) }),
  run(draft, input, assets) {
    const map = getMapOrThrow(draft, input.mapId), record = map.generators[input.genId];
    if (!record) throw new Error('Generator run not found.');
    let regionEntityId = record.regionEntityId;
    if (input.entireMap && record.type === 'world') {
      regionEntityId = `boundary-${input.genId}`;
      map.entities[regionEntityId] = { id: regionEntityId, type: 'area', role: 'land', usage: 'boundary',
        layerId: record.layerId ?? map.layers[0]!.id, origin: 'manual', rev: map.revision, rings: [rectRing(map.bounds)] };
    }
    const themeName = input.themeName ?? record.themeName ?? 'default';
    const ids = runGenerator(map, { ...record, ...input, regionEntityId, params: input.params ?? record.params,
      layerId: record.layerId ?? map.layers[0]!.id, themeName, theme: draft.meta.themes[themeName] ?? {}, assets, climate: climateContext(draft, map),
      takenNames: record.type === 'world' || record.type === 'dungeon' ? namesInUse(draft, map.id, input.genId) : undefined });
    return { genId: input.genId, ids };
  },
});

/** Every name used anywhere in the world except this run's own output, so a region's names stay its own. */
function namesInUse(world: WorldDocument, mapId: string, genId: string): string[] {
  return Object.values(world.maps).flatMap(m => Object.values(m.entities).flatMap(e =>
    m.id === mapId && e.genId === genId ? [] : e.type === 'label' ? [e.text] : e.name ? [e.name] : []));
}
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
        e.entityIds = e.entityIds.filter(id => id !== entity.id);
        if (e.origin === 'generated') {
          for (const lid of [...e.entityIds]) {
            const linked = map.entities[lid];
            if (linked?.type === 'label' && linked.origin === 'generated') {
              delete map.entities[lid]; map.deleted[lid] = map.revision;
              e.entityIds = e.entityIds.filter(id => id !== lid);
            }
          }
          if (!e.entityIds.length) { delete map.entities[e.id]; map.deleted[e.id] = map.revision; continue; }
        }
        e.rev = map.revision;
      }
      return { id: entity.id };
    }
    entity.name = input.name ?? entity.name?.replace(' suggestion', '') ?? 'Settlement';
    entity.origin = 'manual'; entity.gmOnly = false; entity.rev = map.revision;
    delete entity.genId; delete entity.groupId;
    delete entity.suggestedSettlement;
    const existingPlace = Object.values(map.entities).find((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place' && e.entityIds.includes(entity.id));
    if (existingPlace) {
      existingPlace.name = entity.name; existingPlace.origin = 'manual'; existingPlace.gmOnly = false; existingPlace.rev = map.revision;
      delete existingPlace.genId; delete existingPlace.groupId;
      for (const lid of existingPlace.entityIds) {
        const linked = map.entities[lid];
        if (linked?.type === 'label') {
          linked.text = entity.name; linked.origin = 'manual'; linked.gmOnly = false; linked.rev = map.revision;
          delete linked.genId; delete linked.groupId;
        }
      }
      return { id: entity.id, placeId: existingPlace.id };
    }
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
    const scoped=Object.values(map.entities).filter(e=>e.genId===input.genId&&e.origin==='generated'&&isDressingProp(e)&&pointInPolygon(e,area.rings));
    if(scoped.some(e=>map.layers.find(l=>l.id===e.layerId)?.locked)) throw new Error('Unlock the dressing layers first.');
    const removed=input.action==='more'?[]:input.action==='thin'?scoped.filter((_,i)=>i%2===0):scoped;
    const removeIds=new Set(removed.map(e=>e.id));
    const seed=input.seed??((record.seed+1)>>>0);
    const params=definition.params.parse(input.params??record.params),themeName=input.themeName??record.themeName??'default';
    const roomPurposes = new Map(Object.values(map.entities).filter(e => e.type === 'area').map(e => [e.id, e.type === 'area' ? e.roomPurpose : undefined]));
    const output=input.action==='thin'?[]:definition.dress({seed,params,region:footprint.rings,
      constraints:[...regionConstraints(map,footprint.rings,footprint.id),...Object.values(map.entities).filter(e=>e.type==='prop'&&e.origin==='generated'&&!removeIds.has(e.id))],
      theme:draft.meta.themes[themeName]??{},grid:map.grid.size},
      Object.values(map.entities).filter(e=>e.genId===input.genId&&!isDressingProp(e)))
      .filter(e=>e.type==='prop'&&pointInPolygon(e,area.rings));
    const purposeChanged = Object.values(map.entities).some(e => e.type === 'area' && e.roomPurpose !== roomPurposes.get(e.id));
    if(!removed.length&&!output.length&&!purposeChanged) return {ids:[],removed:[]};
    map.revision++;
    record.params=params;record.themeName=themeName;record.seed=seed;
    for (const e of Object.values(map.entities)) if (e.type === 'area' && e.roomPurpose !== roomPurposes.get(e.id)) e.rev = map.revision;
    for(const e of removed) {delete map.entities[e.id];map.deleted[e.id]=map.revision;}
    const ids=output.map(e=>{
      const id=`${input.genId}:${map.revision}:${e.id}`;
      if(map.entities[id]) throw new Error(`Generated id already exists: ${id}`);
      map.entities[id]=EntitySchema.parse({...e,id,genId:input.genId,groupId:record.groupId??input.genId,layerId:layer.id,rev:map.revision});
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
    childMapId:MapIdSchema.optional(),name:z.string().trim().min(1).optional(),seed:z.number().int(),
    params:z.record(z.string(),z.unknown()).default({}),themeName:z.string().min(1).default('default'),
    expectedParentRevision:z.number().int().nonnegative().optional()}),
  run(draft,input,assets) {
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
      theme:draft.meta.themes[input.themeName]??{},assets});
    draft.maps[id]=child;
    draft.meta.maps.push({id,name:child.name,kind:'interior',parentId:parent.id});
    parent.revision++;
    if(building.origin==='generated') {building.origin='manual';}
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
    assertEditableLayer(map, input.entity.layerId);
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
    if (typeof input.patch.layerId === 'string' && input.patch.layerId !== existing.layerId) {
      assertEditableLayer(map, existing.layerId);
      assertEditableLayer(map, input.patch.layerId);
    }
    if (GEOMETRY_FIELDS.some((key) => key in input.patch)) assertEditableLayer(map, existing.layerId);
    map.revision += 1;
    const candidate = {
      ...existing,
      ...input.patch,
      id: existing.id,
      type: existing.type,
      origin: 'manual', // any edit makes generated/inherited content manual
      rev: map.revision,
    };
    const validated = EntitySchema.parse(candidate);
    map.entities[existing.id] = validated;
    if (validated.type === 'area' && validated.role === 'building') {
      const b = getEntityBounds(validated);
      if (b) {
        for (const child of Object.values(draft.maps)) {
          if (child.parent?.mapId === map.id && child.parent.footprintEntityId === validated.id) {
            child.parent.x = b.minX;
            child.parent.y = b.minY;
            child.bounds = { x: 0, y: 0, w: Math.max(1, b.maxX - b.minX), h: Math.max(1, b.maxY - b.minY) };
            child.revision += 1;
          }
        }
      }
    }
    if(validated.type==='path'&&validated.role==='river'){
      // Rivers sharing a junction id keep their shared end together.
      for(const [nodeId,p] of [[validated.startNodeId,validated.points[0]!],[validated.endNodeId,validated.points[validated.points.length-1]!]] as const)if(nodeId){
        for(const other of Object.values(map.entities))if(other.type==='path'&&other.role==='river'&&other.id!==validated.id){
          if(other.startNodeId===nodeId){other.points[0]={...p};other.origin='manual';other.rev=map.revision;}
          if(other.endNodeId===nodeId){other.points[other.points.length-1]={...p};other.origin='manual';other.rev=map.revision;}
        }
      }
    }
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
    const existing = map.entities[input.entityId];
    if (!existing) {
      throw new Error(`Entity not found: ${input.entityId}`);
    }
    assertEditableLayer(map, existing.layerId);
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
    for (const id of input.entityIds) {
      const existing = map.entities[id];
      if (existing) assertEditableLayer(map, existing.layerId);
    }
    map.revision += 1;
      const idMap=new Map(input.entityIds.map(id=>[id,crypto.randomUUID()]));
      const groupMap=new Map<string,string>(),nodeMap=new Map<string,string>();
      // A group is copied as a group only when every member is selected.
      const selected=new Set(input.entityIds),groupSize=new Map<string,number>(),selectedInGroup=new Map<string,number>();
      for(const e of Object.values(map.entities))if(e.groupId){groupSize.set(e.groupId,(groupSize.get(e.groupId)??0)+1);if(selected.has(e.id))selectedInGroup.set(e.groupId,(selectedInGroup.get(e.groupId)??0)+1);}
      for(const e of Object.values(map.entities))if(selected.has(e.id)&&e.groupId&&selectedInGroup.get(e.groupId)===groupSize.get(e.groupId)){
        if(!groupMap.has(e.groupId)){const id=crypto.randomUUID();groupMap.set(e.groupId,id);map.groups??={};const g=map.groups[e.groupId];map.groups[id]={name:`${g?.name??'Group'} copy`,boundary:g?.boundary?.map(r=>r.map(p=>({x:p.x+input.dx,y:p.y+input.dy})))};}
      }
      const cloneNode=(id:string|undefined)=>{if(!id)return undefined;if(!nodeMap.has(id))nodeMap.set(id,crypto.randomUUID());return nodeMap.get(id)!;};
    for (const sourceId of input.entityIds) {
      const existing = map.entities[sourceId];
      if (!existing) {
        throw new Error(`Entity not found: ${sourceId}`);
      }
        const newId = idMap.get(sourceId)!;
      const offsetPatch = translateEntityPatch(existing, input.dx, input.dy);
      const clone = EntitySchema.parse({
        ...existing,
        ...offsetPatch,
        id: newId,
        origin: 'manual',
        genId: undefined,
          groupId: existing.groupId?groupMap.get(existing.groupId):undefined,
        inheritedFrom: undefined,
        rev: map.revision,
      });
        if(clone.type==='path'&&existing.type==='path'){clone.startNodeId=cloneNode(existing.startNodeId);clone.endNodeId=cloneNode(existing.endNodeId);}
        if(clone.type==='place')clone.entityIds=clone.entityIds.map(id=>idMap.get(id)??id);
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
    if (Object.values(map.entities).some(entity => entity.layerId === input.layerId)) {
      throw new Error('Move this layer’s contents to another layer before deleting it.');
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
  description: 'Measure a route in metres. Speed is mph; departure/startTime are HH:MM. Optional schedule sets a daily travel window (hoursPerDay up to 24). Returns moving/elapsed seconds, rest stops and arrival. Read-only; no undo or dirty files.',
  input: z.object({
    mapId: z.string().min(1),
    points: z.array(PointSchema).min(2).max(10000),
    speedMph: z.number().positive().finite().optional(),
    departure: z.string().regex(CLOCK_TIME).optional(),
    schedule: z.object({ startTime: z.string().regex(CLOCK_TIME), hoursPerDay: z.number().positive().max(24).finite() }).optional(),
  }),
  run(draft, input) {
    getMapOrThrow(draft, input.mapId);
    return measureRoute(input.points, input.speedMph, input.departure, input.schedule);
  },
});

const MapCreateInputSchema = z.object({
  id: MapIdSchema,
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
      formatVersion: 2,
      id: input.id,
      name: input.name,
      kind: input.kind,
      parent: input.parentId
        ? { mapId: input.parentId, x: 0, y: 0, rotation: 0 }
        : undefined,
      bounds: input.bounds ?? defaultBounds(input.kind),
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

const MapExpandNeighborInputSchema = z.object({
  sourceMapId: z.string().min(1),
  direction: z.enum(['N', 'S', 'E', 'W']),
  newId: MapIdSchema,
  newName: z.string().min(1).optional(),
});

registerCommand({
  name: 'map.expandNeighbor',
  description: 'Create an adjacent N/S/E/W map sheet that seamlessly mirrors coastline, rivers, roads, and border terrain.',
  input: MapExpandNeighborInputSchema,
  run(draft, input) {
    const source = getMapOrThrow(draft, input.sourceMapId);
    if (draft.maps[input.newId]) {
      throw new Error(`Map already exists: ${input.newId}`);
    }
    const dirLabel = { N: 'North', S: 'South', E: 'East', W: 'West' }[input.direction];
    const name = input.newName ?? `${source.name} (${dirLabel})`;
    const neighbor = expandNeighborMap(source, input.direction, input.newId, name);
    draft.maps[neighbor.id] = neighbor;
    draft.meta.maps.push({
      id: neighbor.id,
      name: neighbor.name,
      kind: neighbor.kind,
      parentId: neighbor.parent?.mapId,
    });
    return { id: neighbor.id };
  },
});

const MapCreateFloorInputSchema = z.object({
  sourceMapId: z.string().min(1),
  levelDelta: z.union([z.literal(1), z.literal(-1)]),
  newId: MapIdSchema,
});

registerCommand({
  name: 'map.createFloor',
  description: 'Create an upper or lower stacked floor map sharing floorGroupId and aligned stair portals.',
  input: MapCreateFloorInputSchema,
  run(draft, input) {
    const source = getMapOrThrow(draft, input.sourceMapId);
    if (draft.maps[input.newId]) {
      throw new Error(`Map already exists: ${input.newId}`);
    }
    const groupId = source.floorGroupId ?? source.id;
    const sourceLevel = source.level ?? 0;
    const targetLevel = sourceLevel + input.levelDelta;
    const existing = Object.values(draft.maps).find(
      (m) => (m.floorGroupId ?? m.id) === groupId && (m.level ?? 0) === targetLevel,
    );
    if (existing) {
      return { id: existing.id, created: false };
    }
    source.floorGroupId = groupId;
    source.level = sourceLevel;
    source.revision += 1;

    const { floorMap, sourceStairPos, sourcePortalKind } = createStackedFloorMap(source, targetLevel, input.newId);
    const stairId = `stairs-to-${formatFloorLabel(targetLevel).toLowerCase()}-${input.newId.slice(0, 6)}`;
    source.entities[stairId] = {
      id: stairId,
      type: 'portal',
      layerId: source.layers[0]?.id ?? 'layer-base',
      origin: 'manual',
      rev: source.revision,
      name: `Stairs ${input.levelDelta > 0 ? 'Up' : 'Down'} (${formatFloorLabel(targetLevel)})`,
      x: sourceStairPos.x,
      y: sourceStairPos.y,
      targetMapId: floorMap.id,
      connectorKind: sourcePortalKind,
      elevationDelta: input.levelDelta,
    };

    const stories = Math.max(source.elevationStories ?? 1, targetLevel >= 0 ? targetLevel + 1 : 1);
    for (const m of Object.values(draft.maps)) {
      if ((m.floorGroupId ?? m.id) === groupId) {
        m.elevationStories = stories;
      }
    }
    floorMap.elevationStories = stories;

    draft.maps[floorMap.id] = floorMap;
    draft.meta.maps.push({
      id: floorMap.id,
      name: floorMap.name,
      kind: floorMap.kind,
      parentId: floorMap.parent?.mapId,
    });
    return { id: floorMap.id, created: true };
  },
});

registerCommand({
  name: 'map.rearrangeLabels',
  description: 'De-overlap and cleanly reposition map text labels in one undoable step.',
  input: z.object({ mapId: z.string().min(1) }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const updates = rearrangeLabels(map);
    const ids = Object.keys(updates);
    if (ids.length === 0) return { movedCount: 0 };
    map.revision += 1;
    let movedCount = 0;
    for (const id of ids) {
      const existing = map.entities[id];
      const patch = updates[id];
      if (!existing || existing.type !== 'label' || !patch) continue;
      if ('x' in patch && typeof patch.x === 'number') existing.x = patch.x;
      if ('y' in patch && typeof patch.y === 'number') existing.y = patch.y;
      existing.rev = map.revision;
      movedCount++;
    }
    return { movedCount };
  },
});

const ThemeSetRoleInputSchema = z.object({
  themeName: z.string().min(1).default('default'),
  role: z.string().min(1),
  assetIds: z.array(z.string().min(1)).default([]),
  packAssetIds: z.array(z.string().min(1)).optional(),
  onlyIfEmpty: z.boolean().optional(),
});

registerCommand({
  name: 'theme.setRole',
  description: 'Assign asset ids to a generator role in a world theme.',
  input: ThemeSetRoleInputSchema,
  run(draft, input) {
    if (input.packAssetIds?.length) throw new Error('Copy pack assets into the world before assigning the role.');
    const theme = (draft.meta.themes[input.themeName] ??= {});
    if (!input.onlyIfEmpty || !theme[input.role]?.length) theme[input.role] = [...new Set(input.assetIds)];
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
  childMapId: MapIdSchema.optional(),
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
      if (target.origin === 'generated' && map.layers.find(l => l.id === target.layerId)?.locked) {
        throw new Error('Unlock the linked generated objects before creating a place.');
      }
      seen.add(eid);
      uniqueEntityIds.push(eid);
    }
    map.revision += 1;
    // Naming generated scenery makes it deliberate work, just like opening its interior.
    for (const eid of uniqueEntityIds) {
      const target = map.entities[eid]!;
      if (target.origin === 'generated') {
        target.origin = 'manual';
        target.rev = map.revision;
      }
    }
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
  childMapId: MapIdSchema.optional(),
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
  const inherited = clipAndInheritEntities(parentMap, rect, 'layer-base', undefined, kind);
  const entities: Record<string, Entity> = {};
  for (const ent of inherited) {
    ent.groupId='inherited';
    entities[ent.id] = ent;
  }
  return MapDocSchema.parse({
    formatVersion: 2,
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
    groups: { inherited: { name: 'Inherited geography', boundary: [rectRing({x:0,y:0,w:rect.w,h:rect.h})] } },
    terrain: inheritTerrain(parentMap,rect),
    outsideLandIsWater: parentMap.outsideLandIsWater ?? ['world','region'].includes(parentMap.kind),
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
  childMapId: MapIdSchema.optional(),
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
    parentMap.revision += 1;
    place.childMapId = id;
    place.rev = parentMap.revision;
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
    if (childMap.kind === 'interior' && childMap.parent.footprintEntityId) {
      const building = parentMap.entities[childMap.parent.footprintEntityId];
      if (!building || building.type !== 'area' || building.role !== 'building') {
        throw new Error(`Parent building footprint missing: ${childMap.parent.footprintEntityId}`);
      }
      const b = getEntityBounds(building)!;
      const local = (p: { x: number; y: number }) => ({ x: p.x - b.minX, y: p.y - b.minY });
      childMap.parent.x = b.minX;
      childMap.parent.y = b.minY;
      childMap.bounds = { x: 0, y: 0, w: Math.max(1, b.maxX - b.minX), h: Math.max(1, b.maxY - b.minY) };
      for (const [eid, ent] of Object.entries(childMap.entities)) {
        if (ent.origin === 'inherited') {
          delete childMap.entities[eid];
          childMap.deleted[eid] = childMap.revision;
          replacedCount += 1;
        }
      }
      const keptEdited = listKeptEditedEntities(childMap);
      const editedParentIds = new Set(keptEdited.map((k) => k.parentEntityId));
      let addedCount = 0;
      if (!editedParentIds.has(building.id)) {
        const footprint: Extract<Entity, { type: 'area' }> = {
          ...building,
          id: 'interior-footprint',
          layerId: targetLayerId,
          origin: 'inherited',
          rev: childMap.revision,
          rings: building.rings.map((r) => r.map(local)),
          inheritedFrom: { entityId: building.id, parentRev: building.rev },
        };
        delete footprint.genId;
        delete footprint.groupId;
        delete footprint.texture;
        delete childMap.deleted['interior-footprint'];
        childMap.entities = { 'interior-footprint': footprint, ...childMap.entities };
        addedCount += 1;
      }
      for (const e of Object.values(parentMap.entities)) {
        if (e.type !== 'door' || editedParentIds.has(e.id)) continue;
        const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
        const onBoundary = building.rings.some((r) => r.some((a, i) => distanceToSegment(mid, a, r[(i + 1) % r.length]!) < 0.05));
        if (!onBoundary && !pointInPolygon(mid, building.rings)) continue;
        const id = `inherited-door:${e.id}`;
        childMap.entities[id] = {
          ...e,
          id,
          genId: undefined,
          groupId: undefined,
          layerId: targetLayerId,
          origin: 'inherited',
          rev: childMap.revision,
          a: local(e.a),
          b: local(e.b),
          inheritedFrom: { entityId: e.id, parentRev: e.rev },
        };
        delete childMap.deleted[id];
        addedCount += 1;
      }
      return { mapId: childMap.id, replacedCount, addedCount, keptEdited };
    }

    for (const [eid, ent] of Object.entries(childMap.entities)) {
      if (ent.origin === 'inherited') {
        delete childMap.entities[eid];
        childMap.deleted[eid] = childMap.revision;
        replacedCount += 1;
      }
    }

    const keptEdited = listKeptEditedEntities(childMap);
    const editedParentIds = new Set(keptEdited.map((k) => k.parentEntityId));

    const fresh = clipAndInheritEntities(parentMap, rect, targetLayerId, undefined, childMap.kind);
    let addedCount = 0;
    for (const ent of fresh) {
      if (ent.inheritedFrom && editedParentIds.has(ent.inheritedFrom.entityId)) {
        continue;
      }
      const next = { ...ent, groupId:'inherited', rev: childMap.revision };
      childMap.entities[next.id] = next;
      delete childMap.deleted[next.id];
      addedCount += 1;
    }

    childMap.groups??={};childMap.groups.inherited??={name:'Inherited geography',boundary:[rectRing(childMap.bounds)]};
    childMap.terrain=inheritTerrain(parentMap,rect);

    return {
      mapId: childMap.id,
      replacedCount,
      addedCount,
      keptEdited,
    };
  },
});

registerCommand({
  name:'fog.paint', description:'Enable/disable fog, reveal active view, cast wall-blocked Torch/LOS reveal, paint memory fog, dim active view back to memory, hide areas, or reveal/hide the whole map. One stroke is one undo step.',
  input:z.object({mapId:z.string().min(1),mode:z.enum(['enable','disable','reveal','los','memory','dimActive','hide','revealAll','hideAll']),points:z.array(PointSchema).max(10000).default([]),radius:z.number().positive().finite().default(3)}),
  run(draft,input) {
    const map = getMapOrThrow(draft,input.mapId);
    if (input.mode === 'enable' || input.mode === 'disable') map.fog.enabled = input.mode === 'enable';
    else {
      map.fog.enabled = true;
      if (input.mode === 'revealAll') {
        const whole = [[rectRing(map.bounds)]];
        map.fog.revealed = whole;
        map.fog.explored = whole;
      } else if (input.mode === 'hideAll') {
        map.fog.revealed = [];
        map.fog.explored = [];
      } else if (input.mode === 'dimActive') {
        map.fog.explored = mergeFogPolygons(map.fog.explored ?? [], map.fog.revealed);
        map.fog.revealed = [];
      } else if (input.mode === 'los') {
        map.fog.explored = mergeFogPolygons(map.fog.explored ?? [], map.fog.revealed);
        const vis = castLosPolygons(input.points, input.radius, map);
        map.fog.revealed = vis;
        map.fog.explored = mergeFogPolygons(map.fog.explored ?? [], vis);
      } else if (input.mode === 'memory') {
        map.fog.explored = paintFog(map.fog.explored ?? [], input.points, input.radius, false);
        map.fog.revealed = paintFog(map.fog.revealed, input.points, input.radius, true);
      } else if (input.mode === 'hide') {
        map.fog.revealed = paintFog(map.fog.revealed, input.points, input.radius, true);
        if (map.fog.explored?.length) map.fog.explored = paintFog(map.fog.explored, input.points, input.radius, true);
      } else {
        map.fog.revealed = paintFog(map.fog.revealed, input.points, input.radius, false);
        map.fog.explored = paintFog(map.fog.explored ?? [], input.points, input.radius, false);
      }
    }
    map.revision++;
  },
});

registerCommand({
  name:'world.applyTransfer',description:'Apply a validated transfer result to the open world as one undo step. Refuses if the world changed while the transfer was being prepared.',
  input:z.object({before:WorldDocumentSchema,after:WorldDocumentSchema}),
  run(draft,input) {
    // Saved snapshots are schema-parsed; normalize the live document's field order too.
    if(JSON.stringify(WorldDocumentSchema.parse(isDraft(draft)?original(draft):draft))!==JSON.stringify(input.before)) throw new Error('World changed during transfer. The target copy is safe; reopen it or retry from the current source.');
    const next=validateWorld(input.after);
    if(next.meta.id!==draft.meta.id) throw new Error('Transfer cannot replace the open world identity');
    // Assign per map so undo/redo marks each touched map file as unsaved.
    draft.meta=next.meta;
    for(const id of Object.keys(draft.maps))if(!next.maps[id])delete draft.maps[id];
    for(const [id,map]of Object.entries(next.maps))if(JSON.stringify(input.before.maps[id])!==JSON.stringify(map))draft.maps[id]=map;
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


registerCommand({
  name: 'map.setExtent', description: 'Set the physical map extent in metres without moving its contents.',
  input: z.object({ mapId: z.string(), bounds: z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive().finite(), h: z.number().positive().finite() }) }),
  run(draft, input) { const map = getMapOrThrow(draft, input.mapId); map.bounds = input.bounds; map.revision++; return map.bounds; },
});
registerCommand({
  name: 'map.setGeographyOptions', description: 'Set implicit ocean and river display options.',
  input: z.object({ mapId: z.string(), outsideLandIsWater: z.boolean().optional(), riverWidthMode: z.enum(['cartographic','physical']).optional() }),
  run(draft, input) { const map = getMapOrThrow(draft, input.mapId); if(input.outsideLandIsWater!==undefined)map.outsideLandIsWater=input.outsideLandIsWater; if(input.riverWidthMode)map.riverWidthMode=input.riverWidthMode; map.revision++; },
});
registerCommand({
  name: 'group.applyTransform', description: 'Transform a complete group while retaining generator ownership and its boundary. One undo step.',
  input: z.object({mapId:z.string(),groupId:z.string(),changes:z.array(z.object({entityId:z.string(),patch:z.record(z.string(),z.unknown())}))}),
  run(draft,input) {
    const map=getMapOrThrow(draft,input.mapId), members=Object.values(map.entities).filter(e=>e.groupId===input.groupId);
    if(members.some(e=>map.layers.find(l=>l.id===e.layerId)?.locked))throw new Error('Unlock all group layers before transforming this result.');
    const changed=new Set(input.changes.map(c=>c.entityId));
    if(members.some(e=>!changed.has(e.id)))throw new Error('Select the complete group before transforming it.');
    const oldBoundary=map.groups?.[input.groupId]?.boundary?.map(r=>r.map(p=>({...p})));
      const reference=members.find(e=>e.type==='area'&&e.rings[0]!.length>=3);
      const changedReference=reference&&input.changes.find(c=>c.entityId===reference.id);
      const memberTransform=reference?.type==='area'&&changedReference?.patch.rings
        ?affineFromRings(reference.rings,changedReference.patch.rings as Point[][]):null;
    map.revision++;
    for(const c of input.changes){const e=map.entities[c.entityId];if(!e||e.groupId!==input.groupId)throw new Error('Group membership changed.');map.entities[e.id]=EntitySchema.parse({...e,...c.patch,id:e.id,type:e.type,origin:e.origin==='inherited'?'manual':e.origin,rev:map.revision});}
    for(const record of Object.values(map.generators)) if(record.groupId===input.groupId){const boundary=map.entities[record.regionEntityId];if(boundary?.type==='area'){record.boundary=boundary.rings;if(map.groups?.[input.groupId])map.groups[input.groupId]!.boundary=boundary.rings;
      if(record.type==='world'&&!map.parent){const p=boundary.rings[0]!;const x=Math.min(...p.map(q=>q.x)),y=Math.min(...p.map(q=>q.y));map.bounds={x,y,w:Math.max(...p.map(q=>q.x))-x,h:Math.max(...p.map(q=>q.y))-y};}
    }}
      if(memberTransform&&oldBoundary&&map.groups?.[input.groupId])map.groups[input.groupId]!.boundary=oldBoundary.map(r=>r.map(memberTransform.point));
      const nextBoundary=map.groups?.[input.groupId]?.boundary;
      const transform=memberTransform??(oldBoundary&&nextBoundary?affineFromRings(oldBoundary,nextBoundary):null);
    if(transform){
      for(const [id,record]of Object.entries(map.generators))if(record.groupId===input.groupId){const model=map.terrain?.[id];if(model){model.cells=model.cells.map(c=>({...c,...transform.point(c)}));model.bounds={...map.bounds};}}
      transformChildren(draft.maps,map.id,transform,child=>child.parent?.footprintEntityId?members.some(e=>e.id===child.parent!.footprintEntityId):!!oldBoundary&&pointInPolygon({x:child.parent!.x+child.bounds.w/2,y:child.parent!.y+child.bounds.h/2},oldBoundary));
    }
    return {groupId:input.groupId};
  },
});
registerCommand({
  name: 'entity.returnToGenerated', description: 'Allow a deliberately edited generator feature to be replaced on the next reroll.',
  input:z.object({mapId:z.string(),entityIds:z.array(z.string())}),
  run(draft,input){const map=getMapOrThrow(draft,input.mapId);map.revision++;for(const id of input.entityIds){const e=map.entities[id];if(e?.genId&&map.generators[e.genId]){e.origin='generated';e.rev=map.revision;}}},
});
registerCommand({
  name:'map.paintBiome', description:'Paint or erase a biome stroke, clipped to land and outside water. One stroke is one undo step.',
  input:z.object({mapId:z.string(),biome:z.string().min(1),points:z.array(PointSchema).min(1),radius:z.number().positive(),erase:z.boolean().default(false),layerId:z.string()}),
  run(draft,input){
    const map=getMapOrThrow(draft,input.mapId),geo=resolveGeography(map);
    if(!map.layers.some(l=>l.id===input.layerId&&l.visible&&!l.locked))throw new Error('Choose a visible unlocked layer.');
    if(!geo.land.length)throw new Error('Define land before painting biomes.');
    const stroke=paintFog([],input.points,input.radius,false);
    const brush=clipping.intersection(toPolygons(stroke),toPolygons(geo.land));
    if(!brush.length)return;
    map.revision++;
    const locked=new Set(map.layers.filter(l=>l.locked).map(l=>l.id));
    for(const e of Object.values(map.entities))if(e.type==='area'&&e.role.startsWith('biome:')&&!locked.has(e.layerId)&&(!input.erase||e.origin==='manual')){
      const pieces=fromPolygons(clipping.difference(toPolygons([e.rings]),brush));
      if(!pieces.length){delete map.entities[e.id];map.deleted[e.id]=map.revision;}else{e.rings=pieces[0]!;e.rev=map.revision;for(const rings of pieces.slice(1)){const id=crypto.randomUUID();map.entities[id]={...e,id,rings};}}
    }
    if(!input.erase){const rule=draft.meta.climate?.biomes.find(b=>b.name===input.biome);for(const rings of fromPolygons(brush)){const id=crypto.randomUUID();map.entities[id]={id,type:'area',role:`biome:${input.biome}`,name:input.biome,fill:rule?.color,layerId:input.layerId,origin:'manual',rev:map.revision,rings};}}
  },
});
registerCommand({
  name: 'map.paintGeography',
  description: 'Paint land or carve water directly into map geography, cleaning up unedited generated props in new water.',
  input: z.object({
    mapId: z.string(),
    mode: z.enum(['land', 'water']),
    points: z.array(PointSchema).min(1),
    radius: z.number().positive(),
    layerId: z.string(),
  }),
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (!map.layers.some((l) => l.id === input.layerId && l.visible && !l.locked)) {
      throw new Error('Choose a visible unlocked layer.');
    }
    const stroke = paintFog([], input.points, input.radius, false);
    const brush = toPolygons(stroke);
    if (!brush.length) return;
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const p of input.points) {
      if (p.x - input.radius < bMinX) bMinX = p.x - input.radius;
      if (p.y - input.radius < bMinY) bMinY = p.y - input.radius;
      if (p.x + input.radius > bMaxX) bMaxX = p.x + input.radius;
      if (p.y + input.radius > bMaxY) bMaxY = p.y + input.radius;
    }
    const overlapsBrush = (rings: Point[][]): boolean => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of rings) {
        for (const pt of ring) {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        }
      }
      return maxX >= bMinX && minX <= bMaxX && maxY >= bMinY && minY <= bMaxY;
    };
    const safeDiff = (rings: Point[][]): Point[][][] | null => {
      if (!overlapsBrush(rings)) return null;
      try {
        return fromPolygons(clipping.difference(toPolygons([rings]), brush));
      } catch {
        return null;
      }
    };
    const lockedLayers = new Set(map.layers.filter((l) => l.locked).map((l) => l.id));
    map.revision++;
    if (input.mode === 'water') {
      for (const e of Object.values(map.entities)) {
        if (lockedLayers.has(e.layerId)) continue;
        if (e.type === 'area' && e.usage !== 'boundary' && (e.role === 'land' || e.role.startsWith('biome:'))) {
          const pieces = safeDiff(e.rings);
          if (!pieces) continue;
          if (!pieces.length) {
            delete map.entities[e.id];
            map.deleted[e.id] = map.revision;
          } else if (pieces.length !== 1 || pieces[0]!.length !== e.rings.length || pieces[0]![0]!.length !== e.rings[0]!.length || pieces[0]![0]!.some((p, i) => p.x !== e.rings[0]![i]!.x || p.y !== e.rings[0]![i]!.y)) {
            e.rings = pieces[0]!;
            e.origin = 'manual';
            delete e.genId;
            delete e.groupId;
            e.rev = map.revision;
            for (const rings of pieces.slice(1)) {
              const id = crypto.randomUUID();
              map.entities[id] = { ...e, id, rings };
            }
          }
        }
      }
      const protectedIds = new Set<string>();
      for (const e of Object.values(map.entities)) {
        if (e.origin === 'manual') protectedIds.add(e.id);
        if (e.type === 'place') {
          protectedIds.add(e.id);
          for (const linked of e.entityIds) protectedIds.add(linked);
        }
      }
      for (const child of Object.values(draft.maps)) {
        if (child.parent?.mapId === map.id && child.parent.footprintEntityId) {
          protectedIds.add(child.parent.footprintEntityId);
        }
      }
      for (const e of Object.values(map.entities)) {
        if (lockedLayers.has(e.layerId)) continue;
        if ((e.type === 'prop' || e.type === 'label') && e.origin === 'generated' && !protectedIds.has(e.id)) {
          if (stroke.some((poly) => pointInPolygon({ x: e.x, y: e.y }, poly))) {
            delete map.entities[e.id];
            map.deleted[e.id] = map.revision;
          }
        }
      }
    } else {
      for (const e of Object.values(map.entities)) {
        if (lockedLayers.has(e.layerId)) continue;
        if (e.type === 'area' && e.usage !== 'boundary' && e.role === 'water' && !isOcean(e)) {
          const pieces = safeDiff(e.rings);
          if (!pieces) continue;
          if (!pieces.length) {
            delete map.entities[e.id];
            map.deleted[e.id] = map.revision;
          } else {
            e.rings = pieces[0]!;
            e.origin = 'manual';
            delete e.genId;
            delete e.groupId;
            e.rev = map.revision;
            for (const rings of pieces.slice(1)) {
              const id = crypto.randomUUID();
              map.entities[id] = { ...e, id, rings };
            }
          }
        }
      }
      const touchingLand = Object.values(map.entities).filter(
        (e): e is Extract<Entity, { type: 'area' }> =>
          !lockedLayers.has(e.layerId) &&
          e.type === 'area' &&
          e.usage !== 'boundary' &&
          e.role === 'land' &&
          clipping.intersection(toPolygons([e.rings]), brush).length > 0,
      );
      if (touchingLand.length) {
        const merged = fromPolygons(clipping.union(brush, ...touchingLand.map((e) => toPolygons([e.rings]))));
        const primary = touchingLand[0]!;
        for (const extra of touchingLand.slice(1)) {
          delete map.entities[extra.id];
          map.deleted[extra.id] = map.revision;
        }
        if (merged.length) {
          primary.rings = merged[0]!;
          primary.origin = 'manual';
          delete primary.genId;
          delete primary.groupId;
          primary.rev = map.revision;
          for (const rings of merged.slice(1)) {
            const id = crypto.randomUUID();
            map.entities[id] = { ...primary, id, rings };
          }
        }
      } else {
        for (const rings of fromPolygons(brush)) {
          const id = crypto.randomUUID();
          map.entities[id] = {
            id,
            type: 'area',
            role: 'land',
            name: 'Land',
            fill: '#89a36f',
            layerId: input.layerId,
            origin: 'manual',
            rev: map.revision,
            rings,
          };
        }
      }
    }
  },
});
registerCommand({
  name:'map.applyTrace',description:'Accept reviewed backdrop geography. Trace pixels are converted to world coordinates before this command.',
  input:z.object({mapId:z.string(),sourceImageId:z.string(),layerId:z.string(),entities:z.array(EntitySchema),sourceRevision:z.number().optional()}),
  run(draft,input){const map=getMapOrThrow(draft,input.mapId);if(input.sourceRevision!==undefined&&map.revision!==input.sourceRevision)throw new Error('The map changed. Review the trace again.');if(map.entities[input.sourceImageId]?.type!=='image')throw new Error('Backdrop is missing.');if(!map.layers.some(l=>l.id===input.layerId))throw new Error('Choose an existing layer for the trace.');map.revision++;const groupId=crypto.randomUUID();map.groups??={};map.groups[groupId]={name:'Traced geography'};for(const e of input.entities){if(map.entities[e.id])throw new Error('Trace entity id already exists.');map.entities[e.id]={...e,groupId,layerId:input.layerId,origin:'manual',rev:map.revision};}map.outsideLandIsWater=true;return {groupId};},
});
registerCommand({
  name:'map.repair',description:'Apply reviewed, non-destructive repairs: recover explicit world extent and generator boundaries; preserve all geometry.',
  input:z.object({mapId:z.string(),reassign:z.record(z.string(),z.string()).optional()}),
  run(draft,input){const map=getMapOrThrow(draft,input.mapId);map.revision++;restoreMissingLayers(map);for(const [id,r]of Object.entries(map.generators)){const source=map.entities[input.reassign?.[id]??r.regionEntityId];if(source?.type==='area'){r.regionEntityId=source.id;r.boundary=source.rings;}}
    if(!map.parent){const points=Object.values(map.generators).flatMap(r=>r.type==='world'?(r.boundary?.[0]??[]):[]);if(points.length){const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));map.bounds={x,y,w:Math.max(...points.map(p=>p.x))-x,h:Math.max(...points.map(p=>p.y))-y};}}
    return {unresolved:Object.entries(map.generators).filter(([,r])=>!r.boundary&&map.entities[r.regionEntityId]?.type!=='area').map(([id])=>id)};
  },
});

registerCommand({
  name:'world.applyGenerated',description:'Apply a worker generation result only if the source world is unchanged. One undo step.',
  input:z.object({source:WorldDocumentSchema,after:WorldDocumentSchema}),
  run(draft,input){
    // Parse the plain base state, not the Immer proxy, which is far slower to walk.
    const base=(isDraft(draft)?original(draft):draft) as WorldDocument,current=WorldDocumentSchema.parse(base);
    if(JSON.stringify(current)!==JSON.stringify(input.source))throw new Error('The world changed while generating. Generate again to use the latest edits.');
    const after=validateWorld(input.after);
    if(JSON.stringify(current.meta)!==JSON.stringify(after.meta))draft.meta=after.meta;
    // Keep untouched maps alive, including their expensive resolved-geography caches.
    for(const id of Object.keys(draft.maps))if(!after.maps[id])delete draft.maps[id];
    for(const [id,map]of Object.entries(after.maps)){
      if(JSON.stringify(current.maps[id])===JSON.stringify(map))continue;
      // Reuse unchanged entity objects so undo history shares them instead of keeping copies.
      const was=current.maps[id]?.entities??{},old=base.maps[id]?.entities??{};
      map.entities=Object.fromEntries(Object.entries(map.entities).map(([eid,e])=>[eid,old[eid]&&JSON.stringify(was[eid])===JSON.stringify(e)?old[eid]!:e]));
      draft.maps[id]=map;
    }
  },
});

registerCommand({
  name:'river.add',description:'Add a river with shared endpoint junctions. A tributary meeting a river splits that path at its junction.',
  input:z.object({mapId:z.string(),entity:PathEntitySchema,snapDistance:z.number().positive()}),
  run(draft,input){
    const map=getMapOrThrow(draft,input.mapId);if(input.entity.role!=='river')throw new Error('Choose the river role.');
    if(map.entities[input.entity.id])throw new Error('River already exists.');
    map.revision++;
    // Junctions are derived from the rivers on the map now, so deleted rivers leave none behind.
    const junctions=new Map<string,Point>();
    for(const r of Object.values(map.entities))if(r.type==='path'&&r.role==='river'){if(r.startNodeId)junctions.set(r.startNodeId,r.points[0]!);if(r.endNodeId)junctions.set(r.endNodeId,r.points[r.points.length-1]!);}
    const attach=(p:{x:number;y:number})=>{
      let best:{river:Extract<Entity,{type:'path'}>;index:number;point:{x:number;y:number};distance:number}|undefined;
      for(const river of Object.values(map.entities))if(river.type==='path'&&river.role==='river')for(let i=0;i<river.points.length-1;i++){
        const a=river.points[i]!,b=river.points[i+1]!,dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
        const t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
        const point={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(point.x-p.x,point.y-p.y);
        if(distance<input.snapDistance&&(!best||distance<best.distance))best={river,index:i,point,distance};
      }
      if(best){const r=best.river,q=best.point;
        if(Math.hypot(q.x-r.points[0]!.x,q.y-r.points[0]!.y)<1e-7){r.startNodeId??=crypto.randomUUID();junctions.set(r.startNodeId,r.points[0]!);return{id:r.startNodeId,point:r.points[0]!};}
        if(Math.hypot(q.x-r.points[r.points.length-1]!.x,q.y-r.points[r.points.length-1]!.y)<1e-7){r.endNodeId??=crypto.randomUUID();junctions.set(r.endNodeId,r.points[r.points.length-1]!);return{id:r.endNodeId,point:r.points[r.points.length-1]!};}
        const nodeId=crypto.randomUUID(),id=crypto.randomUUID(),oldEnd=r.endNodeId;
        const left=[...r.points.slice(0,best.index+1),q],right=[q,...r.points.slice(best.index+1)];
        map.entities[id]={...r,id,points:right,startNodeId:nodeId,endNodeId:oldEnd,origin:'manual',rev:map.revision};
        r.points=left;r.endNodeId=nodeId;r.origin='manual';r.rev=map.revision;junctions.set(nodeId,q);return{id:nodeId,point:q};
      }
      const existing=[...junctions].find(([,q])=>Math.hypot(q.x-p.x,q.y-p.y)<input.snapDistance);
      const id=existing?.[0]??crypto.randomUUID(),point={...(existing?.[1]??p)};junctions.set(id,point);return{id,point};
    };
    const a=attach(input.entity.points[0]!),b=attach(input.entity.points[input.entity.points.length-1]!);
    const points=[...input.entity.points];points[0]={...a.point};points[points.length-1]={...b.point};
    map.entities[input.entity.id]={...input.entity,points,startNodeId:a.id,endNodeId:b.id,origin:'manual',rev:map.revision};return{id:input.entity.id};
  },
});

registerCommand({name:'map.cityDiagnostics',description:'Read district area, buildable area, water coverage and blocking entity ids in square metres. Does not change the world.',input:z.object({mapId:z.string(),areaId:z.string()}),run(draft,input){return cityDiagnostics(getMapOrThrow(draft,input.mapId),input.areaId);}});
