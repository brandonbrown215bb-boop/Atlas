import { describe, expect, it } from 'vitest';
import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import type { Entity, MapDoc } from '../../model/schema';
import { mapBackdropStyle } from '../../render/backdrop';
import { auditDungeonTopology } from './audit';
import { DungeonParamsSchema, dungeonLayout, generateDungeon } from './layout';
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

describe('dungeon story', () => {
  for (const seed of [42, 7]) it(`seed ${seed}: passes every pillar, stays compact, locks its goal and hides the key`, () => {
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

    // Lock and key: the goal's public doors are locked and the key is reachable without them.
    const places = of(es, 'place').filter(p => p.name.startsWith('Area '));
    const goal = places.find(p => p.gmNotes.includes('Locked:'))!, key = places.find(p => p.clueNext)!;
    expect(goal.stockingRole).toBe('Monster');
    const doors = of(es, 'door'), goalFloor = floorOf(es, goal);
    const goalDoors = doors.filter(d => d.kind === 'door' && touches(d, goalFloor) && floors.filter(f => touches(d, f)).length >= 2);
    expect(goalDoors.length).toBeGreaterThan(0);
    expect(goalDoors.every(d => d.locked)).toBe(true);
    const seen = new Set([floorOf(es, areaPlace(es, 1))]);
    for (let grew = true; grew;) {
      grew = false;
      for (const d of doors) if (!d.locked) {
        const fs = floors.filter(f => touches(d, f));
        if (fs.some(f => seen.has(f)) && fs.some(f => !seen.has(f))) { fs.forEach(f => seen.add(f)); grew = true; }
      }
    }
    expect(seen.has(floorOf(es, key))).toBe(true);
    expect(seen.has(goalFloor)).toBe(false);

    // Stocking reads like a keyed dungeon, not a pattern.
    expect(areaPlace(es, 1).stockingRole).not.toBe('Trap');
    expect(places.some(p => p.stockingRole === 'Trap')).toBe(true);
    expect(places.some(p => p.stockingRole === 'Empty')).toBe(true);
    expect(new Set(places.map(p => p.notes)).size).toBe(places.length);
    expect(of(es, 'label').filter(l => /^\d+$/.test(l.text)).map(l => Number(l.text)).sort((a, b) => a - b)).toEqual(places.map((_, i) => i + 1));
    expect(of(es, 'place').some(p => p.id === 'place-dungeon')).toBe(true);
  });

  it('numbers rooms from the entrance outward', () => {
    for (const seed of [3, 42]) {
      const plan = planDungeon(input(seed), dungeonLayout(input(seed)));
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
    const goal = of(es, 'place').find(p => p.gmNotes.includes('Boss:'))!;
    expect(goal.gmNotes).toContain('a lich-cursed vault that wakes at dusk');
    expect(goal.gmNotes).toContain('a relic of the old kingdom');
    expect(goal.name).toContain('Burial Vault');
  });

  it('draws a dungeon site on rock and a woodland site on grass', () => {
    const site = (type: string) => ({ kind: 'site' as const, generators: { a: { type } } as unknown as MapDoc['generators'] });
    expect(mapBackdropStyle(site('dungeon')).texKind).toBe('parchment');
    expect(mapBackdropStyle(site('glade')).texKind).toBe('grass');
  });
});
