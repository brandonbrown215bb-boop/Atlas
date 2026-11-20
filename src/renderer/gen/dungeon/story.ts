import { rectRing } from '../../geom/fog';
import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { FOOT } from '../../model/mapDefaults';
import type { Entity, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { BAND_NAMES, makeHooks, SITE_SUMMARY, type Band, type DungeonTheme, type SiteKind, type StockingRole } from '../world/hooks';
import { makeNamer } from '../world/names';
import type { ROOM_PURPOSES } from './dressing';
import type { DungeonParams } from './layout';
import { inheritedDungeonSite, type DungeonSituation, type SituationRoom } from './situations';

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
const SECRET_CLUE_SETS = [
  'Secret Clues: (1) Scraped boot prints end at bare stone; (2) Cold draft bends torchlight along the seam; (3) Loose iron sconce releases the latch.',
  'Secret Clues: (1) Mortar dust sits fresh below one narrow joint; (2) Tapping the wall sounds hollow behind the relief; (3) Carved eye depresses inward.',
  'Secret Clues: (1) Rust streaks drip from a concealed hinge pin; (2) Cobwebs stay unbroken everywhere except one lintel; (3) Weight on a cracked flagstone slides the slab.',
  'Secret Clues: (1) Smudged chalk marks point toward a blank alcove; (2) Faint smell of lantern oil seeps through hairline cracks; (3) Twisting the brazier bowl unlocks the jamb.',
  'Secret Clues: (1) Grooves arc across the dust from a swinging panel; (2) Sound carries clearly through one thin section of masonry; (3) Hidden catch sits under the shelf lip.',
  'Secret Clues: (1) One stone block lacks the soot coating its neighbors; (2) Rats dart straight into a hairline crack; (3) Pulling the rusted chain loop trips the bolt.',
];
const base = { layerId: 'generated', origin: 'generated' as const, rev: 0 };

export interface DungeonPlan {
  theme: DungeonTheme; kind: SiteKind; band: Band; name: string; inherited?: Place;
  /** Rooms in key order: rooms[0] is Area 1, the entrance; numbers rise going deeper. */
  rooms: Area[];
  depth: Map<string, number>;
  doorRooms: Map<Door, Area[]>;
  goalId?: string; keyRoomId?: string; stairsRoomId?: string;
  valveDoor?: Door; valveDeepId?: string; valveShallowId?: string;
  situation?: DungeonSituation;
  situationRooms?: Area[];
}

const center = (a: Area): Point => { const b = getEntityBounds(a)!; return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; };
const boxArea = (a: Area) => { const b = getEntityBounds(a)!; return (b.maxX - b.minX) * (b.maxY - b.minY); };

/** Read the actual doors and room geometry before writing the key. */
export function planDungeon(input: GeneratorInput<DungeonParams>, layout: Entity[], situation?: DungeonSituation): DungeonPlan {
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

  const inheritedSite = inheritedDungeonSite(input.constraints);
  const inherited = inheritedSite?.place;
  const rank: SiteKind[] = ['ruin', 'lair', 'stronghold', 'sacred'];
  const roll = rank[Math.floor(random() * 4)]!;
  const kind = inheritedSite?.kind ?? situation?.kind ?? (input.params.mode === 'cave' ? 'lair' : roll);
  const theme = (Object.keys(THEMES) as DungeonTheme[]).find(t => THEMES[t].kind === kind)!;
  const text = `${inherited?.notes ?? ''} ${inherited?.gmNotes ?? ''}`;
  const band = BAND_NAMES.findIndex(n => text.includes(n.split(' (')[0]!));
  const namer = makeNamer(input.seed, input.takenNames ?? []);
  const name = inherited?.name ?? namer.site(situation?.kind === 'lair' ? 'waterworks' : kind);
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
  if (situation) {
    const primaryRooms = situation.rooms.map((_, i) => rooms.find(r => r.name === `Room ${i + 1}`)!);
    plan.situation = situation;
    plan.situationRooms = primaryRooms;
    plan.goalId = primaryRooms[situation.rewardRoom]!.id;
    for (const [i, room] of primaryRooms.entries()) room.roomPurpose = situation.rooms[i]!.purpose;
    if (situation.lockedRoom !== undefined) {
      const locked = primaryRooms[situation.lockedRoom]!;
      const grilles = doors.filter(d => doorFloors.get(d)!.length >= 2 && doorRooms.get(d)!.includes(locked));
      for (const door of grilles) {
        door.name = 'Iron Grille';
        door.material = 'iron';
        door.locked = true;
      }
      // The full corridor opening is one grille, so opening it in the editor opens the passage.
      const [grille, ...jambs] = grilles;
      if (grille && jambs.length) {
        const axis = Math.abs(grille.a.x - grille.b.x) > g * .5 ? 'x' : 'y', crossAxis = axis === 'x' ? 'y' : 'x';
        const points = grilles.flatMap(d => [d.a, d.b]).sort((a, b) => a[axis] - b[axis]);
        const first = points[0]!, last = points[points.length - 1]!;
        const span = grilles.reduce((sum, d) => sum + Math.abs(d.a[axis] - d.b[axis]), 0);
        if (points.every(p => Math.abs(p[crossAxis] - first[crossAxis]) < g * .001) && Math.abs(last[axis] - first[axis] - span) < g * .001) {
          grille.a = first;
          grille.b = last;
          for (const jamb of jambs) {
            layout.splice(layout.indexOf(jamb), 1);
            doorRooms.delete(jamb);
          }
        }
      }
    }
    const suitable = plan.rooms.filter(r => r !== entrance && !situation.rooms[primaryRooms.indexOf(r)]?.landmark);
    plan.stairsRoomId = suitable.sort((a, b) => Number(primaryRooms.includes(a)) - Number(primaryRooms.includes(b))
      || plan.depth.get(b.id)! - plan.depth.get(a.id)!)[0]?.id;
  } else if (rooms.length >= 4) {
    // Show Lock BEFORE Key (Level Design Book / Unexplored): prefer locking a shallow-to-mid vault chamber
    // (depth 1..ceil(maxDepth*0.65)) that players encounter early, with its key deeper on another loop branch.
    // Fall back to the deepest large room if no clean early side-vault exists.
    const lockableGoal = (cand: Area) => {
      const locks = doors.filter(d => d.kind !== 'secret' && doorFloors.get(d)!.length >= 2 && doorFloors.get(d)!.includes(cand));
      if (!locks.length) return null;
      const reach = walk(entrance, d => locks.includes(d)).order;
      if (reach.includes(cand)) return null; // reachable via secret or another unlocked route -> not locked
      const openOthers = reach.filter(r => r !== entrance && r !== cand);
      if (openOthers.length < Math.max(2, Math.floor((rooms.length - 1) * 0.5))) return null;
      return { cand, locks, reach: openOthers };
    };
    const earlyVaultCandidates = plan.rooms
      .filter(r => r !== entrance && plan.depth.get(r.id)! >= 1 && plan.depth.get(r.id)! <= Math.max(2, Math.floor(maxDepth * 0.65)))
      .sort((a, b) => plan.depth.get(a.id)! - plan.depth.get(b.id)! || boxArea(b) - boxArea(a));
    const deepGoalCandidates = plan.rooms
      .filter(r => r !== entrance && plan.depth.get(r.id)! >= maxDepth - 1)
      .sort((a, b) => boxArea(b) - boxArea(a));
    const chosenLock =
      earlyVaultCandidates.map(lockableGoal).find(Boolean)
      ?? deepGoalCandidates.map(lockableGoal).find(Boolean);
    const goal = chosenLock?.cand ?? deepGoalCandidates[0];
    if (goal) {
      plan.goalId = goal.id;
      if (chosenLock) {
        const lockDepth = plan.depth.get(goal.id)!;
        const deadEnd = (r: Area) => doors.filter(d => doorFloors.get(d)!.includes(r)).length === 1 ? 1 : 0;
        // Prefer a key room deeper than or at least as deep as the locked vault so players see the lock first!
        const keyRoom = chosenLock.reach.sort((a, b) =>
          Number(plan.depth.get(b.id)! >= lockDepth) - Number(plan.depth.get(a.id)! >= lockDepth)
          || plan.depth.get(b.id)! - plan.depth.get(a.id)!
          || deadEnd(b) - deadEnd(a),
        )[0];
        if (keyRoom) {
          plan.keyRoomId = keyRoom.id;
          for (const d of chosenLock.locks) {
            d.locked = true;
            d.lockTag = `Vault-${goal.id}`;
          }
        }
      }
    }
    // One-Way Valve ("Door-to-Before" shortcut): tag 1 unlocked redundant loop door linking a deep wing back toward
    // an earlier room or loop corridor so finishing the deep arc lets the party unbar a fast return without backtracking.
    const lockedSet = new Set(doors.filter(d => d.locked));
    const baseReachCount = walk(entrance, d => lockedSet.has(d) || d.kind === 'secret').order.length;
    const corridorShallowRoom = (corr: Area, exclude: Area): Area | undefined => {
      const touched: Area[] = [];
      for (const cd of doors) {
        if (cd.locked || cd.kind === 'secret') continue;
        const cfs = doorFloors.get(cd)!;
        if (!cfs.includes(corr)) continue;
        for (const f of cfs) if (f !== corr && f !== exclude && f.name !== 'Corridor') touched.push(f);
      }
      return touched.sort((a, b) => (plan.depth.get(a.id) ?? 99) - (plan.depth.get(b.id) ?? 99))[0];
    };
    for (const d of doors) {
      if (d.locked || d.kind === 'secret') continue;
      const fs = doorFloors.get(d)!;
      if (fs.length < 2) continue;
      const nonCorridors = fs.filter(f => f.name !== 'Corridor');
      let deepRoom: Area | undefined;
      let shallowRoom: Area | undefined;
      let exitFloor: Area | undefined;
      if (nonCorridors.length >= 2) {
        const a = nonCorridors[0]!, b = nonCorridors[1]!;
        const da = plan.depth.get(a.id) ?? 0, db = plan.depth.get(b.id) ?? 0;
        if (Math.abs(da - db) < 1 || Math.max(da, db) < Math.max(2, maxDepth - 1)) continue;
        deepRoom = da >= db ? a : b;
        shallowRoom = da >= db ? b : a;
        exitFloor = shallowRoom;
      } else if (nonCorridors.length === 1) {
        const room = nonCorridors[0]!;
        const corr = fs.find(f => f !== room)!;
        const dr = plan.depth.get(room.id) ?? 0;
        const target = corridorShallowRoom(corr, room);
        if (!target || dr < 2 || (plan.depth.get(target.id) ?? 99) >= dr) continue;
        deepRoom = room;
        shallowRoom = target;
        exitFloor = corr;
      } else {
        continue;
      }
      const withoutValve = walk(entrance, x => x === d || lockedSet.has(x) || x.kind === 'secret').order.length;
      if (withoutValve < baseReachCount) continue;
      const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
      const nx = -(d.b.y - d.a.y), ny = d.b.x - d.a.x;
      const sc = center(exitFloor);
      d.oneWay = ((sc.x - mid.x) * nx + (sc.y - mid.y) * ny) >= 0 ? 'ab' : 'ba';
      plan.valveDoor = d;
      plan.valveDeepId = deepRoom.id;
      plan.valveShallowId = shallowRoom.id;
      break;
    }
    plan.stairsRoomId = plan.rooms.filter(r => r !== entrance && r.id !== plan.goalId).sort((a, b) => plan.depth.get(b.id)! - plan.depth.get(a.id)!)[0]?.id;
  }
  if (input.params.purpose === 'random') {
    const bags = t.tiers.map(tier => { const bag = [...tier]; for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; } return bag; });
    const used = [0, 0, 0];
    for (const r of plan.rooms) {
      if (r.roomPurpose || input.params.roomPurposes[r.name ?? '']) continue;
      const tier = r === entrance ? 0 : Math.min(2, Math.floor((plan.depth.get(r.id)! / Math.max(1, maxDepth)) * 2.99));
      r.roomPurpose = r.id === plan.goalId ? t.goal : r === entrance ? t.tiers[0][0]! : bags[tier]![used[tier]!++ % bags[tier]!.length]!;
    }
  }
  return plan;
}

/** Draw the objects that make the prepared situation legible and give dressing a footprint to avoid. */
export function situationLandmarks(input: GeneratorInput<DungeonParams>, plan: DungeonPlan): Entity[] {
  if (!plan.situation || !plan.situationRooms) return [];
  const random = mulberry32((input.seed ^ 0x2658af93) >>> 0);
  const features: Entity[] = [];
  for (const [index, room] of plan.situationRooms.entries()) {
    const spec = plan.situation.rooms[index]!;
    if (!spec.landmark && !spec.basin) continue;
    const b = getEntityBounds(room)!;
    const at = center(room);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const basinWidth = w * .6;
    if (spec.basin) features.push({
      ...base, id: `situation-basin-${index}`, type: 'area', role: 'water', name: 'Flooded Basin', fill: '#3b8291',
      rings: [rectRing({ x: at.x - basinWidth / 2, y: at.y - h * .32, w: basinWidth, h: h * .64 })],
    });
    const landmark = spec.landmark;
    if (landmark) {
      const assets = themeAssets(input.theme, landmark.role);
      const asset = assets[Math.floor(random() * assets.length)]!;
      const builtin = asset.startsWith('builtin:');
      const depth = landmark.depthFt * FOOT;
      let width: number, height: number;
      if (landmark.widthFt === 'basin span') {
        width = Math.min(basinWidth + 4 * FOOT, w * .8);
        height = Math.min(depth, h * .45);
      } else {
        const nominalWidth = landmark.widthFt * FOOT;
        const fit = Math.min(1, w * .6 / nominalWidth, h * .45 / depth);
        width = nominalWidth * fit;
        height = depth * fit;
      }
      features.push({
        ...base, id: `situation-${landmark.id}`, type: 'prop', name: landmark.name,
        builtin: builtin ? asset.slice('builtin:'.length) : landmark.role,
        ...(builtin ? {} : { assetId: asset }),
        x: at.x, y: landmark.offsetY ? at.y + h * landmark.offsetY : at.y,
        w: width, h: height,
        scale: 1, rotation: 0, flipX: false, tacticalTag: 'feature',
      });
    }
  }
  return features;
}

/** Keys and stocks rooms, lights the lived-in ones, marks traps and names the whole place. */
export function stockDungeon(input: GeneratorInput<DungeonParams>, plan: DungeonPlan, features: Entity[], labelAt: (room: Area) => Point = center): Entity[] {
  const g = input.grid, random = mulberry32((input.seed ^ 0x1c6e8b27) >>> 0), hooks = makeHooks(random);
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
  const situation = plan.situation;
  const factions = hooks.dungeonFactions(plan.theme);
  const maxDepth = Math.max(1, ...plan.depth.values());
  const factionSplitDepth = Math.max(1, Math.ceil(maxDepth / 2));
  if (!plan.inherited) {
    const site = hooks.site(plan.kind, plan.band);
    const lock = keyName ? `, behind doors opened by ${keyName} kept in Area ${keyIndex + 1}` : '';
    const factionSummary = ` Factions: ${factions.entryFaction} (upper wing) vs. ${factions.deepFaction} (deep wing) — ${factions.tension} Aftermath: ${factions.aftermath}`;
    out.push({ ...base, id: 'place-dungeon', type: 'place', name: plan.name, category: CATEGORY[plan.kind],
      notes: situation ? `${situation.premise} ${floors.length} areas.`
        : `${SITE_SUMMARY[plan.kind]} ${floors.length} areas.${goalIndex >= 0 ? ` The ${t.goalTitle} (Area ${goalIndex + 1}) is sealed${lock}.` : ''}`,
      gmNotes: `${situation?.summary ?? site.gmNotes}${factionSummary}`,
      stockingRole: situation ? 'Special' : site.stockingRole,
      factionLinks: [factions.entryFaction, factions.deepFaction],
      discoveryTier: 'landmark',
      siteStatus: 'active',
      entityIds: ['dungeon-title'] });
  }
  if (input.params.mode !== 'dungeon') return out;

  // Moldvay-style stocking: about a third empty, a third monsters, the rest traps and specials; shuffled.
  const others = situation ? floors.length - situation.rooms.length : floors.length - 1 - (goalIndex > 0 ? 1 : 0);
  const traps = others >= 4 ? Math.max(1, Math.round(others / 6)) : 0, specials = others >= 3 ? Math.max(1, Math.round(others / 6)) : 0;
  const empties = Math.round(others / 3);
  const bag: StockingRole[] = [...Array(empties).fill('Empty'), ...Array(traps).fill('Trap'), ...Array(specials).fill('Special')];
  while (bag.length < others) bag.push('Monster');
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; }

  const occupant = plan.inherited?.gmNotes.match(/Occupants: ([^.]+)\./)?.[1];
  const reward = plan.inherited?.gmNotes.match(/Reward: ([^.]+)\./)?.[1];
  const deeper = Math.min(2, plan.band + 1) as Band;
  const secretDoors = [...plan.doorRooms].filter(([d]) => d.kind === 'secret');
  const situationRooms = plan.situationRooms ?? [];
  const stairsPresent = features.some(e => e.id === 'stairs-main');
  const keyedRoom = (anchor: SituationRoom['lead']) => {
    if (!anchor) return undefined;
    const room = situationRooms[anchor.room]!;
    return `${anchor.text} (Area ${floors.indexOf(room) + 1}.)`;
  };
  const roomShortCue = new Map<string, string>();
  const shortCueFor = (purpose: string, role: StockingRole, title: string): string => {
    if (role === 'Trap') return 'hairline seam';
    if (purpose === 'cistern') return 'damp air';
    if (purpose === 'crypt') return 'dry bone chill';
    if (purpose === 'alchemy') return 'acrid fumes';
    if (purpose === 'guardroom') return 'low voices';
    if (purpose === 'shrine') return 'wax & incense';
    if (purpose === 'prison') return 'rattling iron';
    if (role === 'Monster') return 'scraping steps';
    return title.toLowerCase();
  };
  let secretIdx = 0;
  for (const [i, room] of floors.entries()) {
    const n = i + 1, isGoal = i === goalIndex, isKey = room.id === plan.keyRoomId;
    const designed = situation?.rooms[situationRooms.indexOf(room)];
    const role: StockingRole = designed?.role ?? (isGoal ? 'Monster' : i === 0 ? (random() < 0.5 ? 'Empty' : 'Monster') : bag.pop()!);
    const purpose = room.roomPurpose ?? 'storage';
    const purposeTitle = PURPOSE_TITLE[purpose] ?? 'Chamber';
    const title = designed?.title ?? (situation ? `${purposeTitle} Annex` : isGoal ? t.goalTitle : purposeTitle);
    const dDepth = plan.depth.get(room.id) ?? 0;
    const roomFaction = dDepth < factionSplitDepth ? factions.entryFaction : factions.deepFaction;
    roomShortCue.set(room.id, shortCueFor(purpose, role, title));

    const roomFeatures = features.filter(e => e.type === 'prop' ? pointInPolygon(e, room.rings) : e.type === 'area' && e.role === 'water' && pointInPolygon(center(e), room.rings));
    const description = purpose === 'cistern'
      ? (roomFeatures.some(e => e.type === 'area') ? 'A sunken basin holds standing water.' : 'Mineral stains mark the stone above a dry drain.')
      : `${hooks.feature(purpose)}.`;
    const notes = designed ? [designed.notes] : [`Landmark: ${title} — ${description}`, hooks.sense()];
    if (isGoal && keyName) notes.push('The heavy door is locked from outside.');
    if (stairsPresent && room.id === plan.stairsRoomId) notes.push('Worn stairs descend deeper.');
    const gm: string[] = [];
    if (designed) {
      if (designed.gmNotes) gm.push(designed.gmNotes);
      if (role === 'Monster' && occupant) gm.push(`Inhabitant from the parent site: ${occupant}.`);
    } else {
      if (role === 'Monster') gm.push(isGoal ? `Boss (${roomFaction}): ${occupant ?? hooks.monster(plan.theme, deeper)}.` : `Monster (${roomFaction}): ${hooks.monster(plan.theme, plan.band)}.`);
      if (role === 'Trap') gm.push(`Hidden Trap: ${hooks.trap()}.`);
      if (role === 'Special') gm.push(`Hidden Special: ${hooks.special()}.`);
      if (role === 'Empty') gm.push(`Hidden Detail: ${hooks.empty()}.`);
    }
    if (isGoal) gm.push(`Treasure: ${reward ?? hooks.treasure(deeper)}.`);
    else if ((role === 'Monster' && random() < 0.5) || (role === 'Empty' && random() < 0.2)) gm.push(`Hidden Treasure: ${hooks.treasure(plan.band)}.`);
    if (isGoal && keyName) gm.push(`Locked: ${keyName} opens it (found in Area ${keyIndex + 1}).`);
    if (isKey && keyName) gm.push(`Key: ${keyName} — opens the locked ${t.goalTitle} (Area ${goalIndex + 1}).`);
    if (plan.valveDeepId === room.id && plan.valveShallowId) {
      const targetNum = floors.findIndex(f => f.id === plan.valveShallowId) + 1;
      gm.push(`One-Way Valve Shortcut: Barred from this side; unbarring opens a fast return directly to Area ${targetNum}.`);
    }
    if (secretDoors.some(([, rs]) => rs.includes(room))) {
      gm.push(SECRET_CLUE_SETS[(input.seed + secretIdx++) % SECRET_CLUE_SETS.length]!);
    }
    const clueNext = designed ? keyedRoom(designed.lead) : isKey && keyName
      ? `${keyName[0]!.toUpperCase()}${keyName.slice(1)} opens the locked ${t.goalTitle} (Area ${goalIndex + 1}).` : undefined;
    const gate = designed?.controlsGrille ? [...plan.doorRooms.keys()].filter(d => d.name === 'Iron Grille') : [];
    const hasSecret = secretDoors.some(([, rs]) => rs.includes(room));
    out.push({
      ...base, id: `place-area-${n}`, type: 'place', name: `Area ${n}: ${title}`, category: role.toLowerCase(), stockingRole: role,
      notes: notes.join(' '), gmNotes: gm.join(' '),
      factionLinks: [roomFaction],
      discoveryTier: hasSecret ? 'secret' : role === 'Trap' || isKey ? 'hidden' : 'landmark',
      siteStatus: 'active',
      entityIds: [room.id, ...roomFeatures.map(e => e.id), ...gate.map(e => e.id)], clueNext,
    });
    const b = getEntityBounds(room)!;
    const c = center(room);
    const at = designed?.landmark ? { x: c.x, y: c.y + (b.maxY - b.minY) * .38 } : labelAt(room);
    out.push({ ...base, id: `room-label-${n}`, type: 'label', text: String(n), x: at.x, y: at.y, size: 17 });
    // Tegel Manor on-map GM room title (hidden in Player View, solves 15-second lookup bottleneck)
    const titleY = Math.min(b.maxY - g * 0.35, at.y + g * 0.72);
    out.push({ ...base, id: `gm-title-${n}`, type: 'label', gmOnly: true, text: title, x: at.x, y: titleY, size: 10 });

    // Lit rooms are where someone lives or worships; corridors and the rest stay dark.
    if (i === 0 || isGoal || purpose === 'guardroom' || purpose === 'shrine' || designed?.basin) {
      const offset = { x: c.x - (b.maxX - b.minX) * .23, y: c.y - (b.maxY - b.minY) * .25 };
      const light = designed?.landmark && pointInPolygon(offset, room.rings) ? offset : c;
      const color = purpose === 'shrine' ? '#c9b6ff' : designed?.basin ? '#9cddd9' : '#ffb35c';
      if (pointInPolygon(light, room.rings)) out.push({ ...base, id: `light-${n}`, type: 'light', ...light, color,
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
  // Emit up to 5 compact GM-only sensory bleed cues at room thresholds/doors so GMs telegraph adjacent rooms instantly
  let cueCount = 0;
  const cuedRooms = new Set<string>();
  for (const [door, rs] of plan.doorRooms) {
    if (cueCount >= 5) break;
    if (door.kind === 'secret' || rs.length === 0) continue;
    const target = rs.find(r => !cuedRooms.has(r.id) && (plan.depth.get(r.id) ?? 0) > 0);
    if (!target) continue;
    const cue = roomShortCue.get(target.id);
    if (!cue) continue;
    cuedRooms.add(target.id);
    const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
    out.push({
      ...base,
      id: `gm-cue-${cueCount++}`,
      type: 'label',
      gmOnly: true,
      text: `↳ ${cue}`,
      x: mid.x,
      y: mid.y - g * 0.35,
      size: 9,
    });
  }
  return out;
}
