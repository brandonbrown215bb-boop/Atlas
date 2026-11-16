import { geographicEntities, isWorldSymbol } from '../geom/geography';
import { z } from 'zod';
import { boxesIntersect, getEntityBounds } from '../geom/hitTest';
import { EntitySchema, type Climate, type Entity, type MapDoc, type MapKind, type Point, type Theme } from '../model/schema';

export interface GeneratorInput<P> {
  seed: number;
  params: P;
  region: Point[][];
  constraints: Entity[];
  theme: Theme;
  grid: number;
  mapKind?: MapKind;
  inheritedTerrain?: MapDoc['terrain'];
  terrainResult?: NonNullable<MapDoc["terrain"]>[string];
  climate?: { settings?: Climate; bounds: MapDoc['bounds']; transforms: Array<{ x: number; y: number; rotation: number }> };
}
export type Generator<P> = (input: GeneratorInput<P>) => Entity[];
export interface GeneratorDefinition<P = any> {
  type: string;
  title: string;
  params: z.ZodType<P>;
  generate: Generator<P>;
  dress?: (input: GeneratorInput<P>, layout: Entity[]) => Entity[];
}
const generators = new Map<string, GeneratorDefinition>();
export function registerGenerator<P>(definition: GeneratorDefinition<P>): void {
  generators.set(definition.type, definition);
}
export function listGenerators(): GeneratorDefinition[] { return [...generators.values()]; }
export function getGenerator(type: string): GeneratorDefinition {
  const generator = generators.get(type);
  if (!generator) throw new Error(`Unknown generator: ${type}`);
  return generator;
}

export function regionConstraints(map: MapDoc, region: Point[][], excludeId: string): Entity[] {
  const points = region.flat();
  const box = { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
    maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
  return geographicEntities(map).filter(e => {
    const bounds = getEntityBounds(e);
    return e.usage!=='reference' && e.id !== excludeId && e.origin !== 'generated' && bounds && boxesIntersect(box, bounds);
  });
}

/** Replace only this run's untouched output. Edited output is a constraint for the next run. */
export function runGenerator(map: MapDoc, options: {
  genId: string; type: string; seed: number; params: Record<string, unknown>;
  regionEntityId: string; layerId: string; theme: Theme; themeName?: string; dressingOnly?: boolean;
  climate?: GeneratorInput<unknown>['climate'];
}): string[] {
  if (options.type === 'glade' && map.kind !== 'site') throw new Error('Outdoor generators need a site map.');
  if (options.type === 'city' ? map.kind !== 'settlement' : options.type === 'world' ? !['world', 'region'].includes(map.kind) : map.kind !== 'site' && map.kind !== 'interior') {
    if (options.type === 'city') throw new Error('City generators need a settlement map.');
    throw new Error(options.type === 'world' ? 'World generators need a world or region map.' : 'Generators need a site or interior map.');
  }
  const source = map.entities[options.regionEntityId];
  const savedBoundary = map.generators[options.genId]?.boundary;
  const region = source?.type === 'area' ? source : savedBoundary ? { id: options.regionEntityId, type: 'area' as const, role: 'land' as const, rings: savedBoundary, origin: 'manual' as const, rev: 0, layerId: options.layerId } : undefined;
  if (!region) throw new Error('Generation boundary is missing. Reassign a boundary in Repair Existing World.');
  if (options.type === 'city' && ['building','floor','water'].includes(region.role)) throw new Error('Choose a land or district area for the city footprint.');
  const layer = map.layers.find(l => l.id === options.layerId);
  if (!layer?.visible || layer.locked) throw new Error('Choose a visible, unlocked layer.');
  const definition = getGenerator(options.type);
  const input: GeneratorInput<unknown> = { seed: options.seed, params: definition.params.parse(options.params),
    region: region.rings, constraints: regionConstraints(map, region.rings, region.id), theme: options.theme, grid: map.grid.size,
    mapKind: map.kind, inheritedTerrain: map.terrain, climate: options.climate };
  if(options.type==='world'&&options.params.mode==='populate'&&source?.type==='area'&&source.role==='land'&&source.usage!=='boundary')input.constraints.push(source);
  if (options.type === 'city' && region.district) input.params = definition.params.parse({...options.params,...region.district});
  if (options.type === 'city') {
    const bounds = getEntityBounds(region)!;
    const nearBounds = {
      minX: bounds.minX - 36,
      minY: bounds.minY - 36,
      maxX: bounds.maxX + 36,
      maxY: bounds.maxY + 36,
    };
    const existingIds = new Set(input.constraints.map((c) => c.id));
    input.constraints.push(
      ...geographicEntities(map).filter((e) => {
        if (existingIds.has(e.id) || e.id === region.id || isWorldSymbol(e) || e.usage === 'reference') return false;
        const eb = getEntityBounds(e);
        if (!eb) return false;
        if (e.origin === 'generated') return e.genId !== options.genId && boxesIntersect(bounds, eb);
        return e.type === 'area' && e.role === 'water' && boxesIntersect(nearBounds, eb);
      }),
    );
  }
  const groupId = map.generators[options.genId]?.groupId ?? options.genId;
  map.groups ??= {};
  map.groups[groupId] = { name: map.groups[groupId]?.name ?? source?.name ??
    ({ world: 'Terrain', city: 'Town', glade: 'Woodland', dungeon: 'Rooms' }[options.type] ?? 'Generated result'),
    genId: options.genId, boundary: region.rings.map(r=>r.map(p=>({...p}))) };
  if (source && (options.params.mode !== 'populate' || source.usage === 'boundary')) { source.usage = 'boundary'; source.groupId = groupId; }
  const previous = Object.values(map.entities).filter(e => e.genId === options.genId && e.origin === 'generated');
  if (previous.some(e => map.layers.find(l => l.id === e.layerId)?.locked)) throw new Error('Unlock the generated layers before rerolling.');
  if (options.dressingOnly && !definition.dress) throw new Error('This generator has no dressing pass.');
  const purposes=new Map(Object.values(map.entities).filter(e=>e.type==='area').map(e=>[e.id,e.type==='area'?e.roomPurpose:undefined]));
  const output = options.dressingOnly
    ? definition.dress!(input, Object.values(map.entities).filter(e => e.genId === options.genId && e.type !== 'prop'))
    : definition.generate(input);
  const validated = output.map(e => EntitySchema.parse(e));
  if (validated.some(e => e.origin !== 'generated')) throw new Error('Generator returned non-generated output.');
  if (new Set(validated.map(e => e.id)).size !== validated.length) throw new Error('Generator returned duplicate ids.');
  map.revision++;
  if(options.dressingOnly)for(const e of Object.values(map.entities))if(e.genId===options.genId&&e.type==='area'&&e.roomPurpose!==purposes.get(e.id)&&e.origin==='generated')e.rev=map.revision;
  if(region.origin==='generated') {region.origin='manual';region.rev=map.revision;}
  for (const e of previous) {
    if (options.dressingOnly && e.type !== 'prop') continue;
    delete map.entities[e.id]; map.deleted[e.id] = map.revision;
  }
  for(const e of Object.values(map.entities)) if(e.type==='place'&&e.entityIds.some(id=>!map.entities[id])) {
    e.entityIds=e.entityIds.filter(id=>!!map.entities[id]);e.rev=map.revision;
  }
  const ids: string[] = [];
  const idMap = new Map(validated.map(e => [e.id, `${options.genId}:${map.revision}:${e.id}`]));
  for (const entity of validated) {
    const id = idMap.get(entity.id)!;
    if (map.entities[id]) throw new Error(`Generated id already exists: ${id}`);
    const remapped = entity.type === 'place'
      ? { ...entity, entityIds: entity.entityIds.map(eid => idMap.get(eid) ?? eid) }
      : entity;
    map.entities[id] = { ...remapped, id, genId: options.genId, groupId, rev: map.revision, layerId: layer.id };
    if(entity.type==='path'&&entity.role==='river'){map.riverNodes??={};if(entity.startNodeId)map.riverNodes[entity.startNodeId]=entity.points[0]!;if(entity.endNodeId)map.riverNodes[entity.endNodeId]=entity.points[entity.points.length-1]!;}
    delete map.deleted[id]; ids.push(id);
  }
  map.generators[options.genId] = { type: options.type, seed: options.seed, params: options.params,
    regionEntityId: region.id, boundary: region.rings.map(r=>r.map(p=>({...p}))), groupId, algorithmVersion: Number(options.params.algorithmVersion ?? 2), layerId: layer.id, themeName: options.themeName ?? 'default' };
  if (input.terrainResult) { map.terrain ??= {}; map.terrain[options.genId] = input.terrainResult; }
  if (options.type === 'world' || options.type === 'city') {
    // Paint terrain/district fills beneath deliberate edits, with buildings/rivers/symbols above.
    const outputIds = new Set(ids), entities = Object.values(map.entities);
    const isBackground = (e: Entity) => e.type === 'area' && (options.type === 'world' || e.role !== 'building');
    const backgrounds = entities.filter(e => outputIds.has(e.id) && isBackground(e));
    const foregrounds = entities.filter(e => outputIds.has(e.id) && !isBackground(e));
    const kept = entities.filter(e => e.id !== region.id && !outputIds.has(e.id));
    map.entities = Object.fromEntries([region, ...backgrounds, ...kept, ...foregrounds].map(e => [e.id, e]));
  }
  return ids;
}
