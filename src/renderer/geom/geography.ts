import type { MultiPolygon } from 'polygon-clipping';
import clipping from './polygonClipping';
import type { Entity, MapDoc, Point } from '../model/schema';
import { fromPolygons, rectRing, toPolygons } from './fog';

export type Area = Extract<Entity, { type: 'area' }>;
export const isOcean = (e: Entity) => e.type === 'area' && e.role === 'water' &&
  (e.waterKind === 'ocean' || (!e.waterKind && e.name === 'Ocean' && (!!e.genId || e.origin === 'inherited')));
export const isWorldSymbol = (e: Entity) => e.type === 'prop' &&
  (!!e.symbolKind || ['mountain', 'hill', 'forest', 'settlement'].includes(e.builtin ?? ''));
/** Shoelace area: positive for counter-clockwise rings in y-up space. */
export function signedArea(ring: readonly Point[]): number {
  return ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}
/** Outer ring area minus holes. */
export const polygonArea = (rings: Point[][]) => rings.reduce((sum, r, i) => {
  const a = Math.abs(signedArea(r));
  return sum + (i ? -a : a);
}, 0);
const union = (parts: MultiPolygon[]): MultiPolygon => parts.length ? clipping.union(...parts as [MultiPolygon, ...MultiPolygon[]]) : [];
export function resolveGeography(map: MapDoc) {
  const areas = Object.values(map.entities).filter((e): e is Area => e.type === 'area' && e.usage !== 'boundary');
  const ground = union(areas.filter(e => e.role === 'land').map(e => toPolygons([e.rings])));
  const lakes = union(areas.filter(e => e.role === 'water' && !isOcean(e)).map(e => toPolygons([e.rings])));
  const land = ground.length && lakes.length ? clipping.difference(ground, lakes) : ground;
  const outside = map.outsideLandIsWater ?? ['world', 'region'].includes(map.kind);
  const hasOcean = areas.some(isOcean);
  const ocean = (hasOcean || (outside && land.length)) ? clipping.difference(hasOcean ? union(areas.filter(isOcean).map(e => toPolygons([e.rings]))) : toPolygons([[rectRing(map.bounds)]]), land) : [];
  return { land: fromPolygons(land), lakes: fromPolygons(lakes), ocean: fromPolygons(ocean), water: fromPolygons(union([lakes, ocean])) };
}

/** Resolve legacy ocean-under-land before any obstacle or inheritance calculation. */
const renderedCache=new WeakMap<MapDoc,{revision:number;entities:Entity[]}>();
export function geographicEntities(map: MapDoc): Entity[] {
  const cached=renderedCache.get(map);if(cached?.revision===map.revision)return cached.entities;
  const geography = resolveGeography(map);
  const entities = Object.values(map.entities);
  const implicit: Entity[] = entities.some(isOcean) ? [] : geography.ocean.map((rings,i)=>({id:`implicit-ocean-${i}`,type:'area',role:'water',waterKind:'ocean',name:'Ocean',rings,layerId:map.layers[0]?.id??'layer-base',origin:'generated',rev:map.revision,fill:'#244c67'}));
  const drawRank = (e: Entity): number => {
    if (e.type === 'area') {
      if (e.role === 'building') return 3;
      if (e.role === 'land' && e.name?.startsWith('Clearing ')) return 2;
      return 0;
    }
    if (e.type === 'path') return e.role === 'cityWall' ? 4 : 1;
    if (e.type === 'wall') return 4;
    if (e.type === 'door' || e.type === 'prop' || e.type === 'portal' || e.type === 'image') return 5;
    if (e.type === 'light') return 6;
    if (e.type === 'label') return 7;
    return 8;
  };
  const resolved: Entity[] = [
    ...implicit,
    ...entities.flatMap((e): Entity[] => {
      if (e.usage === 'boundary') return [];
      if (isWorldSymbol(e) && !['world', 'region'].includes(map.kind)) return [];
      if (isOcean(e)) return geography.ocean.map((rings, i) => ({ ...e, id: i ? `${e.id}:resolved-${i}` : e.id, rings } as Entity));
      if (e.type === 'area' && (e.role === 'land' || e.role.startsWith('biome:')) && (geography.lakes.length || (e.role.startsWith('biome:') && geography.land.length))) {
        // Generator biomes were clipped against these exact masks already. Repeating that
        // boolean on shared coast vertices is both expensive and numerically unstable.
        if (e.role.startsWith('biome:') && e.origin === 'generated' && map.generators[e.genId ?? '']?.type === 'world' &&
          !entities.some(a => a.type === 'area' && (a.role === 'land' || a.role === 'water') && a.usage !== 'boundary' && a.rev > e.rev)) return [e];
        const shape = e.role.startsWith('biome:') && geography.land.length ? clipping.intersection(toPolygons([e.rings]), toPolygons(geography.land)) : clipping.difference(toPolygons([e.rings]), toPolygons(geography.lakes));
        return fromPolygons(shape).map((rings, i) => ({ ...e, id: i ? `${e.id}:part-${i}` : e.id, rings }));
      }
      return [e];
    }),
  ].sort((a, b) => drawRank(a) - drawRank(b));
  renderedCache.set(map, { revision: map.revision, entities: resolved });
  return resolved;
}
