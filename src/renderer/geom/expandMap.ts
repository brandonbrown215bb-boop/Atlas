import {
  MapDocSchema,
  type Entity,
  type MapDoc,
  type Point,
  type PortalEntity,
} from '../model/schema';
import { clipAndInheritEntities, type RectBounds } from './clipInherit';

export type CardinalDirection = 'N' | 'S' | 'E' | 'W';

/** Source strip clipped along the shared cardinal border before reflecting across the seam. */
export function neighborSeamStripRect(
  bounds: RectBounds,
  direction: CardinalDirection,
  stripRatio = 0.14,
): RectBounds {
  const sw = Math.max(1, bounds.w * stripRatio);
  const sh = Math.max(1, bounds.h * stripRatio);
  switch (direction) {
    case 'E':
      return { x: bounds.x + bounds.w - sw, y: bounds.y, w: sw, h: bounds.h };
    case 'W':
      return { x: bounds.x, y: bounds.y, w: sw, h: bounds.h };
    case 'S':
      return { x: bounds.x, y: bounds.y + bounds.h - sh, w: bounds.w, h: sh };
    case 'N':
      return { x: bounds.x, y: bounds.y, w: bounds.w, h: sh };
  }
}

function mirrorSeamPoint(p: Point, strip: RectBounds, fullW: number, fullH: number, direction: CardinalDirection): Point {
  switch (direction) {
    case 'E':
      return { x: Math.max(0, Math.min(fullW, strip.w - p.x)), y: p.y };
    case 'W':
      return { x: Math.max(0, Math.min(fullW, fullW - p.x)), y: p.y };
    case 'S':
      return { x: p.x, y: Math.max(0, Math.min(fullH, strip.h - p.y)) };
    case 'N':
      return { x: p.x, y: Math.max(0, Math.min(fullH, fullH - p.y)) };
  }
}

/**
 * Creates a seam-matched adjacent N/S/E/W sibling map sheet that continues coastlines,
 * biomes, rivers, roads, and border terrain cells across the shared boundary.
 */
export function expandNeighborMap(
  source: MapDoc,
  direction: CardinalDirection,
  newId: string,
  newName: string,
): MapDoc {
  const { w, h } = source.bounds;
  const strip = neighborSeamStripRect(source.bounds, direction);
  const baseLayerId = source.layers[0]?.id ?? 'layer-base';
  let seq = 0;
  const clipped = clipAndInheritEntities(source, strip, baseLayerId, () => `seam-${direction.toLowerCase()}-${seq++}`);
  const entities: Record<string, Entity> = {};

  for (const ent of clipped) {
    const cleanBase = {
      ...ent,
      origin: 'manual' as const,
      inheritedFrom: undefined,
    };
    if (cleanBase.type === 'area') {
      const mirroredRings = cleanBase.rings.map((ring) =>
        [...ring.map((pt) => mirrorSeamPoint(pt, strip, w, h, direction))].reverse(),
      );
      entities[cleanBase.id] = { ...cleanBase, rings: mirroredRings };
    } else if (cleanBase.type === 'path') {
      entities[cleanBase.id] = {
        ...cleanBase,
        points: cleanBase.points.map((pt) => mirrorSeamPoint(pt, strip, w, h, direction)),
      };
    } else if (cleanBase.type === 'wall') {
      entities[cleanBase.id] = {
        ...cleanBase,
        points: cleanBase.points.map((pt) => mirrorSeamPoint(pt, strip, w, h, direction)),
      };
    } else if (cleanBase.type === 'door') {
      entities[cleanBase.id] = {
        ...cleanBase,
        a: mirrorSeamPoint(cleanBase.a, strip, w, h, direction),
        b: mirrorSeamPoint(cleanBase.b, strip, w, h, direction),
      };
    } else if ('x' in cleanBase && 'y' in cleanBase) {
      const m = mirrorSeamPoint({ x: cleanBase.x, y: cleanBase.y }, strip, w, h, direction);
      entities[cleanBase.id] = { ...cleanBase, x: m.x, y: m.y };
    }
  }

  let terrain: MapDoc['terrain'] | undefined;
  if (source.terrain && Object.keys(source.terrain).length > 0) {
    terrain = {};
    for (const [tid, rec] of Object.entries(source.terrain)) {
      const mirroredCells = rec.cells
        .filter((c) => c.x >= strip.x && c.x <= strip.x + strip.w && c.y >= strip.y && c.y <= strip.y + strip.h)
        .map((c) => {
          const mp = mirrorSeamPoint({ x: c.x - strip.x, y: c.y - strip.y }, strip, w, h, direction);
          return { ...c, x: mp.x, y: mp.y, downstream: undefined };
        });
      if (mirroredCells.length > 0) {
        terrain[tid] = {
          ...rec,
          bounds: { x: 0, y: 0, w, h },
          cells: mirroredCells,
        };
      }
    }
  }

  const dx = direction === 'E' ? w : direction === 'W' ? -w : 0;
  const dy = direction === 'S' ? h : direction === 'N' ? -h : 0;

  return MapDocSchema.parse({
    formatVersion: 2,
    id: newId,
    name: newName,
    kind: source.kind,
    ...(source.parent
      ? {
          parent: {
            mapId: source.parent.mapId,
            x: source.parent.x + dx,
            y: source.parent.y + dy,
            rotation: source.parent.rotation,
          },
        }
      : {}),
    bounds: { x: 0, y: 0, w, h },
    grid: { ...source.grid },
    layers: source.layers.map((l) => ({ ...l })),
    entities,
    generators: {},
    outsideLandIsWater: source.outsideLandIsWater,
    riverWidthMode: source.riverWidthMode,
    ...(terrain && Object.keys(terrain).length > 0 ? { terrain } : {}),
    revision: 1,
    deleted: {},
    fog: { enabled: source.fog.enabled, revealed: [] },
  });
}

export function formatFloorLabel(level: number): string {
  if (level === 0) return '1F';
  if (level < 0) return `B${Math.abs(level)}`;
  return `${level + 1}F`;
}

/**
 * Builds an upper (level + 1) or basement (level - 1) floor map sharing the outer building envelope
 * and connected at the exact stair coordinates via complementary vertical portals.
 */
export function createStackedFloorMap(
  source: MapDoc,
  targetLevel: number,
  newId: string,
  stairPos?: Point,
): { floorMap: MapDoc; sourceStairPos: Point; sourcePortalKind: 'stairsUp' | 'stairsDown' } {
  const floorGroupId = source.floorGroupId ?? source.id;
  const sourceLevel = source.level ?? 0;
  const goingUp = targetLevel > sourceLevel;
  const baseLayerId = source.layers[0]?.id ?? 'layer-base';

  const existingStair = Object.values(source.entities).find(
    (e): e is PortalEntity =>
      e.type === 'portal' &&
      (e.connectorKind === 'stairsUp' ||
        e.connectorKind === 'stairsDown' ||
        e.connectorKind === 'spiralStairs'),
  );
  const pos: Point = stairPos ??
    (existingStair ? { x: existingStair.x, y: existingStair.y } : {
      x: source.bounds.x + source.bounds.w / 2,
      y: source.bounds.y + source.bounds.h / 2,
    });

  const entities: Record<string, Entity> = {};
  // Copy outer structural shell walls/floor outline cleanly for alignment across levels
  for (const ent of Object.values(source.entities)) {
    if (ent.type === 'area' && ent.role === 'floor') {
      entities[`shell-${ent.id}`] = {
        ...ent,
        id: `shell-${ent.id}`,
        layerId: baseLayerId,
        origin: 'manual',
        genId: undefined,
        groupId: undefined,
        name: `${formatFloorLabel(targetLevel)} Floor`,
      };
    } else if (ent.type === 'wall') {
      entities[`shell-${ent.id}`] = {
        ...ent,
        id: `shell-${ent.id}`,
        layerId: baseLayerId,
        origin: 'manual',
        genId: undefined,
        groupId: undefined,
      };
    }
  }

  const returnPortal: PortalEntity = {
    id: `stairs-${newId}`,
    type: 'portal',
    layerId: baseLayerId,
    origin: 'manual',
    rev: 1,
    name: `Stairs ${goingUp ? 'Down' : 'Up'} (${formatFloorLabel(sourceLevel)})`,
    x: pos.x,
    y: pos.y,
    targetMapId: source.id,
    connectorKind: goingUp ? 'stairsDown' : 'stairsUp',
    elevationDelta: sourceLevel - targetLevel,
  };
  entities[returnPortal.id] = returnPortal;

  const baseName = source.name.replace(/\s+\((?:B\d+|\d+F)\)$/i, '');
  const floorMap = MapDocSchema.parse({
    formatVersion: 2,
    id: newId,
    name: `${baseName} (${formatFloorLabel(targetLevel)})`,
    kind: source.kind,
    parent: source.parent ? { ...source.parent } : undefined,
    bounds: { ...source.bounds },
    grid: { ...source.grid },
    layers: source.layers.map((l) => ({ ...l })),
    entities,
    generators: {},
    level: targetLevel,
    floorGroupId,
    elevationStories: Math.max(source.elevationStories ?? 1, targetLevel >= 0 ? targetLevel + 1 : 1),
    revision: 1,
    deleted: {},
    fog: { enabled: source.fog.enabled, revealed: [] },
  });

  return {
    floorMap,
    sourceStairPos: pos,
    sourcePortalKind: goingUp ? 'stairsUp' : 'stairsDown',
  };
}
