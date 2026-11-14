import { z } from 'zod';
import { boxesIntersect, getEntityBounds } from '../geom/hitTest';
import { EntitySchema, type Climate, type Entity, type MapDoc, type Point, type Theme } from '../model/schema';

export interface GeneratorInput<P> {
  seed: number;
  params: P;
  region: Point[][];
  constraints: Entity[];
  theme: Theme;
  grid: number;
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
  return Object.values(map.entities).filter(e => {
    const bounds = getEntityBounds(e);
    return e.id !== excludeId && e.origin !== 'generated' && bounds && boxesIntersect(box, bounds);
  });
}

/** Replace only this run's untouched output. Edited output is a constraint for the next run. */
export function runGenerator(map: MapDoc, options: {
  genId: string; type: string; seed: number; params: Record<string, unknown>;
  regionEntityId: string; layerId: string; theme: Theme; themeName?: string; dressingOnly?: boolean;
  climate?: GeneratorInput<unknown>['climate'];
}): string[] {
  if (options.type === 'glade' && map.kind !== 'site') throw new Error('Outdoor generators need a site map.');
  if (options.type === 'world' ? !['world', 'region'].includes(map.kind) : map.kind !== 'site' && map.kind !== 'interior') {
    throw new Error(options.type === 'world' ? 'World generators need a world or region map.' : 'Generators need a site or interior map.');
  }
  const region = map.entities[options.regionEntityId];
  if (region?.type !== 'area') throw new Error('Choose an area as the generator footprint.');
  const layer = map.layers.find(l => l.id === options.layerId);
  if (!layer?.visible || layer.locked) throw new Error('Choose a visible, unlocked layer.');
  const definition = getGenerator(options.type);
  const input: GeneratorInput<unknown> = { seed: options.seed, params: definition.params.parse(options.params),
    region: region.rings, constraints: regionConstraints(map, region.rings, region.id), theme: options.theme, grid: map.grid.size, climate: options.climate };
  const previous = Object.values(map.entities).filter(e => e.genId === options.genId && e.origin === 'generated');
  if (previous.some(e => map.layers.find(l => l.id === e.layerId)?.locked)) throw new Error('Unlock the generated layers before rerolling.');
  if (options.dressingOnly && !definition.dress) throw new Error('This generator has no dressing pass.');
  const output = options.dressingOnly
    ? definition.dress!(input, Object.values(map.entities).filter(e => e.genId === options.genId && e.type !== 'prop'))
    : definition.generate(input);
  const validated = output.map(e => EntitySchema.parse(e));
  if (validated.some(e => e.origin !== 'generated')) throw new Error('Generator returned non-generated output.');
  if (new Set(validated.map(e => e.id)).size !== validated.length) throw new Error('Generator returned duplicate ids.');
  map.revision++;
  if(region.origin==='generated') {region.origin='manual';region.rev=map.revision;}
  for (const e of previous) {
    if (options.dressingOnly && e.type !== 'prop') continue;
    delete map.entities[e.id]; map.deleted[e.id] = map.revision;
  }
  for(const e of Object.values(map.entities)) if(e.type==='place'&&e.entityIds.some(id=>!map.entities[id])) {
    e.entityIds=e.entityIds.filter(id=>!!map.entities[id]);e.rev=map.revision;
  }
  const ids: string[] = [];
  for (const entity of validated) {
    const id = `${options.genId}:${map.revision}:${entity.id}`;
    if (map.entities[id]) throw new Error(`Generated id already exists: ${id}`);
    map.entities[id] = { ...entity, id, genId: options.genId, rev: map.revision, layerId: layer.id };
    delete map.deleted[id]; ids.push(id);
  }
  map.generators[options.genId] = { type: options.type, seed: options.seed, params: options.params,
    regionEntityId: region.id, layerId: layer.id, themeName: options.themeName ?? 'default' };
  if (options.type === 'world') {
    // Paint terrain beneath deliberate edits, with rivers and symbols above the area fills.
    const outputIds = new Set(ids), entities = Object.values(map.entities);
    const backgrounds = entities.filter(e => outputIds.has(e.id) && e.type === 'area');
    const foregrounds = entities.filter(e => outputIds.has(e.id) && e.type !== 'area');
    const kept = entities.filter(e => e.id !== region.id && !outputIds.has(e.id));
    map.entities = Object.fromEntries([region, ...backgrounds, ...kept, ...foregrounds].map(e => [e.id, e]));
  }
  return ids;
}
