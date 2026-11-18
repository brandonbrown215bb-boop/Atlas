import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import type { Entity, Point } from '../../model/schema';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { BAND_NAMES, makeHooks, SITE_SUMMARY, type Band, type DungeonTheme, type SiteKind, type StockingRole } from '../world/hooks';
import { makeNamer } from '../world/names';
import type { ROOM_PURPOSES } from './dressing';
import type { DungeonParams } from './layout';

type Area = Extract<Entity, { type: 'area' }>;
type Door = Extract<Entity, { type: 'door' }>;
type Place = Extract<Entity, { type: 'place' }>;
type Purpose = Exclude<typeof ROOM_PURPOSES[number], 'random'>;

export const PURPOSE_TITLE: Record<string, string> = {
  tavern: 'Taproom', storage: 'Pantry', bedroom: 'Guest Room', shrine: 'Shrine', guardroom: 'Guardroom',
  crypt: 'Ossuary', cistern: 'Cistern', prison: 'Cells', alchemy: 'Laboratory', treasury: 'Vault',
};
// Depth tiers run shallow, middle, deep; the goal sits at the bottom of the complex.
const THEMES: Record<DungeonTheme, { kind: SiteKind; tiers: [Purpose[], Purpose[], Purpose[]]; goal: Purpose; goalTitle: string }> = {
  tomb: { kind: 'ruin', tiers: [['guardroom', 'storage', 'shrine'], ['crypt', 'shrine', 'cistern', 'storage'], ['crypt', 'treasury']], goal: 'crypt', goalTitle: 'Burial Vault' },
  den: { kind: 'lair', tiers: [['storage', 'guardroom'], ['prison', 'cistern', 'storage', 'alchemy'], ['treasury', 'prison']], goal: 'treasury', goalTitle: 'Hoard Den' },
  fortress: { kind: 'stronghold', tiers: [['guardroom', 'storage'], ['prison', 'guardroom', 'alchemy', 'cistern'], ['treasury', 'prison']], goal: 'treasury', goalTitle: 'Strongroom' },
  temple: { kind: 'sacred', tiers: [['guardroom', 'shrine'], ['shrine', 'alchemy', 'cistern', 'storage'], ['crypt', 'shrine']], goal: 'shrine', goalTitle: 'Inner Sanctum' },
};
const CATEGORY: Record<SiteKind, string> = { ruin: 'Ruin', lair: 'Lair', stronghold: 'Stronghold', sacred: 'Sacred Site', travel: 'Travel Stop' };
const THREE_CLUES = 'Three-Clue Rule: (1) Scraped boot prints end at bare stone; (2) Draft bends torchlight along the seam; (3) Loose sconce releases secret latch.';

export interface DungeonPlan {
  theme: DungeonTheme; kind: SiteKind; band: Band; name: string; inherited?: Place;
  /** Rooms in key order: rooms[0] is Area 1, the entrance; numbers rise going deeper. */
  rooms: Area[];
  depth: Map<string, number>;
  doorRooms: Map<Door, Area[]>;
  goalId?: string; keyRoomId?: string; stairsRoomId?: string;
}

const center = (a: Area): Point => { const b = getEntityBounds(a)!; return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; };
const boxArea = (a: Area) => { const b = getEntityBounds(a)!; return (b.maxX - b.minX) * (b.maxY - b.minY); };

/** Reads the room graph, picks a theme and goal, locks the goal and hides its key. Sets roomPurpose and door.locked on the layout. */
export function planDungeon(input: GeneratorInput<DungeonParams>, layout: Entity[]): DungeonPlan {
  const g = input.grid, random = mulberry32((input.seed ^ 0x7d3a91c5) >>> 0);
  const floors = layout.filter((e): e is Area => e.type === 'area' && e.role === 'floor');
  const rooms = floors.filter(f => f.name !== 'Corridor');
  const doors = layout.filter((e): e is Door => e.type === 'door');
  const touching = (d: Door, f: Area) => {
    const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
    return f.rings.some(r => r.some((a, i) => distanceToSegment(mid, a, r[(i + 1) % r.length]!) < g * 0.16));
  };
  const doorFloors = new Map(doors.map(d => [d, floors.filter(f => touching(d, f))]));
  const doorRooms = new Map(doors.map(d => [d, doorFloors.get(d)!.filter(f => f.name !== 'Corridor')]));

  // A crypt is a tomb whatever its category; otherwise ruins and lairs win over keeps and temples when a sheet holds several.
  const kindOf = (p: Place): SiteKind | undefined => /ruin/i.test(p.category) || /crypt|barrow|tomb/i.test(p.notes) ? 'ruin'
    : /lair/i.test(p.category) ? 'lair' : /stronghold/i.test(p.category) ? 'stronghold' : /sacred/i.test(p.category) ? 'sacred' : undefined;
  const rank: SiteKind[] = ['ruin', 'lair', 'stronghold', 'sacred'];
  const inherited = input.constraints.filter((e): e is Place => e.type === 'place' && e.origin === 'inherited' && !!kindOf(e))
    .sort((a, b) => rank.indexOf(kindOf(a)!) - rank.indexOf(kindOf(b)!))[0];
  const roll = rank[Math.floor(random() * 4)]!;
  const kind: SiteKind = inherited ? kindOf(inherited)! : input.params.mode === 'cave' ? 'lair' : roll;
  const theme = (Object.keys(THEMES) as DungeonTheme[]).find(t => THEMES[t].kind === kind)!;
  const text = `${inherited?.notes ?? ''} ${inherited?.gmNotes ?? ''}`;
  const band = BAND_NAMES.findIndex(n => text.includes(n.split(' (')[0]!));
  const name = inherited?.name ?? makeNamer(input.seed, input.takenNames ?? []).site(kind);
  const plan: DungeonPlan = { theme, kind, band: (band < 0 ? 1 : band) as Band, name, inherited, rooms, depth: new Map(), doorRooms };
  if (input.params.mode !== 'dungeon' || !rooms.length) return plan;

  // 0-1 search from the entrance: corridors are free, each room entered is one step deeper.
  const walk = (from: Area, blocked: (d: Door) => boolean) => {
    const dist = new Map<Area, number>([[from, 0]]), order: Area[] = [];
    const deque: Area[] = [from];
    while (deque.length) {
      const f = deque.shift()!;
      if (order.includes(f)) continue;
      order.push(f);
      for (const [d, fs] of doorFloors) {
        if (blocked(d) || !fs.includes(f)) continue;
        for (const n of fs) {
          const nd = dist.get(f)! + (n.name === 'Corridor' ? 0 : 1);
          if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); if (n.name === 'Corridor') deque.unshift(n); else deque.push(n); }
        }
      }
    }
    return { dist, order: order.filter(f => f.name !== 'Corridor') };
  };
  const entrance = rooms.find(r => r.name === 'Room 1') ?? rooms[0]!;
  const { dist, order } = walk(entrance, () => false);
  plan.rooms = [...order, ...rooms.filter(r => !order.includes(r))];
  for (const r of plan.rooms) plan.depth.set(r.id, dist.get(r) ?? 0);
  const maxDepth = Math.max(...plan.depth.values());

  const t = THEMES[theme];
  if (rooms.length >= 4) {
    const goal = plan.rooms.filter(r => r !== entrance && plan.depth.get(r.id)! >= maxDepth - 1).sort((a, b) => boxArea(b) - boxArea(a))[0];
    if (goal) {
      plan.goalId = goal.id;
      const locks = doors.filter(d => d.kind !== 'secret' && doorFloors.get(d)!.length >= 2 && doorFloors.get(d)!.includes(goal));
      const reach = walk(entrance, d => locks.includes(d)).order;
      const deadEnd = (r: Area) => doors.filter(d => doorFloors.get(d)!.includes(r)).length === 1 ? 1 : 0;
      const keyRoom = reach.filter(r => r !== entrance && r !== goal).sort((a, b) => deadEnd(b) - deadEnd(a) || plan.depth.get(b.id)! - plan.depth.get(a.id)!)[0];
      if (keyRoom && locks.length) { plan.keyRoomId = keyRoom.id; for (const d of locks) d.locked = true; }
    }
    plan.stairsRoomId = plan.rooms.filter(r => r !== entrance && r.id !== plan.goalId).sort((a, b) => plan.depth.get(b.id)! - plan.depth.get(a.id)!)[0]?.id;
  }
  if (input.params.purpose === 'random') {
    const bags = t.tiers.map(tier => { const bag = [...tier]; for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; } return bag; });
    const used = [0, 0, 0];
    for (const r of plan.rooms) {
      if (input.params.roomPurposes[r.name ?? '']) continue;
      const tier = r === entrance ? 0 : Math.min(2, Math.floor((plan.depth.get(r.id)! / Math.max(1, maxDepth)) * 2.99));
      r.roomPurpose = r.id === plan.goalId ? t.goal : r === entrance ? t.tiers[0][0]! : bags[tier]![used[tier]!++ % bags[tier]!.length]!;
    }
  }
  return plan;
}

/** Keys and stocks every room, lights the lived-in ones, marks traps and names the whole place. */
export function stockDungeon(input: GeneratorInput<DungeonParams>, plan: DungeonPlan, labelAt: (room: Area) => Point = center): Entity[] {
  const g = input.grid, random = mulberry32((input.seed ^ 0x1c6e8b27) >>> 0), hooks = makeHooks(random);
  const base = { layerId: 'generated', origin: 'generated' as const, rev: 0 };
  const out: Entity[] = [];
  const t = THEMES[plan.theme];
  const floors = plan.rooms;
  if (!floors.length) return out;

  // The whole dungeon: its name over the complex, and one Place unless the world already has one.
  const boxes = floors.map(f => getEntityBounds(f)!);
  const minX = Math.min(...boxes.map(b => b.minX)), maxX = Math.max(...boxes.map(b => b.maxX));
  const minY = Math.min(...boxes.map(b => b.minY)), maxY = Math.max(...boxes.map(b => b.maxY));
  // The title goes above or below the complex, whichever side has more open rock.
  const sheet = getEntityBounds({ ...floors[0]!, rings: input.region })!;
  const title = [{ x: (minX + maxX) / 2, y: minY - g * 2 }, { x: (minX + maxX) / 2, y: maxY + g * 2 }]
    .filter(p => pointInPolygon(p, input.region)).sort((a, b) => Math.min(b.y - sheet.minY, sheet.maxY - b.y) - Math.min(a.y - sheet.minY, sheet.maxY - a.y))[0]
    ?? { x: (minX + maxX) / 2, y: minY + g };
  out.push({ ...base, id: 'dungeon-title', type: 'label', text: plan.name, x: title.x, y: title.y, size: 26 });
  const goalIndex = floors.findIndex(f => f.id === plan.goalId), keyIndex = floors.findIndex(f => f.id === plan.keyRoomId);
  const keyName = plan.keyRoomId ? hooks.key() : undefined;
  if (!plan.inherited) {
    const site = hooks.site(plan.kind, plan.band);
    const lock = keyName ? `, behind doors that open to ${keyName} kept in Area ${keyIndex + 1}` : '';
    out.push({ ...base, id: 'place-dungeon', type: 'place', name: plan.name, category: CATEGORY[plan.kind],
      notes: `${SITE_SUMMARY[plan.kind]} ${floors.length} areas.${goalIndex >= 0 ? ` The ${t.goalTitle} (Area ${goalIndex + 1}) lies deepest${lock}.` : ''}`,
      gmNotes: site.gmNotes, stockingRole: site.stockingRole, entityIds: ['dungeon-title'] });
  }
  if (input.params.mode !== 'dungeon') return out;

  // Moldvay-style stocking: about a third empty, a third monsters, the rest traps and specials; shuffled.
  const others = floors.length - 1 - (goalIndex > 0 ? 1 : 0);
  const traps = others >= 4 ? Math.max(1, Math.round(others / 6)) : 0, specials = others >= 3 ? Math.max(1, Math.round(others / 6)) : 0;
  const empties = Math.round(others / 3);
  const bag: StockingRole[] = [...Array(empties).fill('Empty'), ...Array(traps).fill('Trap'), ...Array(specials).fill('Special')];
  while (bag.length < others) bag.push('Monster');
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; }

  const boss = plan.inherited?.gmNotes.match(/Occupants: ([^.]+)\./)?.[1];
  const reward = plan.inherited?.gmNotes.match(/Reward: ([^.]+)\./)?.[1];
  const deeper = Math.min(2, plan.band + 1) as Band;
  const secretDoors = [...plan.doorRooms].filter(([d]) => d.kind === 'secret');
  for (const [i, room] of floors.entries()) {
    const n = i + 1, isGoal = i === goalIndex, isKey = room.id === plan.keyRoomId;
    const role: StockingRole = isGoal ? 'Monster' : i === 0 ? (random() < 0.5 ? 'Empty' : 'Monster') : bag.pop()!;
    const purpose = room.roomPurpose ?? 'storage';
    const title = isGoal ? t.goalTitle : PURPOSE_TITLE[purpose] ?? 'Chamber';
    const notes = [`${title}.`, hooks.sense(), `${hooks.feature(purpose)}.`];
    if (isGoal && keyName) notes.push('The doors are locked.');
    if (room.id === plan.stairsRoomId) notes.push('Worn stairs lead further down.');
    const gm: string[] = [];
    if (role === 'Monster') gm.push(isGoal ? `Boss: ${boss ?? hooks.monster(plan.theme, deeper)}.` : `Monster: ${hooks.monster(plan.theme, plan.band)}.`);
    if (role === 'Trap') gm.push(`Trap: ${hooks.trap()}.`);
    if (role === 'Special') gm.push(`Special: ${hooks.special()}.`);
    if (role === 'Empty') gm.push(`Empty: ${hooks.empty()}.`);
    if (isGoal) gm.push(`Treasure: ${reward ?? hooks.treasure(deeper)}.`);
    else if ((role === 'Monster' && random() < 0.5) || (role === 'Empty' && random() < 0.2)) gm.push(`Treasure: ${hooks.treasure(plan.band)}.`);
    if (isGoal && keyName) gm.push(`Locked: ${keyName} opens it; it is in Area ${keyIndex + 1}.`);
    if (isKey && keyName) gm.push(`Key: ${keyName}, which opens the ${t.goalTitle} (Area ${goalIndex + 1}).`);
    if (secretDoors.some(([, rs]) => rs.includes(room))) gm.push(THREE_CLUES);
    out.push({ ...base, id: `place-area-${n}`, type: 'place', name: `Area ${n}: ${title}`, category: role.toLowerCase(), stockingRole: role,
      notes: notes.join(' '), gmNotes: gm.join(' '), entityIds: [room.id],
      ...(isKey && keyName ? { clueNext: `${keyName[0]!.toUpperCase()}${keyName.slice(1)} opens the locked ${t.goalTitle} (Area ${goalIndex + 1}).` } : {}) });
    const at = labelAt(room);
    out.push({ ...base, id: `room-label-${n}`, type: 'label', text: String(n), x: at.x, y: at.y, size: 17 });

    // Lit rooms are where someone lives or worships; corridors and the rest stay dark.
    const c = center(room), b = getEntityBounds(room)!;
    if ((i === 0 || isGoal || purpose === 'guardroom' || purpose === 'shrine') && pointInPolygon(c, room.rings)) {
      out.push({ ...base, id: `light-${n}`, type: 'light', x: c.x, y: c.y, color: purpose === 'shrine' ? '#c9b6ff' : '#ffb35c',
        radius: Math.min(g * 6, Math.max(g * 2, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.6)) });
    }
    // A GM-only plate just inside the first door, so the trap is where the party steps.
    if (role === 'Trap') {
      const door = [...plan.doorRooms].find(([, rs]) => rs.includes(room))?.[0];
      if (door) {
        const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 }, len = Math.hypot(c.x - mid.x, c.y - mid.y) || 1;
        const spot = { x: mid.x + (c.x - mid.x) / len * g * 1.2, y: mid.y + (c.y - mid.y) / len * g * 1.2 };
        if (pointInPolygon(spot, room.rings)) out.push({ ...base, id: `trap-${n}`, type: 'prop', name: 'Trap', gmOnly: true, builtin: 'manhole', tacticalTag: 'hazard',
          x: spot.x, y: spot.y, w: g * 0.8, h: g * 0.8, scale: 1, rotation: 0, flipX: false });
      }
    }
  }
  return out;
}
