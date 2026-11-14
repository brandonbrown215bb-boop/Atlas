import clipping from 'polygon-clipping';
import { fromPolygons, rectRing, toPolygons } from '../../geom/fog';
import { boxesIntersect, getEntityBounds } from '../../geom/hitTest';
import type { WorldDocument } from '../../model/commands';
import type { Entity, MapDoc } from '../../model/schema';
import { buildTerrain, TerrainParamsSchema, type Area } from './terrain';
import { buildClimate } from './climate';
import { climateContext } from './context';

/** Repaint generated biomes in their existing coverage; never reroll the incoming geography. */
export function reclimateMap(world: WorldDocument, map: MapDoc, createId: () => string): void {
  if (map.kind !== 'world' && map.kind !== 'region') return;
  const children = Object.values(world.maps).filter(m => m.parent?.mapId === map.id);
  const developed = new Set(children.flatMap(m => m.parent!.footprintEntityId ? [m.parent!.footprintEntityId] : []));
  const footprints = new Set(Object.values(map.generators).map(g => g.regionEntityId));
  const protectedIds = new Set([...developed, ...footprints, ...Object.values(map.entities).flatMap(e => e.type === 'place' ? e.entityIds : [])]);
  const eligible = Object.values(map.entities).filter((e): e is Area => e.type === 'area' && e.role.startsWith('biome:')
    && e.origin === 'generated' && !protectedIds.has(e.id));
  if (!eligible.length) return;
  const cuts = Object.values(map.entities).filter((e): e is Area => e.type === 'area' && !footprints.has(e.id)
    && (developed.has(e.id) || (e.role.startsWith('biome:') && !eligible.some(a => a.id === e.id))
      || (e.origin !== 'generated' && ['building', 'district', 'floor'].includes(e.role))));
  const childPolygons = children.map(child => {
    const footprint = child.parent!.footprintEntityId ? map.entities[child.parent!.footprintEntityId] : undefined;
    if (footprint?.type === 'area') return footprint.rings;
    const t = child.parent!;
    return [rectRing(child.bounds).map(p => ({ x: p.x * Math.cos(t.rotation) - p.y * Math.sin(t.rotation) + t.x,
      y: p.x * Math.sin(t.rotation) + p.y * Math.cos(t.rotation) + t.y }))];
  });
  const masks = [...cuts.map(e => e.rings), ...childPolygons];
  const maskPolygons = masks.map(rings => toPolygons([rings]));
  const mask = maskPolygons.length ? clipping.union(maskPolygons[0]!, ...maskPolygons.slice(1)) : [];
  const groups = new Map<string, Area[]>();
  for (const e of eligible) { const key = e.genId ?? ''; const list = groups.get(key) ?? []; list.push(e); groups.set(key, list); }
  const replacement = new Map<string, Entity[]>();
  const reservedIds = new Set(Object.keys(map.entities));
  const revision = map.revision + 1;
  for (const [genId, areas] of groups) {
    const record = map.generators[genId];
    const footprint = record ? map.entities[record.regionEntityId] : undefined;
    const region = footprint?.type === 'area' ? footprint.rings : [rectRing(map.bounds)];
    const params = TerrainParamsSchema.parse(record?.params ?? {});
    const input = { seed: record?.seed ?? 0, params, region, constraints: [], grid: map.grid.size, theme: {}, climate: climateContext(world, map) };
    const terrain = buildTerrain(input);
    // Every cell supplies climate, including those straddling an existing biome edge.
    // Clipping against the saved coverage below keeps every coastline and hole exact.
    terrain.cells.forEach(c => { c.land = true; });
    terrain.land = areas.map(e => e.rings);
    const climates = buildClimate(terrain, input).entities.filter((e): e is Area => e.type === 'area');
    const indexed = climates.map(e => ({ e, box: getEntityBounds(e)! }));
    for (const original of areas) {
      const pieces: Entity[] = [], box = getEntityBounds(original)!;
      const add = (template: Area, rings: Area['rings']) => {
        const id = pieces.length ? createId() : original.id;
        if (id !== original.id && reservedIds.has(id)) throw new Error('Re-climate entity id collision.');
        reservedIds.add(id);
        const area: Area = { ...original, id, rings, role: template.role, name: template.name, fill: template.fill, rev: revision };
        if (template !== original) delete area.texture;
        pieces.push(area);
      };
      // Keep the old climate beneath developed locations and manual overrides.
      if (mask.length) for (const rings of fromPolygons(clipping.intersection(toPolygons([original.rings]), mask))) add(original, rings);
      for (const { e, box: climateBox } of indexed) {
        if (!boxesIntersect(box, climateBox)) continue;
        let polygons = clipping.intersection(toPolygons([original.rings]), toPolygons([e.rings]));
        if (mask.length && polygons.length) polygons = clipping.difference(polygons, mask);
        for (const rings of fromPolygons(polygons)) {
          add(e, rings);
        }
      }
      replacement.set(original.id, pieces);
    }
  }
  // Keep replacement fragments beside their old area, below manual work and symbols.
  map.entities = Object.fromEntries(Object.values(map.entities).flatMap(e => (replacement.get(e.id) ?? [e]).map(p => [p.id, p])));
  for (const [id, pieces] of replacement) if (!pieces.length) map.deleted[id] = revision;
  map.revision = revision;
}
