import { geographicEntities, isWorldSymbol } from './geography';
import type { MultiPolygon, Ring } from 'polygon-clipping';
import polygonClipping from './polygonClipping';
import type { Entity, MapDoc, Point } from '../model/schema';

export interface RectBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pointInRect(p: Point, r: RectBounds): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function translatePoint(p: Point, r: RectBounds): Point {
  return { x: p.x - r.x, y: p.y - r.y };
}

/**
 * Liang-Barsky segment-rectangle clipping. Returns null if the segment lies
 * completely outside the rectangle.
 */
export function clipSegmentToRect(
  a: Point,
  b: Point,
  r: RectBounds,
): [Point, Point] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;

  const checks: Array<[number, number]> = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return null;
      if (ratio > t0) t0 = ratio;
    } else {
      if (ratio < t0) return null;
      if (ratio < t1) t1 = ratio;
    }
  }

  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

function pointsClose(a: Point, b: Point, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/**
 * Clips a polyline (optionally closed) against a rectangle, returning 0 or more
 * contiguous clipped polylines.
 */
export function clipPolylineToRect(
  points: readonly Point[],
  closed: boolean,
  r: RectBounds,
): Point[][] {
  if (points.length < 2) return [];
  const segments: Array<[Point, Point]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i]!, points[i + 1]!]);
  }
  if (closed) {
    segments.push([points[points.length - 1]!, points[0]!]);
  }

  const chains: Point[][] = [];
  for (const [a, b] of segments) {
    const clipped = clipSegmentToRect(a, b, r);
    if (!clipped) continue;
    const [ca, cb] = clipped;
    if (pointsClose(ca, cb)) continue;
    const lastChain = chains[chains.length - 1];
    if (lastChain && pointsClose(lastChain[lastChain.length - 1]!, ca)) {
      lastChain.push(cb);
    } else {
      chains.push([ca, cb]);
    }
  }
  return chains;
}

function toPcRing(pts: readonly Point[]): Ring {
  return pts.map((p) => [p.x, p.y]);
}

function fromPcRing(ring: Ring, rect: RectBounds): Point[] {
  const pts: Point[] = [];
  for (const coord of ring) {
    pts.push({ x: coord[0]! - rect.x, y: coord[1]! - rect.y });
  }
  if (pts.length > 1 && pointsClose(pts[0]!, pts[pts.length - 1]!)) {
    pts.pop();
  }
  return pts;
}

/**
 * Clips parent map entities to `rect` and returns new entities in child-map
 * local coordinates (0..rect.w, 0..rect.h) marked `origin: 'inherited'`.
 */
export function clipAndInheritEntities(
  parentMap: MapDoc,
  rect: RectBounds,
  targetLayerId: string,
  createId: () => string = () => crypto.randomUUID(),
  childKind?: MapDoc['kind'],
): Entity[] {
  const result: Entity[] = [];
  const parentSpan = Math.max(1, Math.max(parentMap.bounds.w, parentMap.bounds.h));
  const rectSpan = Math.max(1, Math.max(rect.w, rect.h));
  // A region redraws its own relief and roads at its own scale, so inherited ones stay only a little larger.
  const zoomedRegion = childKind === 'region' && rectSpan < parentSpan;
  // A settlement is the town itself: world icons and labels mean nothing a mile across, and world-scale roads shrink to lanes.
  const settlement = childKind === 'settlement';
  const dropped = new Set<string>();
  const iconNames = new Set(settlement ? Object.values(parentMap.entities).filter(e => e.type === 'prop' && isWorldSymbol(e) && e.name && pointInRect(e, rect)).map(e => e.name!) : []);
  const routeWidthScale = zoomedRegion ? Math.min(1, (rectSpan / parentSpan) * 1.6) : 1;
  const junctions=new Map<string,string>();
  const junction=(p:Point)=>{const key=`${p.x.toFixed(6)},${p.y.toFixed(6)}`;if(!junctions.has(key))junctions.set(key,createId());return junctions.get(key)!;};
  const rectPoly: MultiPolygon = [
    [
      [
        [rect.x, rect.y],
        [rect.x + rect.w, rect.y],
        [rect.x + rect.w, rect.y + rect.h],
        [rect.x, rect.y + rect.h],
        [rect.x, rect.y],
      ],
    ],
  ];

  for (const entity of geographicEntities(parentMap)) {
    if(entity.id.startsWith('implicit-ocean-'))continue;
    const inheritedFrom = { entityId: parentMap.entities[entity.id]?entity.id:entity.id.replace(/:resolved-\d+$|:part-\d+$/,''), parentRev: entity.rev };

    switch (entity.type) {
      case 'area': {
        const subject: MultiPolygon = [entity.rings.map(toPcRing)];
        const clipped = polygonClipping.intersection(subject, rectPoly);
        for (const poly of clipped) {
          const rings = poly
            .map((ring) => fromPcRing(ring, rect))
            .filter((ring) => ring.length >= 3);
          if (rings.length === 0) continue;
          result.push({
            id: createId(),
            type: 'area',
            layerId: targetLayerId,
            origin: 'inherited',
            rev: 1,
            inheritedFrom,
            gmOnly: entity.gmOnly,
            name: entity.name,
            role: entity.role,
            waterKind: entity.waterKind,
            rings,
            elevation: entity.elevation,
            fill: entity.fill,
          });
        }
        break;
      }

      case 'path': {
        const chains = clipPolylineToRect(entity.points, entity.closed, rect);
        const allInside = entity.points.every((p) => pointInRect(p, rect));
        for (const chain of chains) {
          if (chain.length < 2) continue;
          result.push({
            id: createId(),
            type: 'path',
            layerId: targetLayerId,
            origin: 'inherited',
            rev: 1,
            inheritedFrom,
            gmOnly: entity.gmOnly,
            name: entity.name,
            role: entity.role,
            points: chain.map((p) => translatePoint(p, rect)),
            startNodeId: entity.role==='river'?junction(chain[0]!):undefined,
            endNodeId: entity.role==='river'?junction(chain[chain.length-1]!):undefined,
            // Roads copied down from a world have lost their tier, so every road or trail is capped.
            width: settlement && ['road', 'trail'].includes(entity.role) ? Math.min(entity.width, entity.routeTier === 'track' ? 6 : 9)
              : settlement && entity.role === 'river' ? Math.min(entity.width, 40)
              : entity.routeTier ? entity.width * routeWidthScale : entity.width,
            closed: entity.closed && allInside,
          });
        }
        break;
      }

      case 'wall': {
        const chains = clipPolylineToRect(entity.points, false, rect);
        for (const chain of chains) {
          if (chain.length < 2) continue;
          result.push({
            id: createId(),
            type: 'wall',
            layerId: targetLayerId,
            origin: 'inherited',
            rev: 1,
            inheritedFrom,
            gmOnly: entity.gmOnly,
            name: entity.name,
            points: chain.map((p) => translatePoint(p, rect)),
            blocksMove: entity.blocksMove,
            blocksSight: entity.blocksSight,
          });
        }
        break;
      }

      case 'door': {
        const seg = clipSegmentToRect(entity.a, entity.b, rect);
        if (seg && !pointsClose(seg[0], seg[1])) {
          result.push({
            id: createId(),
            type: 'door',
            layerId: targetLayerId,
            origin: 'inherited',
            rev: 1,
            inheritedFrom,
            gmOnly: entity.gmOnly,
            name: entity.name,
            a: translatePoint(seg[0], rect),
            b: translatePoint(seg[1], rect),
            kind: entity.kind,
            open: entity.open,
          });
        }
        break;
      }

      case 'prop':
      case 'light':
      case 'label': {
        if (settlement && (isWorldSymbol(entity) || entity.type === 'label' && iconNames.has(entity.text))) { if (pointInRect(entity, rect)) dropped.add(inheritedFrom.entityId); break; }
        if (pointInRect(entity, rect)) {
          let translated = translatePoint(entity, rect);
          // A town or site label sat a world-scale gap from its icon; pull it in to match the shrunken icon.
          const owner = zoomedRegion && entity.type === 'label'
            ? Object.values(parentMap.entities).find(p => p.type === 'prop' && p.name === entity.text && isWorldSymbol(p) && pointInRect(p, rect))
            : undefined;
          if (owner?.type === 'prop') {
            const pull = (rectSpan / parentSpan) * 1.3;
            translated = translatePoint({ x: owner.x + (entity.x - owner.x) * pull, y: owner.y + (entity.y - owner.y) * pull }, rect);
          }
          const relief = entity.type === 'prop' && ['mountain', 'hill', 'forest'].includes(entity.symbolKind ?? '');
          const factor = zoomedRegion ? (relief ? 1.2 : 1.4) : 2.2;
          const symbolScale = entity.type === 'prop' && isWorldSymbol(entity) && rectSpan < parentSpan
            ? Math.min(1, Math.max(0.08, (rectSpan / parentSpan) * factor))
            : 1;
          result.push({
            ...entity,
            ...(entity.type === 'prop' && symbolScale < 1 ? {
              ...(entity.w !== undefined ? { w: entity.w * symbolScale } : {}),
              ...(entity.h !== undefined ? { h: entity.h * symbolScale } : {}),
            } : {}),
            genId: undefined, groupId: undefined,
            id: createId(),
            layerId: targetLayerId,
            origin: 'inherited',
            rev: 1,
            inheritedFrom,
            x: translated.x,
            y: translated.y,
          });
        }
        break;
      }

      case 'image':
      case 'portal':
      case 'place':
        break;
    }
  }

  // A region adopts the notes, rumours and links of every town and site it inherits, pointing at its own copies.
  if (childKind === 'region' || settlement) {
    for (const place of Object.values(parentMap.entities)) {
      if (place.type !== 'place') continue;
      const copies = result.filter(e => e.type !== 'label' && e.inheritedFrom && place.entityIds.includes(e.inheritedFrom.entityId));
      if (!copies.length && !place.entityIds.some(id => dropped.has(id))) continue;
      const labels = result.filter(e => e.type === 'label' && e.inheritedFrom && place.entityIds.includes(e.inheritedFrom.entityId));
      result.push({ ...place, genId: undefined, groupId: undefined, id: createId(), layerId: targetLayerId, origin: 'inherited', rev: 1,
        inheritedFrom: { entityId: place.id, parentRev: place.rev }, entityIds: [...copies, ...labels].map(e => e.id) });
    }
  }

  return result;
}
