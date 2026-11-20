import { describe, expect, it } from 'vitest';
import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { FOOT } from '../../model/mapDefaults';
import type { Entity, MapDoc } from '../../model/schema';
import { mapBackdropStyle } from '../../render/backdrop';
import { auditDungeonTopology } from './audit';
import { DungeonParamsSchema, dungeonLayout, generateDungeon } from './layout';
import { dungeonSituation } from './situations';
import { planDungeon } from './story';

type Area = Extract<Entity, { type: 'area' }>;
type Door = Extract<Entity, { type: 'door' }>;
type Place = Extract<Entity, { type: 'place' }>;
const g = 1.524, side = 152.4;
const region = [[{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }]];
const input = (seed: number, constraints: Entity[] = []) =>
  ({ seed, params: DungeonParamsSchema.parse({ mode: 'dungeon', rooms: 10 }), region, constraints, theme: {}, grid: g });
const of = <T extends Entity['type']>(es: Entity[], type: T) => es.filter((e): e is Extract<Entity, { type: T }> => e.type === type);
const touches = (d: Door, f: Area) => f.rings.some(r => r.some((a, i) => distanceToSegment({ x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }, a, r[(i + 1) % r.length]!) < g * 0.16));
const areaPlace = (es: Entity[], n: number) => of(es, 'place').find(p => p.name.startsWith(`Area ${n}:`))!;
const floorOf = (es: Entity[], p: Place) => of(es, 'area').find(f => f.id === p.entityIds[0])!;
const namedRoom = (es: Entity[], title: string) => of(es, 'place').find(p => p.name.endsWith(`: ${title}`))!;

function reachable(es: Entity[], omittedRooms: Area[] = [], allowLocked = false) {
  const floors = of(es, 'area').filter(f => f.role === 'floor' && !omittedRooms.includes(f));
  const doors = of(es, 'door').filter(d => (allowLocked || !d.locked) && d.kind !== 'secret');
  const connections = doors.map(d => floors.filter(f => touches(d, f)));
  const seen = new Set([floorOf(es, areaPlace(es, 1))]);
  for (let grew = true; grew;) {
    grew = false;
    for (const fs of connections) if (fs.some(f => seen.has(f)) && fs.some(f => !seen.has(f))) {
      fs.forEach(f => seen.add(f));
      grew = true;
    }
  }
  return seen;
}

describe('dungeon story', () => {
  const cases = [
    { seed: 42, target: 'Burial Vault', routes: ['Processional Hall', 'Ossuary'], lead: 'Offering Court', landmark: 'Burial Bell' },
    { seed: 7, target: 'Pump House', routes: ['Plank Walk', 'Inspection Passage'], lead: 'Plank Walk', landmark: 'Flooded Basin' },
    { seed: 113, target: 'Winch Room', routes: ['Watch Court', 'Stores'], lead: 'Mess Room', landmark: 'Grille Winch' },
    { seed: 210, target: 'Burial Vault', routes: ['Processional Hall', 'Ossuary'], lead: 'Offering Court', landmark: 'Burial Bell' },
  ];
  for (const { seed, target, routes, lead, landmark } of cases) it(`seed ${seed}: different approaches lead to the ${target}`, () => {
    const es = generateDungeon(input(seed));
    expect(es).toEqual(generateDungeon(input(seed)));
    const audit = auditDungeonTopology({ entities: Object.fromEntries(es.map(e => [e.id, e])) } as unknown as MapDoc);
    expect(audit.sevenPillars.filter(p => !p.passed).map(p => p.id)).toEqual([]);

    // Compact: more room than corridor, and no corridor piece spans most of the sheet.
    const floors = of(es, 'area').filter(e => e.role === 'floor');
    let corridor = 0, room = 0;
    for (let y = g / 2; y < side; y += g) for (let x = g / 2; x < side; x += g) {
      const f = floors.find(f => pointInPolygon({ x, y }, f.rings));
      if (f) f.name === 'Corridor' ? corridor++ : room++;
    }
    expect(corridor).toBeLessThan(room);
    for (const f of floors.filter(f => f.name === 'Corridor')) {
      const b = getEntityBounds(f)!;
      expect(Math.max(b.maxX - b.minX, b.maxY - b.minY), f.id).toBeLessThanOrEqual(side * 0.6);
    }

    const places = of(es, 'place').filter(p => p.name.startsWith('Area '));
    const targetFloor = floorOf(es, namedRoom(es, target));
    const routeFloors = routes.map(title => floorOf(es, namedRoom(es, title)));
    for (const route of routeFloors) expect(reachable(es, [route]).has(targetFloor)).toBe(true);
    expect(reachable(es, routeFloors).has(targetFloor)).toBe(false);
    const leadArea = namedRoom(es, lead);
    const next = Number(leadArea.clueNext?.match(/Area (\d+)/)?.[1]);
    expect(areaPlace(es, next)).toBeDefined();
    expect(areaPlace(es, next)).not.toBe(leadArea);
    const feature = es.find(e => e.name === landmark)!;
    expect(feature).toBeDefined();
    expect(places.some(p => p.entityIds.includes(feature.id))).toBe(true);
    expect(areaPlace(es, 1).stockingRole).not.toBe('Trap');
    expect(places.some(p => p.stockingRole === 'Empty')).toBe(true);
    expect(new Set(places.map(p => p.notes)).size).toBe(places.length);
    expect(of(es, 'label').filter(l => /^\d+$/.test(l.text)).map(l => Number(l.text)).sort((a, b) => a - b)).toEqual(places.map((_, i) => i + 1));
    expect(of(es, 'place').some(p => p.id === 'place-dungeon')).toBe(true);
  });

  it('locks a real grille while both routes to the winch remain available', () => {
    const es = generateDungeon(input(113));
    const vault = floorOf(es, namedRoom(es, 'Strongroom'));
    const winch = namedRoom(es, 'Winch Room');
    const grilles = of(es, 'door').filter(d => d.name === 'Iron Grille');
    expect(grilles).toHaveLength(1);
    expect(grilles[0]).toMatchObject({ locked: true, material: 'iron' });
    expect(touches(grilles[0]!, vault) && winch.entityIds.includes(grilles[0]!.id)).toBe(true);
    expect(reachable(es).has(vault)).toBe(false);
    expect(reachable(es, [], true).has(vault)).toBe(true);
    expect(of(generateDungeon(input(7)), 'door').some(d => d.locked)).toBe(false);
  });

  it('keeps themed winches at physical scale across grid sizes and room dimensions', () => {
    for (const grid of [5 * FOOT, 4 * FOOT]) {
      const es = generateDungeon({ ...input(113), grid, theme: { winch: ['winch-art'] } });
      const winch = of(es, 'prop').find(p => p.name === 'Grille Winch')!;
      expect(winch.assetId).toBe('winch-art');
      expect(winch.w! / FOOT).toBeCloseTo(5);
      expect(winch.h! / FOOT).toBeCloseTo(3.5);
    }
  });

  it('keeps the plank walk one square wide and long enough to reach both banks', () => {
    const es = generateDungeon(input(7));
    const basin = getEntityBounds(of(es, 'area').find(e => e.name === 'Flooded Basin')!)!;
    const bridge = of(es, 'prop').find(p => p.name === 'Plank Walk')!;
    expect(bridge.h! / FOOT).toBeCloseTo(5);
    expect(bridge.x - bridge.w! / 2).toBeLessThan(basin.minX);
    expect(bridge.x + bridge.w! / 2).toBeGreaterThan(basin.maxX);
  });

  it('fits the grille to a wider corridor on a mirrored, translated site', () => {
    const opts = input(2);
    const translated = region.map(r => r.map(p => ({ x: p.x + 44, y: p.y + 12 })));
    const es = generateDungeon({ ...opts, region: translated, params: { ...opts.params, rooms: 6, corridorWidth: 6, mirror: true } });
    const gate = of(es, 'door').find(d => d.material === 'iron')!;
    expect(Math.hypot(gate.a.x - gate.b.x, gate.a.y - gate.b.y)).toBeCloseTo(g * 6);
    expect(reachable(es, [], true).has(floorOf(es, namedRoom(es, 'Strongroom')))).toBe(true);
  });

  it('keeps the traditional lock-and-key layout for an explicitly themed dungeon', () => {
    const opts = input(42);
    const es = generateDungeon({ ...opts, params: { ...opts.params, purpose: 'crypt' } });
    const places = of(es, 'place').filter(p => p.name.startsWith('Area '));
    const goal = places.find(p => p.gmNotes.includes('Locked:'))!, key = places.find(p => p.gmNotes.startsWith('Key:') || p.gmNotes.includes(' Key:'))!;
    expect(reachable(es).has(floorOf(es, key))).toBe(true);
    expect(reachable(es).has(floorOf(es, goal))).toBe(false);
  });

  it('numbers rooms from the entrance outward', () => {
    for (const seed of [3, 42]) {
      const opts = input(seed);
      const plan = planDungeon(opts, dungeonLayout(opts), dungeonSituation(opts));
      expect(plan.rooms[0]!.name).toBe('Room 1');
      const depths = plan.rooms.map(r => plan.depth.get(r.id)!);
      expect(depths).toEqual([...depths].sort((a, b) => a - b));
      expect(plan.rooms.find(r => r.id === plan.goalId)!.roomPurpose).toBeDefined();
    }
  });

  it('varies its theme by seed', () => {
    const categories = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => planDungeon(input(seed), []).kind));
    expect(categories.size).toBeGreaterThanOrEqual(3);
  });

  it('becomes the world ruin it was developed from', () => {
    const ruin: Entity = { id: 'ruin-place', type: 'place', layerId: 'l', origin: 'inherited', rev: 1, name: 'Barrow of Ithmar', category: 'Ruin',
      notes: 'Ancient stonework.', gmNotes: 'Occupants: a lich-cursed vault that wakes at dusk. Complication: x. Reward: a relic of the old kingdom.', entityIds: [] };
    const desert: Entity = { id: 'desert', type: 'area', role: 'biome:desert', layerId: 'l', origin: 'inherited', rev: 1, rings: region };
    const es = generateDungeon({ ...input(42, [ruin, desert]), mapKind: 'site' });
    expect(of(es, 'label').find(l => l.id === 'dungeon-title')?.text).toBe('Barrow of Ithmar');
    expect(es[0]).toMatchObject({ id: 'bedrock', role: 'land' });
    expect(of(es, 'place').some(p => p.id === 'place-dungeon')).toBe(false);
    const goal = namedRoom(es, 'Burial Vault');
    expect(namedRoom(es, 'Processional Hall').gmNotes).toContain('a lich-cursed vault that wakes at dusk');
    expect(goal.gmNotes).toContain('a relic of the old kingdom');
    expect(goal.name).toContain('Burial Vault');
  });

  it('draws a dungeon site on rock and a woodland site on grass', () => {
    const site = (type: string) => ({ kind: 'site' as const, generators: { a: { type } } as unknown as MapDoc['generators'] });
    expect(mapBackdropStyle(site('dungeon')).texKind).toBe('parchment');
    expect(mapBackdropStyle(site('glade')).texKind).toBe('grass');
  });

  it('adds 2-faction splits, GM-only on-map titles/cues, one-way valve shortcuts, ICI keying, and new chasm/contested situations', () => {
    const proc = generateDungeon({ ...input(19), params: DungeonParamsSchema.parse({ mode: 'dungeon', rooms: 12, purpose: 'crypt', loops: 0.5 }) });
    const places = of(proc, 'place');
    const dungeonPlace = places.find((p) => p.id === 'place-dungeon')!;
    expect(dungeonPlace.factionLinks?.length).toBeGreaterThanOrEqual(2);
    expect(dungeonPlace.gmNotes).toContain('Factions:');
    expect(dungeonPlace.gmNotes).toContain('Aftermath:');

    // On-map GM room titles & corridor sensory-bleed cues are gmOnly so players never see them.
    const gmTitles = of(proc, 'label').filter((l) => l.id.startsWith('gm-title-'));
    const gmCues = of(proc, 'label').filter((l) => l.id.startsWith('gm-cue-'));
    expect(gmTitles.length).toBeGreaterThanOrEqual(4);
    expect(gmTitles.every((l) => l.gmOnly === true)).toBe(true);
    expect(gmCues.length).toBeGreaterThanOrEqual(1);
    expect(gmCues.every((l) => l.gmOnly === true && l.text.startsWith('↳'))).toBe(true);

    // ICI Landmark / Hidden keying & discoveryTier stamped on room places.
    const roomPlaces = places.filter((p) => p.id.startsWith('place-area-'));
    expect(roomPlaces.some((p) => p.notes.includes('Landmark:') && p.discoveryTier === 'landmark')).toBe(true);
    expect(roomPlaces.some((p) => p.gmNotes.includes('Hidden'))).toBe(true);

    // One-way valve shortcut appears on multi-loop dungeons.
    const hasValve = [19, 23, 31, 42, 55].some((s) =>
      generateDungeon({ ...input(s), params: DungeonParamsSchema.parse({ mode: 'dungeon', rooms: 12, purpose: 'crypt', loops: 0.6 }) })
        .some((e) => e.type === 'door' && (e.oneWay === 'ab' || e.oneWay === 'ba')),
    );
    expect(hasValve).toBe(true);

    // New puzzle-box situations: chasm (seed % 5 === 4) & contested (seed % 5 === 1).
    const chasm = generateDungeon(input(4));
    expect(of(chasm, 'place').some((p) => p.name.includes('Fissure') || p.name.includes('Bell Cloister'))).toBe(true);
    const contested = generateDungeon(input(1));
    expect(of(contested, 'place').some((p) => p.name.includes('Barricade') || p.name.includes('Contested') || p.name.includes('Larder'))).toBe(true);
  });
});
