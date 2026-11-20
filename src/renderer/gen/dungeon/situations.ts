import { bboxFromPoints } from '../../geom/hitTest';
import type { PlaceEntity, Point } from '../../model/schema';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { SiteKind, StockingRole } from '../world/hooks';
import type { ROOM_PURPOSES } from './dressing';
import type { DungeonParams } from './layout';

type Purpose = Exclude<typeof ROOM_PURPOSES[number], 'random'>;
type GridPoint = readonly [x: number, y: number];
type Link = readonly [from: number, to: number];
interface Landmark {
  id: string;
  name: string;
  role: string;
  widthFt: number | 'basin span';
  depthFt: number;
  offsetY?: number;
}

export interface SituationRoom {
  slot: GridPoint;
  size: GridPoint;
  title: string;
  purpose: Purpose;
  role: StockingRole;
  notes: string;
  gmNotes?: string;
  lead?: { room: number; text: string };
  landmark?: Landmark;
  basin?: boolean;
  controlsGrille?: boolean;
  shape?: 'octagon' | 'cross';
  fill?: string;
}

interface Situation {
  kind: SiteKind;
  premise: string;
  summary: string;
  rooms: readonly SituationRoom[];
  links: readonly Link[];
  rewardRoom: number;
  lockedRoom?: number;
}

const situations = {
  tomb: {
    kind: 'ruin',
    premise: 'The tomb’s warden is still keeping vigil. Someone moved the burial bell, leaving the vigil unfinished.',
    summary: 'The direct gallery passes the warden. A longer way winds behind the burial vault through the preparation rooms.',
    rewardRoom: 2,
    rooms: [
      { slot: [1, 0], size: [.55, .5], title: 'Tomb Entrance', purpose: 'storage', role: 'Empty',
        notes: 'A carved procession carries a bell from a rack of bones to a low stone altar.' },
      { slot: [2, 0], size: [.65, .74], title: 'Processional Hall', purpose: 'shrine', role: 'Monster', fill: '#9d876b',
        notes: 'Worn flagstones lead toward the vault. You hear slow, measured steps ahead.',
        gmNotes: 'The warden challenges anyone moving toward the vault, but stays in the hall. Ringing the burial bell on the offering altar brings the warden there to finish the vigil. Until the next dawn it stands watch at the altar and lets visitors pass.',
        lead: { room: 4, text: 'The procession carved at the entrance ends at the offering altar.' } },
      { slot: [2, 2], size: [.72, .78], title: 'Burial Vault', purpose: 'crypt', role: 'Special', shape: 'octagon', fill: '#978773',
        landmark: { id: 'sarcophagus', name: 'Sarcophagus', role: 'sarcophagus', widthFt: 8, depthFt: 4 },
        notes: 'A pale sarcophagus fills the chamber. A service door behind it leads into the ossuary.',
        gmNotes: 'The lid is loose and can be shifted by two people. The goods inside can be carried out through either route.' },
      { slot: [1, 2], size: [.49, .65], title: 'Ossuary', purpose: 'crypt', role: 'Empty',
        landmark: { id: 'bell', name: 'Burial Bell', role: 'burialBell', widthFt: 1.5, depthFt: 1.5 },
        notes: 'Bone racks lean against the walls. A little bronze bell lies wedged under a toppled rack.',
        lead: { room: 4, text: 'The bell has the same crescent scratched into its base as the socket in the offering altar.' } },
      { slot: [1, 1], size: [.67, .68], title: 'Offering Court', purpose: 'shrine', role: 'Special', shape: 'cross', fill: '#897e9b',
        landmark: { id: 'altar', name: 'Offering Altar', role: 'altar', widthFt: 6, depthFt: 4 },
        notes: 'A low altar bears an empty bronze socket stamped with a crescent moon. A trail of bone dust leads deeper. A side door opens into a work room.',
        gmNotes: 'Set the bell into the socket and ring it to move the warden from the processional hall. The noise carries through the tomb.',
        lead: { room: 3, text: 'The missing bell is under a fallen rack in the ossuary.' } },
      { slot: [0, 1], size: [.51, .48], title: 'Preparation Room', purpose: 'storage', role: 'Empty',
        notes: 'Dusty linen bins and a stone washing bench. The door hinges here have been oiled from this side.',
        gmNotes: 'A linen bin can be tipped against the door to delay pursuit. This is where the undertakers worked.' },
    ],
    links: [[0, 1], [1, 2], [2, 3], [0, 4], [4, 3], [4, 5]],
  },
  flooded: {
    kind: 'lair',
    premise: 'These galleries were built to regulate underground water. The pump stopped and the lower walk is filling.',
    summary: 'Take the exposed walk over the basin or get to the pump room through the low inspection route.',
    rewardRoom: 5,
    rooms: [
      { slot: [2, 0], size: [.58, .45], title: 'Maintenance Entrance', purpose: 'storage', role: 'Empty',
        notes: 'Salt crusts the steps. A fresh boot print in the muck points inward.' },
      { slot: [2, 1], size: [.58, .63], title: 'Intake Junction', purpose: 'cistern', role: 'Empty', fill: '#7c8c87',
        notes: 'One doorway gives onto a bright plank walk over dark water. The inspection passage smells of wet stone and slopes away beneath a high-water line.',
        lead: { room: 5, text: 'A painted pipe runs from the basin toward the pump house.' } },
      { slot: [1, 1], size: [.41, .52], title: 'Inspection Passage', purpose: 'storage', role: 'Empty', fill: '#5c685d',
        notes: 'Tight, dark, and damp. Strands of weed cling to the wall above your head. The dull sound of knocking comes from farther on.',
        gmNotes: 'The low route avoids the lookout on the plank walk. When the pump starts, water surges through here before draining. Anyone stood in the passage needs to get to either end.' },
      { slot: [3, 1], size: [.76, .77], title: 'Plank Walk', purpose: 'cistern', role: 'Monster', basin: true, shape: 'octagon', fill: '#6f8586',
        landmark: { id: 'walk', name: 'Plank Walk', role: 'bridge', widthFt: 'basin span', depthFt: 5 },
        notes: 'A broad basin fills the center. A plank walk crosses it and a stone ledge skirts the water. You can see movement across the room.',
        gmNotes: 'The lookout wants dry passage out. The boards announce heavy footsteps. A party willing to go slowly can keep to the ledge; a group coming out of the pump house can approach from behind.',
        lead: { room: 5, text: 'The pump house controls the water in this basin.' } },
      { slot: [1, 2], size: [.55, .59], title: 'Drying Room', purpose: 'storage', role: 'Special',
        notes: 'A stranded worker knocks from behind a stack of drying racks.',
        gmNotes: 'The worker wants an escort to the entrance. They know how to start the pump and warn of the surge along the inspection passage.',
        lead: { room: 5, text: 'The worker tells you to open the discharge before turning the pump wheel.' } },
      { slot: [3, 2], size: [.71, .57], title: 'Pump House', purpose: 'alchemy', role: 'Special', fill: '#5e746f',
        landmark: { id: 'pump', name: 'Bronze Pump', role: 'pumpWheel', widthFt: 6, depthFt: 5 },
        notes: 'A bronze wheel sits on a green pump. An arrow on the discharge pipe points back toward the plank walk.',
        gmNotes: 'Open the discharge and turn the wheel to drain the basin. After a brief surge in the inspection passage, the ledge and the basin floor provide dry footing. A maintenance locker contains the salvage.' },
    ],
    links: [[0, 1], [1, 2], [1, 3], [2, 4], [4, 5], [3, 5]],
  },
  watch: {
    kind: 'stronghold',
    premise: 'The watch post has been taken over. Its new occupants have barred the strongroom and are arguing over the spoils.',
    summary: 'Go through the watched court or circle through the stores to reach the winch from the service side.',
    rewardRoom: 5,
    lockedRoom: 5,
    rooms: [
      { slot: [2, 0], size: [.68, .45], title: 'Gatehouse', purpose: 'guardroom', role: 'Empty',
        notes: 'The old gate hangs open. Fresh footprints run straight in; a few muddy ones turn toward the stores.' },
      { slot: [2, 1], size: [.78, .68], title: 'Watch Court', purpose: 'guardroom', role: 'Monster', shape: 'cross', fill: '#9b765b',
        landmark: { id: 'barricade', name: 'Lookout’s Barricade', role: 'barricade', widthFt: 12, depthFt: 3, offsetY: .17 },
        notes: 'A stack of timbers overlooks the straight route to the winch. Voices carry from behind it.',
        gmNotes: 'The lookout wants a share of the strongroom goods. They can be bargained with. They can watch the gate and the court, but cannot see through the stores.',
        lead: { room: 2, text: 'The muddy tracks lead out of the court into the stores.' } },
      { slot: [1, 0], size: [.5, .55], title: 'Stores', purpose: 'storage', role: 'Empty',
        notes: 'The racks leave a narrow aisle to a service door. Rope and empty sacks are within easy reach.',
        lead: { room: 3, text: 'Low voices from the service door mention a missing winch pin.' } },
      { slot: [1, 2], size: [.52, .62], title: 'Mess Room', purpose: 'tavern', role: 'Special',
        notes: 'Someone huddles beside the hearth with a heavy iron pin hidden under a boot.',
        gmNotes: 'A deserter took the pin to stop the others opening the strongroom. They will trade it for a chance to leave, or show the party how to keep the grille up with a stout wedge.',
        lead: { room: 4, text: 'The pin fits the empty socket on the winch.' } },
      { slot: [2, 2], size: [.56, .59], title: 'Winch Room', purpose: 'guardroom', role: 'Special', controlsGrille: true, fill: '#806e5c',
        landmark: { id: 'winch', name: 'Grille Winch', role: 'winch', widthFt: 5, depthFt: 3.5 },
        notes: 'A chain runs from a squat winch straight toward the iron grille. The winch has an empty locking socket.',
        gmNotes: 'Use the pin or a stout wedge to hold the winch after raising the grille. Without one, somebody has to hold the winch while the others pass.',
        lead: { room: 5, text: 'Raising the grille opens the passage to the strongroom.' } },
      { slot: [3, 2], size: [.67, .49], title: 'Strongroom', purpose: 'treasury', role: 'Special', fill: '#a18460',
        landmark: { id: 'strongbox', name: 'Banded Strongbox', role: 'strongbox', widthFt: 4, depthFt: 2.5 },
        notes: 'A banded strongbox sits on a low stone plinth. The iron grille is its only approach.',
        gmNotes: 'The strongbox is bulky enough to need two bearers. Who holds the winch while they take it out?' },
    ],
    links: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [4, 5]],
  },
  chasm: {
    kind: 'sacred',
    premise: 'An earthquake split this subterranean sanctuary in two. A narrow plank spans the flooded fissure while a forgotten pilgrim ledge skirts the far wall.',
    summary: 'Cross the exposed bridge under watch from the sanctum, or descend through the relic store to flank along the lower ledge.',
    rewardRoom: 5,
    rooms: [
      { slot: [2, 0], size: [.56, .46], title: 'Narthex Entry', purpose: 'shrine', role: 'Empty',
        notes: 'Cracked mosaic floors tilt toward the south. Cold mist rises from a split beyond the inner arch.' },
      { slot: [2, 1], size: [.68, .66], title: 'Chasm Crossing', purpose: 'cistern', role: 'Monster', basin: true, shape: 'octagon', fill: '#6c7e83',
        landmark: { id: 'chasm-bridge', name: 'Rope & Plank Bridge', role: 'bridge', widthFt: 'basin span', depthFt: 5 },
        notes: 'A dark flooded fissure splits the floor; lashed planks span the gap. Lantern light flickers on the far lip.',
        gmNotes: 'Zealot sentries watch the planks from the far side and can cut the ropes if alerted. Approaching quietly from the lower ledge catches them from behind.',
        lead: { room: 3, text: 'A collapsed vestry door on the west rim leads toward the dry flank ledge.' } },
      { slot: [1, 0], size: [.52, .54], title: 'Relic Vestry', purpose: 'storage', role: 'Empty',
        notes: 'Toppled reliquary cabinets smell of cedar and old incense. A narrow cleft opens behind the tallest press.',
        lead: { room: 3, text: 'Cool air and chalk arrows mark a pilgrim service ledge beyond the cleft.' } },
      { slot: [1, 2], size: [.56, .58], title: 'Pilgrim Ledge', purpose: 'crypt', role: 'Special', fill: '#7f7a6c',
        notes: 'A narrow rock gallery overlooks the chasm. An injured novice hides behind a broken censer.',
        gmNotes: 'The novice knows the sanctum’s counter-bell phrase and warns of the zealots’ trip-rope on the main bridge.',
        lead: { room: 5, text: 'The inner sanctum lies just beyond the east arch; speaking the evening canticle calms its guardian.' } },
      { slot: [3, 1], size: [.54, .54], title: 'Bell Cloister', purpose: 'shrine', role: 'Empty', shape: 'cross', fill: '#8a8298',
        landmark: { id: 'cloister-bell', name: 'Sanctuary Bell', role: 'burialBell', widthFt: 2, depthFt: 2 },
        notes: 'Stone benches face a bronze bell hanging on a frayed cord. Footsteps echo from the chasm.',
        gmNotes: 'Ringing the bell draws the chasm sentries to muster here, leaving the main bridge unguarded.' },
      { slot: [3, 2], size: [.68, .64], title: 'Inner Sanctum', purpose: 'shrine', role: 'Special', shape: 'octagon', fill: '#9c8b70',
        landmark: { id: 'sanctum-altar', name: 'Cleft Altar', role: 'altar', widthFt: 6, depthFt: 4 },
        notes: 'A gilded reliquary sits atop a split altar stone. Both the bridge gallery and the pilgrim ledge converge here.',
        gmNotes: 'Lifting the reliquary triggers a tremor unless a counterweight is placed on the altar plinth.' },
    ],
    links: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 5], [4, 5]],
  },
  contested: {
    kind: 'stronghold',
    premise: 'Two rival bands hold opposite halves of this border vault—bandit deserters at the gate and stubborn vault-wardens behind the inner iron grille.',
    summary: 'Parley with either faction across the contested hall, or slip through the collapsed larder bypass to reach the inner winch unchallenged.',
    rewardRoom: 5,
    lockedRoom: 5,
    rooms: [
      { slot: [2, 0], size: [.62, .46], title: 'Outer Guardpost', purpose: 'guardroom', role: 'Empty',
        notes: 'Fresh chalk tallies mark watch shifts beside the entrance. Smoke drifts from the hall ahead.' },
      { slot: [2, 1], size: [.74, .66], title: 'Contested Hall', purpose: 'guardroom', role: 'Monster', shape: 'cross', fill: '#997458',
        landmark: { id: 'faction-barricade', name: 'Splintered Barricade', role: 'barricade', widthFt: 12, depthFt: 3, offsetY: .15 },
        notes: 'Overturned tables split the hall into a tense no-man’s-land. Arrows bristle from both sides of the timbers.',
        gmNotes: 'Deserters hold the north half and want the vault-wardens flushed out; they will trade safe passage for help breaking the inner grille.',
        lead: { room: 2, text: 'A supply chute from the outer larder bypasses the firing line.' } },
      { slot: [1, 0], size: [.5, .54], title: 'Collapsed Larder', purpose: 'storage', role: 'Empty',
        notes: 'Shattered pickle jars and salted crates hide a tight crawlway dug by smugglers.',
        lead: { room: 3, text: 'Scrape marks lead through the crawlway toward the wardens’ mess.' } },
      { slot: [1, 2], size: [.54, .6], title: 'Wardens’ Mess', purpose: 'tavern', role: 'Special',
        notes: 'Two exhausted vault-wardens boil leather scraps over a shielded brazier.',
        gmNotes: 'The wardens distrust the deserters and hold the winch crank. They will lower the iron grille if escorted safely to the entrance.',
        lead: { room: 4, text: 'The crank fits the iron winch in the adjoining mechanism chamber.' } },
      { slot: [2, 2], size: [.56, .58], title: 'Mechanism Chamber', purpose: 'guardroom', role: 'Special', controlsGrille: true, fill: '#7e6c5b',
        landmark: { id: 'contested-winch', name: 'Grille Winch', role: 'winch', widthFt: 5, depthFt: 3.5 },
        notes: 'Heavy chains run from an iron winch to the barred strongroom grille.',
        gmNotes: 'Operating the winch makes a loud clatter audible in the Contested Hall unless greased with tallow from the larder.',
        lead: { room: 5, text: 'Raising the grille opens the sealed treasury beyond.' } },
      { slot: [3, 2], size: [.66, .5], title: 'Sealed Treasury', purpose: 'treasury', role: 'Special', fill: '#a48761',
        landmark: { id: 'contested-box', name: 'Paymaster Chest', role: 'strongbox', widthFt: 4, depthFt: 2.5 },
        notes: 'An iron-banded paymaster chest rests behind the raised iron grille.',
        gmNotes: 'Contains payroll coin and stamped border warrants coveted by both factions.' },
    ],
    links: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [4, 5]],
  },
} satisfies Record<string, Situation>;

export interface DungeonSituation extends Situation {
  cells: Map<string, number>;
  entrance: Point;
}

export function inheritedDungeonSite(constraints: GeneratorInput<DungeonParams>['constraints']) {
  const kinds: SiteKind[] = ['ruin', 'lair', 'stronghold', 'sacred'];
  const kindOf = (p: PlaceEntity): SiteKind | undefined =>
    /ruin/i.test(p.category) || /crypt|barrow|tomb/i.test(p.notes) ? 'ruin'
      : /lair/i.test(p.category) ? 'lair' : /stronghold/i.test(p.category) ? 'stronghold' : /sacred/i.test(p.category) ? 'sacred' : undefined;
  for (const kind of kinds) {
    const place = constraints.find((e): e is PlaceEntity => e.type === 'place' && e.origin === 'inherited' && kindOf(e) === kind);
    if (place) return { place, kind };
  }
  return undefined;
}

/** Lay out the authored routes first. Spare slots add dead ends and leave the routes intact. */
export function dungeonSituation(input: GeneratorInput<DungeonParams>): DungeonSituation | undefined {
  const { params, region, constraints, grid, seed } = input;
  if (params.mode !== 'dungeon' || params.rooms < 6 || params.purpose !== 'random' || Object.keys(params.roomPurposes).length) return;
  if (constraints.some(e => e.type !== 'label' && e.type !== 'place'
    && !(e.type === 'area' && (e.role === 'land' || e.role.startsWith('biome:')) && e.usage !== 'blueprint'))) return;
  const box = bboxFromPoints(region[0]!);
  if (!box || region.length !== 1 || region[0]!.length !== 4) return;
  const corners = new Set(region[0]!.map(p => `${p.x},${p.y}`));
  if (![box.minX, box.maxX].every(x => [box.minY, box.maxY].every(y => corners.has(`${x},${y}`)))) return;
  const cols = Math.floor((box.maxX - box.minX) / grid + 1e-8);
  const rows = Math.floor((box.maxY - box.minY) / grid + 1e-8);
  const pitch = Math.min(20, Math.floor(Math.min(cols, rows) / 5));
  const width = params.corridorWidth;
  if (pitch < Math.max(10, width * 2 + 6) || Math.max(cols, rows) > Math.min(cols, rows) * 1.8) return;
  // The entrance has to land on the actual footprint edge, including on rotated layouts.
  if (Math.abs(cols * grid - (box.maxX - box.minX)) > grid * 0.01
    || Math.abs(rows * grid - (box.maxY - box.minY)) > grid * 0.01) return;

  const inherited = inheritedDungeonSite(constraints);
  const core: Situation[] = [situations.tomb, situations.flooded, situations.watch];
  const sMod5 = (seed >>> 0) % 5;
  let setup: Situation | undefined;
  if (inherited) {
    const matching = Object.values(situations).filter(s => s.kind === inherited.kind);
    setup = matching[(seed >>> 0) % matching.length];
  } else if (sMod5 === 4) {
    setup = situations.chasm;
  } else if (sMod5 === 1) {
    setup = situations.contested;
  } else {
    setup = core[(seed >>> 0) % core.length];
  }
  if (!setup) return;
  const turns = Math.floor((seed >>> 0) / 3) % 4;
  const across = turns % 2 ? rows : cols;
  const left = Math.floor((across - pitch * 5) / 2);
  const random = mulberry32((seed ^ 0x13d7ac42) >>> 0);
  const nudge = () => Math.round((random() - .5) * Math.max(0, pitch - 14));
  const columns = Array.from({ length: 5 }, (_, i) => left + i * pitch + Math.floor(pitch / 2) + nudge());
  const levels = Array.from({ length: 5 }, (_, i) => i * pitch + Math.floor(pitch / 2) + nudge());
  const at = ([x, y]: GridPoint): GridPoint => [columns[x]!, levels[y]!];
  const rotate = ([x, y]: GridPoint): GridPoint => {
    switch (turns) {
      case 1: return [cols - 1 - y, x];
      case 2: return [cols - 1 - x, rows - 1 - y];
      case 3: return [y, rows - 1 - x];
      default: return [x, y];
    }
  };
  const key = ([x, y]: GridPoint) => `${x},${y}`;
  const occupied = new Map<string, number>();
  const roomCells = (slot: GridPoint, size: GridPoint, shape?: SituationRoom['shape']) => {
    const [x, y] = at(slot);
    const w = Math.max(width + 3, Math.round(pitch * size[0]));
    const h = Math.max(width + 3, Math.round(pitch * size[1]));
    const points: GridPoint[] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const cut = Math.floor(Math.min(w, h) / 4);
      const dx = Math.min(i, w - 1 - i), dy = Math.min(j, h - 1 - j);
      if (shape === 'octagon' && dx + dy < cut || shape === 'cross' && dx < cut && dy < cut) continue;
      points.push([x + i - Math.floor(w / 2), y + j - Math.floor(h / 2)]);
    }
    return points;
  };
  const links = (a: GridPoint, b: GridPoint, ends: Link) => {
    const vertical = a[0] === b[0];
    const axis = vertical ? 1 : 0;
    const strip: GridPoint[] = [];
    for (let p = Math.min(a[axis], b[axis]); p <= Math.max(a[axis], b[axis]); p++) {
      for (let i = 0; i < width; i++) {
        const q = a[1 - axis]! + i - Math.floor((width - 1) / 2);
        const point: GridPoint = vertical ? [q, p] : [p, q];
        const id = occupied.get(key(point));
        if (id === undefined) strip.push(point);
        else if (!ends.includes(id)) return;
      }
    }
    return strip;
  };
  const paint = (points: GridPoint[], label: number) => points.forEach(p => occupied.set(key(p), label));
  for (const [i, r] of setup.rooms.entries()) {
    const points = roomCells(r.slot, r.size, r.shape);
    if (points.some(p => occupied.has(key(p)))) return;
    paint(points, i + 1);
  }
  for (const [a, b] of setup.links) {
    const strip = links(at(setup.rooms[a]!.slot), at(setup.rooms[b]!.slot), [a + 1, b + 1]);
    if (!strip?.length) return;
    paint(strip, 0);
  }
  const [entryX, entryY] = at(setup.rooms[0]!.slot);
  const entrance: GridPoint = [entryX, 0];
  const entry = links([entryX, entryY], entrance, [1, 1]);
  if (!entry?.length) return;
  paint(entry, 0);

  const slots = setup.rooms.map(r => r.slot);
  const used = new Set(slots.map(key));
  // Side chambers cluster around the service areas and leave the entrance and focal room easy to read.
  const parents = [...slots.keys()].slice(2).filter(i => i !== setup.rewardRoom);
  parents.push(1, 0, setup.rewardRoom);
  for (const parent of parents) {
    if (parent === setup.lockedRoom || slots.length >= params.rooms) continue;
    const [x, y] = slots[parent]!;
    const neighboringSlots: GridPoint[] = [[x - 1, y], [x + 1, y], [x, y + 1], [x, y - 1]];
    for (let i = neighboringSlots.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [neighboringSlots[i], neighboringSlots[j]] = [neighboringSlots[j]!, neighboringSlots[i]!];
    }
    for (const slot of neighboringSlots) {
      if (slots.length >= params.rooms) break;
      if (slot.some(n => n < 0 || n >= 5) || used.has(key(slot))) continue;
      const room = roomCells(slot, [.42, .41]);
      if (room.some(p => occupied.has(key(p)))) continue;
      const strip = links(at(slots[parent]!), at(slot), [parent + 1, slots.length + 1]);
      if (!strip?.length) continue;
      slots.push(slot);
      parents.push(slots.length - 1);
      used.add(key(slot));
      paint(strip, 0);
      paint(room, slots.length);
    }
  }
  if (slots.length < params.rooms) return;
  const cells = new Map<string, number>();
  // Insert rooms before passages so their floor numbers survive the component split.
  for (const [point, label] of [...occupied].sort((a, b) => (a[1] || Infinity) - (b[1] || Infinity))) {
    const xy = point.split(',').map(Number) as [number, number];
    const [rx, ry] = rotate(xy);
    if (rx < 0 || ry < 0 || rx >= cols || ry >= rows) return;
    cells.set(key([rx, ry]), label);
  }
  const [x, y] = rotate(entrance);
  return { ...setup, cells, entrance: { x, y } };
}
