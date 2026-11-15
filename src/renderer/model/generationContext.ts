import type { Entity, GeneratorRecord, MapDoc } from './schema';
import { polygonArea } from '../geom/geography';
import { rectRing, toPolygons } from '../geom/fog';
import clipping from '../geom/polygonClipping';

export type GenerationType = 'world' | 'city' | 'glade' | 'dungeon';
export interface GenerationContext {
  key: string;
  kind: 'generate' | 'result' | 'building' | 'room' | 'chooseSite' | 'results' | 'selection';
  label: string;
  type?: GenerationType;
  regionId?: string;
  genId?: string;
  record?: GeneratorRecord;
  mode?: 'new' | 'populate';
}
export const resultName = (map: MapDoc, id: string) => {
  const r = map.generators[id];
  return map.entities[r?.regionEntityId ?? '']?.name ?? map.groups?.[r?.groupId ?? id]?.name ??
    ({ world: 'Terrain', city: 'Town', glade: 'Woodland', dungeon: 'Rooms' }[r?.type ?? ''] ?? 'Result');
};
export function coversMap(map: MapDoc, record: GeneratorRecord) {
  const source = map.entities[record.regionEntityId];
  const rings = source?.type === 'area' ? source.rings : record.boundary;
  if (!rings?.length || rings.length !== 1) return false;
  const p = rings[0]!, b = map.bounds, tolerance = Math.max(b.w, b.h) * 1e-7;
  return Math.abs(Math.min(...p.map(q => q.x)) - b.x) < tolerance &&
    Math.abs(Math.min(...p.map(q => q.y)) - b.y) < tolerance &&
    Math.abs(Math.max(...p.map(q => q.x)) - b.x - b.w) < tolerance &&
    Math.abs(Math.max(...p.map(q => q.y)) - b.y - b.h) < tolerance &&
    Math.abs(polygonArea(rings) - b.w * b.h) < b.w * b.h * 1e-7;
}
export function authoredLandInTarget(map: MapDoc, regionId?: string) {
  const region = map.entities[regionId ?? ''];
  const rings = region?.type === 'area' ? region.rings : [rectRing(map.bounds)];
  return Object.values(map.entities).some(e => e.type === 'area' && e.role === 'land' &&
    e.origin !== 'generated' && !e.usage && clipping.intersection(toPolygons([rings]), toPolygons([e.rings])).length > 0);
}
export function resultContext(map: MapDoc, genId: string): GenerationContext {
  const record = map.generators[genId]!;
  return { key: `result:${genId}`, kind: 'result', label: resultName(map, genId),
    type: record.type as GenerationType, genId, record, regionId: record.regionEntityId };
}
export function resolveGenerationContext(map: MapDoc, selectedIds: readonly string[], editParts: boolean,
  siteType?: 'glade' | 'dungeon'): GenerationContext {
  const selected = selectedIds.map(id => map.entities[id]).filter((e): e is Entity => !!e);
  const single = selected.length === 1 ? selected[0] : undefined;
  const linkedBuilding = single?.type === 'place'
    ? single.entityIds
        .map(id => map.entities[id])
        .find((e): e is Extract<Entity, { type: 'area' }> => e?.type === 'area' && e.role === 'building')
    : undefined;
  const targetBuilding = single?.type === 'area' && single.role === 'building' ? single : linkedBuilding;
  if (map.kind === 'settlement' && targetBuilding) {
    const owner = targetBuilding.genId && map.generators[targetBuilding.genId] ? targetBuilding.genId : undefined;
    return { key: `building:${targetBuilding.id}`, kind: 'building', label: `${single?.name ?? targetBuilding.name ?? 'Building'} interior`,
      type: 'dungeon', regionId: targetBuilding.id, genId: owner, record: owner ? map.generators[owner] : undefined };
  }
  const owner = single?.genId && map.generators[single.genId] ? single.genId : undefined;
  if (editParts && single?.type === 'area' && single.role === 'floor' && owner && map.generators[owner]?.type === 'dungeon') {
    return { key: `room:${single.id}`, kind: 'room', label: single.name ?? 'Room', type: 'dungeon',
      regionId: single.id, genId: owner, record: map.generators[owner] };
  }
  if (selected.length) {
    const owners = Object.entries(map.generators).filter(([id, r]) => selected.every(e =>
      e.genId === id || (!!e.groupId && e.groupId === (r.groupId ?? id)) || e.id === r.regionEntityId));
    if (owners.length === 1 && (!editParts || !single || single.usage === 'boundary')) return resultContext(map, owners[0]![0]);
    const eligible = single?.type === 'area' && !single.usage &&
      (['world', 'region', 'settlement'].includes(map.kind) ? ['land', 'district'].includes(single.role) :
        ['land', 'floor', 'building', 'district'].includes(single.role));
    if (!eligible) return { key: `selection:${selected.map(e => e.id).sort().join(',')}`, kind: 'selection', label: single?.name ?? 'Selection' };
  } else {
    const runs = Object.entries(map.generators).filter(([, r]) => coversMap(map, r));
    if (runs.length === 1) return resultContext(map, runs[0]![0]);
    if (runs.length > 1) return { key: 'results', kind: 'results', label: 'Whole map' };
  }
  const regionId = single?.id;
  const type = ['world', 'region'].includes(map.kind) ? 'world' : map.kind === 'settlement' ? 'city' : map.kind === 'interior' ? 'dungeon' : siteType;
  return { key: `generate:${regionId ?? 'map'}:${type ?? 'choose'}`, kind: type ? 'generate' : 'chooseSite',
    label: single?.name ?? (single ? 'Selected area' : 'Whole map'), type, regionId,
    mode: type === 'world' && authoredLandInTarget(map, regionId) ? 'populate' : 'new' };
}
