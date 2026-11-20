import { describe, expect, it } from 'vitest';
import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { EntitySchema, MapDocSchema, WorldMetaSchema, type Entity, type Point } from '../../model/schema';
import { createWorldStore } from '../../model/store';
import { generateOutdoor, OutdoorParamsSchema } from './outdoor';

const region = [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 65 }, { x: 0, y: 65 }]];
const makeInput = (seed = 1, params = {}, constraints: Entity[] = [], shape = region) => ({ seed, params: OutdoorParamsSchema.parse(params), region: shape, constraints, theme: {}, grid: 1.524 });
const trails = (entities: Entity[]) => entities.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'trail');
const onTrail = (p: Point, entities: Entity[]) => trails(entities).some(t => t.points.slice(1).some((b, i) => distanceToSegment(p, t.points[i]!, b) <= t.width / 2));
const onBridge = (p: Point, entities: Entity[]) => entities.some(e => {
  if (e.type !== 'prop' || e.name !== 'Stream bridge') return false;
  const dx = p.x - e.x, dy = p.y - e.y, cos = Math.cos(e.rotation), sin = Math.sin(e.rotation);
  return Math.abs(dx * cos + dy * sin) <= e.w! / 2 && Math.abs(-dx * sin + dy * cos) <= e.h! / 2;
});

// Flood the actual output, rather than checking the generator's internal routing graph.
function checkConnected(entities: Entity[], shape: Point[][]) {
  const clearings = entities.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.name?.startsWith('Clearing ') === true);
  const river = entities.find((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'river');
  const trees = entities.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.name === 'Tree');
  const labels = entities.filter((e): e is Extract<Entity, { type: 'label' }> => e.type === 'label');
  const cells = new Map<string, Point>();
  for (let y = .5; y < 65; y++) for (let x = .5; x < 80; x++) {
    const p = { x, y };
    if (!pointInPolygon(p, shape) || !(clearings.some(c => pointInPolygon(p, c.rings)) || onTrail(p, entities))) continue;
    if (river && river.points.slice(1).some((b, i) => distanceToSegment(p, river.points[i]!, b) < river.width / 2) && !onBridge(p, entities)) continue;
    if (trees.some(t => Math.hypot(t.x - x, t.y - y) < t.w! / 2)) continue;
    cells.set(`${x},${y}`, p);
  }
  const label = labels[0]!, start = [...cells.values()].sort((a, b) => Math.hypot(a.x - label.x, a.y - label.y) - Math.hypot(b.x - label.x, b.y - label.y))[0]!;
  const queue = [start], seen = new Set([`${start.x},${start.y}`]);
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const p = queue[i]!, k = `${p.x + dx!},${p.y + dy!}`, next = cells.get(k);
    if (next && !seen.has(k)) { seen.add(k); queue.push(next); }
  }
  for (const clearing of clearings) expect(queue.some(p => pointInPolygon(p, clearing.rings)), clearing.name).toBe(true);
  for (const trail of trails(entities)) for (const p of [trail.points[0]!, trail.points.at(-1)!]) {
    expect(queue.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 2), 'trail endpoint reaches the network').toBe(true);
  }
}

describe('outdoor woodland generator', () => {
  it('is deterministic, numbers every clearing, and connects every clearing and entrance across water', () => {
    for (const seed of [1, 2, 3, 8, 19]) {
      const input = makeInput(seed), output = generateOutdoor(input);
      expect(output).toEqual(generateOutdoor(input));
      expect(output.every(e => EntitySchema.safeParse(e).success && e.origin === 'generated')).toBe(true);
      expect(output.filter(e => e.type === 'label').map(e => e.text)).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(output.some(e => e.name === 'Pond')).toBe(true);
      expect(output.some(e => e.name === 'Stream bridge')).toBe(true);
      checkConnected(output, region);
      const river = output.find((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'river')!;
      for (const trail of trails(output)) for (let i = 1; i < trail.points.length; i++) {
        const a = trail.points[i - 1]!, b = trail.points[i]!, steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / .15);
        for (let j = 0; j <= steps; j++) {
          const p = { x: a.x + (b.x - a.x) * j / steps, y: a.y + (b.y - a.y) * j / steps };
          if (river.points.slice(1).some((q, k) => distanceToSegment(p, river.points[k]!, q) <= river.width / 2)) expect(onBridge(p, output)).toBe(true);
        }
      }
    }
  });
  it('winds trails instead of pulling them taut or stepping them along the grid', () => {
    // Before the fix these seeds gave 3-8 ruler-straight trails each and grid stairs with up to 13 sharp turns.
    for (const clearings of [4, 6]) for (const seed of [1, 2, 7, 42]) {
      let straight = 0;
      for (const { points: p } of trails(generateOutdoor(makeInput(seed, { clearings })))) {
        const a = p[0]!, b = p.at(-1)!, chord = Math.hypot(a.x - b.x, a.y - b.y);
        if (chord > 15 && Math.max(...p.map(q => distanceToSegment(q, a, b))) < chord * .05) straight++;
        const sharp = p.slice(2).filter((c, i) => {
          const ex = p[i + 1]!.x - p[i]!.x, ey = p[i + 1]!.y - p[i]!.y, dx = c.x - p[i + 1]!.x, dy = c.y - p[i + 1]!.y;
          return Math.abs(Math.atan2(ex * dy - ey * dx, ex * dx + ey * dy)) > Math.PI / 3;
        }).length;
        expect(sharp, `seed ${seed} grid stairs`).toBeLessThanOrEqual(3);
      }
      expect(straight, `seed ${seed} straight trails`).toBeLessThanOrEqual(1);
    }
  });
  it('handles concave footprints, holes, custom entrances, manual areas, trails and props', () => {
    const shape = [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 65 }, { x: 45, y: 65 }, { x: 45, y: 50 }, { x: 0, y: 50 }],
      [{ x: 25, y: 15 }, { x: 35, y: 15 }, { x: 35, y: 25 }, { x: 25, y: 25 }]];
    const constraints: Entity[] = [
      { id: 'camp', type: 'area', role: 'building', origin: 'manual', layerId: 'base', rev: 2, rings: [[{ x: 48, y: 25 }, { x: 58, y: 25 }, { x: 58, y: 35 }, { x: 48, y: 35 }]] },
      { id: 'stone', type: 'prop', builtin: 'rock', origin: 'inherited', layerId: 'base', rev: 3, x: 16, y: 35, w: 4, h: 4, scale: 1, rotation: 0, flipX: false },
      { id: 'trail', type: 'path', role: 'trail', origin: 'manual', layerId: 'base', rev: 4, points: [{ x: 5, y: 8 }, { x: 20, y: 8 }], width: 2, closed: false },
      { id: 'inherited-land', type: 'area', role: 'land', origin: 'inherited', layerId: 'base', rev: 1, rings: shape },
    ];
    const snapshot = structuredClone(constraints), input = makeInput(9, { water: false, clearings: 5, entrances: [{ x: 0, y: 10 }, { x: 80, y: 42 }] }, constraints, shape);
    const output = generateOutdoor(input);
    expect(constraints).toEqual(snapshot);
    checkConnected(output, shape);
    for (const trail of trails(output)) for (let i = 1; i < trail.points.length; i++) {
      const a = trail.points[i - 1]!, b = trail.points[i]!;
      for (let t = .05; t < 1; t += .05) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        expect(pointInPolygon(p, shape)).toBe(true);
        expect(pointInPolygon(p, (constraints[0]! as Extract<Entity, { type: 'area' }>).rings)).toBe(false);
        const rock = getEntityBounds(constraints[1]!)!;
        expect(p.x > rock.minX && p.x < rock.maxX && p.y > rock.minY && p.y < rock.maxY).toBe(false);
      }
    }
    expect(trails(output).some(t => t.points[0]!.x === 0 && t.points[0]!.y === 10)).toBe(true);
    expect(trails(output).some(t => t.points[0]!.x === 5 && t.points[0]!.y === 8)).toBe(true);
  });
  it('supports independent water switches, density and theme roles', () => {
    const dry = generateOutdoor(makeInput(1, { water: false, density: 0 }));
    expect(dry.some(e => e.type === 'prop' || e.type === 'path' && e.role === 'river' || e.type === 'area' && e.role === 'water')).toBe(false);
    const input = makeInput(1, { pond: false });
    const themed = generateOutdoor({ ...input, theme: { tree: ['tree-art'], bridge: ['bridge-art'] } });
    expect(themed.some(e => e.type === 'area' && e.role === 'water')).toBe(false);
    expect(themed.filter(e => e.type === 'prop' && e.name === 'Tree').every(e => e.type === 'prop' && e.assetId === 'tree-art')).toBe(true);
    expect(themed.some(e => e.type === 'prop' && e.assetId === 'bridge-art')).toBe(true);
    expect(generateOutdoor(makeInput(1, { stream: false })).some(e => e.type === 'path' && e.role === 'river')).toBe(false);
  });
  it('bridges only the wet part of a long hand-drawn trail', () => {
    const manual: Entity = { id: 'long-trail', type: 'path', role: 'trail', origin: 'manual', layerId: 'base', rev: 1,
      points: [{ x: 40, y: 0 }, { x: 40, y: 65 }], width: 2, closed: false };
    const output = generateOutdoor(makeInput(1, {}, [manual]));
    const river = output.find((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'river')!;
    for (let y = .1; y < 65; y += .1) {
      const p = { x: 40, y };
      if (river.points.slice(1).some((b, i) => distanceToSegment(p, river.points[i]!, b) < river.width / 2)) {
        const crossing = output.filter(e => e.type === 'prop' && e.name === 'Stream bridge');
        expect(onBridge(p, crossing)).toBe(true);
        expect(crossing.some(e => e.type === 'prop' && e.w! < 20 && onBridge(p, [e]))).toBe(true);
      }
    }
  });
  it('rerolls around edited output, keeps constraints exactly, persists params and undoes in one step', () => {
    const footprint: Entity = { id: 'footprint', type: 'area', role: 'land', origin: 'manual', layerId: 'base', rev: 0, rings: region };
    const map = MapDocSchema.parse({ id: 'site', name: 'Forest', kind: 'site', bounds: { x: 0, y: 0, w: 80, h: 65 }, grid: { size: 1.524, visible: true },
      layers: [{ id: 'base', name: 'Ground', visible: true, locked: false, gmOnly: false }], entities: { footprint }, generators: {}, revision: 0, deleted: {}, fog: { enabled: false, revealed: [] } });
    const meta = WorldMetaSchema.parse({ formatVersion: 1, id: 'world', name: 'World', maps: [{ id: 'site', name: 'Forest', kind: 'site' }], themes: {} });
    const store = createWorldStore(), s = () => store.getState(); s().loadWorld(meta, { site: map });
    s().execute('generator.run', { mapId: 'site', genId: 'woods', type: 'glade', seed: 1, params: { water: true }, regionEntityId: 'footprint', layerId: 'base' });
    const tree = Object.values(s().world!.maps.site!.entities).find(e => e.type === 'prop' && e.name === 'Tree')!;
    s().execute('entity.update', { mapId: 'site', entityId: tree.id, patch: { name: 'My tree' } });
    const before = s().world;
    s().execute('generator.reroll', { mapId: 'site', genId: 'woods', seed: 2, params: { water: false, entrances: [{ x: 0, y: 15.24 }] } });
    expect(s().world!.maps.site!.entities[tree.id]).toEqual(before!.maps.site!.entities[tree.id]);
    expect(s().world!.maps.site!.entities.footprint).toEqual({...footprint,usage:'boundary',groupId:'woods'});
    expect(MapDocSchema.parse(s().world!.maps.site).generators.woods).toMatchObject({ type: 'glade', seed: 2, params: { water: false } });
    s().undo(); expect(s().world).toEqual(before);
  });
  it('rejects impossible layouts and invalid params without mutating its input', () => {
    expect(() => OutdoorParamsSchema.parse({ clearings: 0 })).toThrow();
    expect(() => OutdoorParamsSchema.parse({ density: 4 })).toThrow();
    const small = [[{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }]];
    const input = makeInput(1, {}, [], small), snapshot = structuredClone(input);
    expect(() => generateOutdoor(input)).toThrow('Not enough open ground');
    expect(input).toEqual(snapshot);
    const split = [...region, [{ x: 38, y: -1 }, { x: 42, y: -1 }, { x: 42, y: 66 }, { x: 38, y: 66 }]];
    expect(() => generateOutdoor(makeInput(1, {}, [], split))).toThrow('disconnected');
  });
  it('supports roadside hedgerow and overgrown ruins presets', () => {
    const roadside = generateOutdoor(makeInput(3, { preset: 'roadside', water: false }));
    expect(roadside.some(e => e.type === 'path' && e.role === 'road' && e.name === 'Country road')).toBe(true);
    expect(roadside.some(e => e.type === 'prop' && e.name === 'Hedgerow')).toBe(true);
    const ruins = generateOutdoor(makeInput(3, { preset: 'ruins', water: false }));
    expect(ruins.some(e => e.type === 'wall' && e.name === 'Ruined wall')).toBe(true);
  });
  it('structures clearings with Theory of the Place (Antechamber, Focal Enclosure, Secondary Entrance, and Overlook Ridge)', () => {
    const out = generateOutdoor(makeInput(2, { clearings: 5, water: true, density: 1 }));
    const places = out.filter((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place');
    expect(places.some((p) => p.id === 'place-outdoor-antechamber' && p.discoveryTier === 'landmark')).toBe(true);
    expect(places.some((p) => p.id === 'place-outdoor-focal' && p.name.includes('The Place'))).toBe(true);
    expect(out.some((e) => e.type === 'area' && e.id === 'place-focal-apron' && e.floorMaterial === 'stone')).toBe(true);
    expect(out.some((e) => e.type === 'area' && e.role === 'plateau' && e.name === 'Overlook Cliff Ridge')).toBe(true);
  });
});
