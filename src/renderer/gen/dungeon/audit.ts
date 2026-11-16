import type { AreaEntity, DoorEntity, Entity, MapDoc, Point, PortalEntity } from '../../model/schema';

export interface SevenPillarCheck {
  id: string;
  label: string;
  passed: boolean;
  tip: string;
}

export interface DungeonTopologyAudit {
  roomCount: number;
  doorCount: number;
  secretCount: number;
  entranceCount: number;
  loops: number;
  maxDeadEndDepth: number;
  singleSecretChokes: string[];
  fakeForks: string[];
  stockingCounts: Record<'Empty' | 'Monster' | 'Special' | 'Trap', number>;
  threeClueCount: number;
  xanderingRating: 'Xandered (Loops)' | 'Single Loop' | 'Linear / Tree' | 'Too Few Rooms';
  sevenPillars: SevenPillarCheck[];
}

function pointNearRingOrBox(pt: Point, ring: readonly Point[], pad = 1.6): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return pt.x >= minX - pad && pt.x <= maxX + pad && pt.y >= minY - pad && pt.y <= maxY + pad;
}

function componentCount(nodes: string[], adj: Map<string, Set<string>>): number {
  const seen = new Set<string>();
  let comps = 0;
  for (const start of nodes) {
    if (seen.has(start)) continue;
    comps++;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
  }
  return comps;
}

/**
 * Evaluates Jaquays/Xander loop connectivity, dead-end chains, single-secret choke points,
 * and Goblin Punch's 7 Pillars on any site or interior dungeon MapDoc.
 */
export function auditDungeonTopology(map: MapDoc): DungeonTopologyAudit {
  const entities = Object.values(map.entities);
  const rooms = entities.filter((e): e is AreaEntity => e.type === 'area' && e.role === 'floor' && (e.rings[0]?.length ?? 0) >= 3);
  const doors = entities.filter((e): e is DoorEntity => e.type === 'door');
  const portals = entities.filter((e): e is PortalEntity => e.type === 'portal');
  const lights = entities.filter((e) => e.type === 'light');
  const props = entities.filter((e) => e.type === 'prop');
  const labels = entities.filter((e) => e.type === 'label');
  const places = entities.filter((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place');

  const nodeIds = rooms.map((r) => r.id);
  const adjAll = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set()]));
  const adjPublic = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set()]));
  const edges: Array<{ u: string; v: string; door: DoorEntity }> = [];

  for (const door of doors) {
    const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
    const touching = rooms.filter((r) => pointNearRingOrBox(mid, r.rings[0]!, 1.8));
    if (touching.length >= 2) {
      const u = touching[0]!.id;
      const v = touching[1]!.id;
      adjAll.get(u)!.add(v);
      adjAll.get(v)!.add(u);
      edges.push({ u, v, door });
      if (door.kind !== 'secret') {
        adjPublic.get(u)!.add(v);
        adjPublic.get(v)!.add(u);
      }
    }
  }

  let edgePairs = 0;
  for (const [u, nbrs] of adjAll) {
    for (const v of nbrs) {
      if (u < v) edgePairs++;
    }
  }
  const comps = componentCount(nodeIds, adjAll);
  const loops = Math.max(0, edgePairs - nodeIds.length + comps);

  // Measure longest leaf-to-junction chain as dead-end depth
  let maxDeadEndDepth = 0;
  const deg = new Map<string, number>();
  for (const id of nodeIds) deg.set(id, adjAll.get(id)?.size ?? 0);
  const remDeg = new Map(deg);
  const depth = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const q = nodeIds.filter((id) => (remDeg.get(id) ?? 0) === 1);
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi]!;
    const d = (depth.get(u) ?? 0) + 1;
    if (d > maxDeadEndDepth) maxDeadEndDepth = d;
    for (const v of adjAll.get(u) ?? []) {
      const next = (remDeg.get(v) ?? 0) - 1;
      remDeg.set(v, next);
      if ((depth.get(v) ?? 0) < d) depth.set(v, d);
      if (next === 1) q.push(v);
    }
  }

  // Detect single-secret chokes: rooms/sections reachable ONLY via a single secret door
  const secretDoors = doors.filter((d) => d.kind === 'secret');
  const publicComps = componentCount(nodeIds, adjPublic);
  const singleSecretChokes: string[] = [];
  if (publicComps > comps) {
    for (const sd of secretDoors) {
      const matching = edges.find((e) => e.door.id === sd.id);
      if (matching) {
        singleSecretChokes.push(sd.name ?? sd.id);
      }
    }
  }

  const entranceCount =
    portals.length +
    doors.filter((d) => {
      const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
      const touching = rooms.filter((r) => pointNearRingOrBox(mid, r.rings[0]!, 1.8));
      return touching.length === 1;
    }).length;

  const distinctRoomNames = new Set(
    rooms
      .map((r) => (r.name ?? '').replace(/\s*\d+$/, '').trim())
      .filter((n) => n.length > 0 && n.toLowerCase() !== 'floor'),
  );

  const hasClueOrNote =
    places.some((p) => (p.clueNext ?? '').trim().length > 0 || (p.rumours?.length ?? 0) > 0) ||
    labels.length > 0;

  // Melan Diagram Reduction: collapse degree-2 corridors to expose redundant "fake forks" connecting identical hubs
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const reducedEdges = new Map<string, number>();
  const fakeForks: string[] = [];
  const isCorridorNode = (id: string) => (roomById.get(id)?.name ?? '').toLowerCase().includes('corridor');
  for (const r of rooms) {
    if (isCorridorNode(r.id) || (adjAll.get(r.id)?.size ?? 0) === 0) continue;
    for (const first of adjAll.get(r.id) ?? []) {
      let prev = r.id;
      let curr = first;
      const seenWalk = new Set([prev]);
      while (isCorridorNode(curr) && (adjAll.get(curr)?.size ?? 0) === 2 && !seenWalk.has(curr)) {
        seenWalk.add(curr);
        const next = [...(adjAll.get(curr) ?? [])].find((n) => n !== prev);
        if (!next) break;
        prev = curr;
        curr = next;
      }
      if (!isCorridorNode(curr) && curr !== r.id && r.id < curr) {
        const key = `${r.id}|${curr}`;
        reducedEdges.set(key, (reducedEdges.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [pair, count] of reducedEdges) {
    if (count > 1) {
      const [uId, vId] = pair.split('|');
      const uName = roomById.get(uId!)?.name ?? uId;
      const vName = roomById.get(vId!)?.name ?? vId;
      fakeForks.push(`${uName}↔${vName}`);
    }
  }

  const stockingCounts: Record<'Empty' | 'Monster' | 'Special' | 'Trap', number> = {
    Empty: 0,
    Monster: 0,
    Special: 0,
    Trap: 0,
  };
  for (const p of places) {
    if (p.stockingRole) stockingCounts[p.stockingRole] += 1;
  }
  const threeClueCount = places.filter(
    (p) => (p.clueNext ?? '').trim().length > 0 || (p.rumours?.length ?? 0) > 0 || /secret|clue|hint/i.test(p.notes + ' ' + p.gmNotes),
  ).length;

  const xanderingRating =
    rooms.length < 3
      ? 'Too Few Rooms'
      : loops >= 2
        ? 'Xandered (Loops)'
        : loops === 1
          ? 'Single Loop'
          : 'Linear / Tree';

  const sevenPillars: SevenPillarCheck[] = [
    {
      id: 'verticality',
      label: 'Verticality & Stairs',
      passed: portals.length >= 1 || Boolean(map.floorGroupId),
      tip: 'Add stairs/shafts or stack B1/2F floors so levels weave vertically.',
    },
    {
      id: 'loops',
      label: 'Multiple Routes / Loops',
      passed: loops >= 1 || rooms.length < 4,
      tip: 'Connect rooms with at least 1–2 shortcut loops so parties can flank or retreat.',
    },
    {
      id: 'landmarks',
      label: 'Orienting Landmarks',
      passed: labels.length >= 2 || distinctRoomNames.size >= 3,
      tip: 'Name focal rooms or drop landmarks so players remember junctions without checking grid coordinates.',
    },
    {
      id: 'lighting',
      label: 'Light & Dark Zones',
      passed: lights.length >= 1,
      tip: 'Place braziers/torches/lights to contrast lit hubs against dark ambush corridors.',
    },
    {
      id: 'secrets',
      label: 'Telegraphed Secrets (No Single Choke)',
      passed: singleSecretChokes.length === 0 && (secretDoors.length === 0 || hasClueOrNote || props.length >= 2),
      tip: 'Avoid locking a whole wing behind 1 secret door; seed 2–3 physical clues or secondary vents.',
    },
    {
      id: 'dressing',
      label: 'Interactive Props & Stocking',
      passed: props.length >= Math.max(3, Math.ceil(rooms.length * 0.7)),
      tip: 'Stock rooms with levers, tables, altars, crates, or hazards players can manipulate.',
    },
    {
      id: 'variety',
      label: 'Distinct Room Functions',
      passed: distinctRoomNames.size >= 2,
      tip: 'Mix room purposes (Barracks, Shrine, Kitchen, Vault) instead of identical empty chambers.',
    },
  ];

  return {
    roomCount: rooms.length,
    doorCount: doors.length,
    secretCount: secretDoors.length,
    entranceCount,
    loops,
    maxDeadEndDepth,
    singleSecretChokes,
    fakeForks,
    stockingCounts,
    threeClueCount,
    xanderingRating,
    sevenPillars,
  };
}
