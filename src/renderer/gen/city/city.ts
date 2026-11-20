import { isWorldSymbol, signedArea } from '../../geom/geography';
import type { MultiPolygon } from 'polygon-clipping';
import clipping from '../../geom/polygonClipping';
import { z } from 'zod';
import { DistrictProfileSchema, type DistrictProfile, type Entity, type Point } from '../../model/schema';
import { bboxFromPoints, boxesIntersect, distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { fromPolygons, rectRing, toPolygons } from '../../geom/fog';
import { clipOutside } from '../../geom/clipOutside';
import { registerGenerator, type GeneratorInput } from '../framework';
import { propArt, roofTexture, surfaceTexture } from '../art';
import { mulberry32 } from '../rng';
import { makeNamer, type WardKind } from '../world/names';
import { BAND_NAMES, makeHooks, parseSettlement, type Band, type Establishment, type SiteKind } from '../world/hooks';

export const CityParamsSchema = DistrictProfileSchema.extend({
  /** 'auto' follows the world town this map was developed from, else 'town'. */
  scale: z.enum(['auto', 'hamlet', 'village', 'town', 'city']).default('auto'),
  walls: z.enum(['auto', 'walled', 'open']).default('auto'),
  blockSize: z.number().min(30).max(180).default(75),
  streetWidth: z.number().min(3).max(16).default(6),
  lotDepth: z.number().min(8).max(30).default(15),
  fringe: z.boolean().default(true),
  renderSeed: z.number().int().optional(),
});
export type CityParams = z.infer<typeof CityParamsSchema>;
type Area = Extract<Entity, {type:'area'}>;
type Street = { points: Point[]; width: number };
const base = {origin:'generated' as const,layerId:'generated',rev:0};
export const ringArea = (r: Point[]) => Math.abs(signedArea(r));
const area = (p: Point[][]) => ringArea(p[0]!) - p.slice(1).reduce((s,r)=>s+ringArea(r),0);
const union = (parts: MultiPolygon[]): MultiPolygon => parts.length ? clipping.union(parts[0]!,...parts.slice(1)) : [];
export function bufferLine(points: Point[], radius: number, closed = false): MultiPolygon {
  const line=closed?[...points,points[0]!]:points;
  const parts: MultiPolygon[]=[];
  for(let i=1;i<line.length;i++) {
    const a=line[i-1]!,b=line[i]!,length=Math.hypot(b.x-a.x,b.y-a.y);
    if(length<1e-8) continue;
    const ux=(b.x-a.x)/length*radius,uy=(b.y-a.y)/length*radius;
    // Square caps conservatively contain the rendered round caps and avoid tangent circle booleans.
    parts.push(toPolygons([[[{x:a.x-ux-uy,y:a.y-uy+ux},{x:b.x+ux-uy,y:b.y+uy+ux},
      {x:b.x+ux+uy,y:b.y+uy-ux},{x:a.x-ux+uy,y:a.y-uy-ux}]]]));
  }
  return union(parts);
}

/** Clip a line against polygons including holes, for actual editable street centre lines. */
function clipLine(points: Point[], polygons: Point[][][]): Point[][] {
  return polygons.flatMap(p => {
    let lines = clipOutside(points,false,p[0]!,true);
    for (const hole of p.slice(1)) lines = lines.flatMap(line=>clipOutside(line,false,hole));
    return lines;
  }).filter(line=>line.length>=2 && line.some(p=>Math.hypot(p.x-line[0]!.x,p.y-line[0]!.y)>1e-5));
}

/** Clean micro-edges and nearly-collinear vertices from boolean clipping when computing block axes and lot edges. */
function cleanRing(ring: Point[], minEdge = 1.5): Point[] {
  const deduped: Point[] = [];
  for (const p of ring) {
    if (!deduped.length || Math.hypot(p.x - deduped[deduped.length - 1]!.x, p.y - deduped[deduped.length - 1]!.y) >= minEdge) deduped.push(p);
  }
  if (deduped.length > 3 && Math.hypot(deduped[0]!.x - deduped[deduped.length - 1]!.x, deduped[0]!.y - deduped[deduped.length - 1]!.y) < minEdge) deduped.pop();
  if (deduped.length <= 3) return ring;
  const cleaned: Point[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length]!, cur = deduped[i]!, next = deduped[(i + 1) % deduped.length]!;
    const chord = Math.hypot(next.x - prev.x, next.y - prev.y);
    const perp = chord > 1e-6 ? Math.abs((cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x)) / chord : 0;
    if (perp >= 0.25 || cleaned.length + (deduped.length - i) <= 3) cleaned.push(cur);
  }
  return cleaned.length >= 3 ? cleaned : ring;
}

/** Minimum-area oriented bounding box aligned with the polygon's dominant edge. */
function orientedFrame(ring: Point[]) {
  const clean = cleanRing(ring);
  const dirs: Point[] = [{ x: 1, y: 0 }];
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]!, b = clean[(i + 1) % clean.length]!, len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= 4) dirs.push({ x: (b.x - a.x) / len, y: (b.y - a.y) / len });
  }
  let best = { ux: 1, uy: 0, vx: 0, vy: 1, uMin: 0, uMax: 0, vMin: 0, vMax: 0, spanU: Infinity, spanV: Infinity };
  for (const d of dirs) {
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    const vx = -d.y, vy = d.x;
    for (const p of ring) {
      const u = p.x * d.x + p.y * d.y, v = p.x * vx + p.y * vy;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    const spanU = uMax - uMin, spanV = vMax - vMin;
    if (spanU * spanV < best.spanU * best.spanV) best = { ux: d.x, uy: d.y, vx, vy, uMin, uMax, vMin, vMax, spanU, spanV };
  }
  if (best.spanV > best.spanU) {
    return {
      ux: best.vx, uy: best.vy, vx: -best.ux, vy: -best.uy,
      uMin: best.vMin, uMax: best.vMax, vMin: -best.uMax, vMax: -best.uMin,
      spanMajor: best.spanV, spanMinor: best.spanU,
    };
  }
  return { ...best, spanMajor: best.spanU, spanMinor: best.spanV };
}

type Scale = Exclude<CityParams['scale'], 'auto'>;
type Path = Extract<Entity, { type: 'path' }>;
type Building = { entity: Area; c: Point; ward?: WardKind; fringe: boolean; notable?: Establishment };
const CORE_RADIUS: Record<Scale, number> = { hamlet: 45, village: 110, town: 260, city: 330 };
const PLAZA_RADIUS: Record<Scale, number> = { hamlet: 14, village: 22, town: 30, city: 40 };
/** How far houses keep straggling along the roads beyond the core. */
const RIBBON_REACH: Record<Scale, number> = { hamlet: 60, village: 150, town: 300, city: 450 };
const BUILDING_CAP: Record<Scale, number> ={ hamlet: 8, village: 120, town: 3000, city: 8000 };
const SCALE_DENSITY: Record<Scale, number> = { hamlet: .55, village: .8, town: 1, city: 1 };
const WARD_PROFILES: Record<WardKind, DistrictProfile> = {
  market: { density: .85, wealth: .55, activity: .95, access: 'open' },
  high: { density: .45, wealth: .9, activity: .35, access: 'gated' },
  temple: { density: .55, wealth: .7, activity: .5, access: 'restricted' },
  craft: { density: .8, wealth: .35, activity: .8, access: 'open' },
  docks: { density: .75, wealth: .35, activity: .9, access: 'open' },
  shambles: { density: .95, wealth: .12, activity: .6, access: 'open' },
};
const WARD_HOUSE: Record<WardKind, string> = { market: 'Shop', high: 'Manor House', temple: 'Townhouse', craft: 'Workshop', docks: 'Warehouse', shambles: 'Tenement' };
const NOTABLES: Record<Scale, Establishment[]> = {
  hamlet: ['inn', 'shrine'],
  village: ['inn', 'smithy', 'shrine', 'store', 'watch', 'mill'],
  town: ['inn', 'inn', 'tavern', 'smithy', 'stables', 'guildhall', 'apothecary', 'watch', 'store', 'healer', 'mill', 'tannery'],
  city: ['inn', 'inn', 'inn', 'tavern', 'tavern', 'smithy', 'smithy', 'stables', 'guildhall', 'apothecary', 'watch', 'watch', 'store', 'healer', 'bathhouse', 'moneylender', 'thieves', 'wizard', 'mill', 'tannery'],
};
/** Where each establishment wants to stand: near a gate, the square, water, the edge of town, or in a ward. */
const NOTABLE_SITE: Record<Establishment, 'gate' | 'plaza' | 'water' | 'edge' | WardKind> = {
  inn: 'gate', tavern: 'plaza', smithy: 'gate', stables: 'gate', guildhall: 'plaza', apothecary: 'market', watch: 'gate', store: 'plaza',
  healer: 'temple', shrine: 'plaza', bathhouse: 'high', moneylender: 'market', thieves: 'shambles', wizard: 'high', mill: 'water', tannery: 'edge',
  keep: 'high', temple: 'temple', market: 'plaza', harbor: 'docks',
};
const NOTABLE_TITLE: Partial<Record<Establishment, string>> = {
  smithy: 'Smithy', stables: 'Stables', guildhall: 'Guildhall', apothecary: 'Apothecary', watch: 'Watch House', store: 'General Store',
  healer: 'House of Healing', shrine: 'Shrine', bathhouse: 'Bathhouse', moneylender: 'Counting House', thieves: 'Den', wizard: 'Tower', mill: 'Mill', tannery: 'Tannery',
};

function segHit(a: Point, b: Point, c: Point, d: Point): Point | null {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } : null;
}
const polylineDistance = (p: Point, pts: Point[]) => Math.min(Infinity, ...pts.slice(1).map((b, i) => distanceToSegment(p, pts[i]!, b)));

/** Rectangle from corner `o`, `w` along `u` and `d` along `n`. */
const rect = (o: Point, u: Point, n: Point, w: number, d: number): Point[][] =>
  [[o, { x: o.x + u.x * w, y: o.y + u.y * w }, { x: o.x + u.x * w + n.x * d, y: o.y + u.y * w + n.y * d }, { x: o.x + n.x * d, y: o.y + n.y * d }]];

/** Halve a field across its long axis until parcels are about `target` m², leaving a hedgerow gap. */
function splitFields(polygon: Point[][], target: number, random: () => number, depth = 0): Point[][][] {
  if (area(polygon) <= target || depth >= 7) return [polygon];
  const frame = orientedFrame(polygon[0]!), u = frame.uMin + frame.spanMajor * (.4 + random() * .2);
  const vMid = (frame.vMin + frame.vMax) / 2, reach = frame.spanMinor + 20;
  const c = { x: frame.ux * u + frame.vx * vMid, y: frame.uy * u + frame.vy * vMid };
  const cut = bufferLine([{ x: c.x - frame.vx * reach, y: c.y - frame.vy * reach }, { x: c.x + frame.vx * reach, y: c.y + frame.vy * reach }], .8);
  const parts = fromPolygons(clipping.difference(toPolygons([polygon]), cut)).filter(p => area(p) > 50);
  return parts.length > 1 ? parts.flatMap(p => splitFields(p, target, random, depth + 1)) : [polygon];
}

/** Town centre: where existing roads meet nearest the middle (inherited roads converge on their town), else the middle. */
function findHub(region: Point[][], roads: Path[]): Point {
  const b = bboxFromPoints(region[0]!)!, mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const margin = Math.min(b.maxX - b.minX, b.maxY - b.minY) * .15;
  const candidates: Point[] = roads.flatMap(r => [r.points[0]!, r.points.at(-1)!]);
  for (const [i, r] of roads.entries()) for (const s of roads.slice(i + 1))
    for (let a = 1; a < r.points.length; a++) for (let c = 1; c < s.points.length; c++) {
      const hit = segHit(r.points[a - 1]!, r.points[a]!, s.points[c - 1]!, s.points[c]!);
      if (hit) candidates.push(hit);
    }
  const meets = candidates.filter(p => p.x - b.minX > margin && b.maxX - p.x > margin && p.y - b.minY > margin && b.maxY - p.y > margin
    && pointInPolygon(p, region) && roads.filter(r => polylineDistance(p, r.points) <= 12 + r.width / 2).length >= 2);
  return meets.sort((p, q) => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y))[0] ?? mid;
}

/** Drawn constraints first; a scale-sized core with a square, wards, streets and lots; ribbon outskirts and farmland beyond. */
export function generateCity(input: GeneratorInput<CityParams>): Entity[] {
  const {region,constraints} = input, random = mulberry32(input.seed);
  if (area(region) > 16_000_000) throw new Error('Choose a city footprint no larger than 16 square kilometres.');
  if (area(region)<900) throw new Error('City footprint needs at least 900 square metres.');
  // The world town this map was developed from (its adopted Place) sets the scale, trouble and rumours.
  const townPlace = constraints.find((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place' && /settlement/i.test(e.category));
  const parent = parseSettlement(townPlace?.notes);
  const scale: Scale = input.params.scale === 'auto' ? parent?.rank ?? 'town' : input.params.scale;
  const params = { ...input.params, scale, density: input.params.density * SCALE_DENSITY[scale] };
  const band = Math.max(0, BAND_NAMES.findIndex(n => townPlace?.notes?.includes(n))) as Band;
  // Text has its own stream so rewording a table never moves a street.
  const namer = makeNamer(input.seed, input.takenNames), hooks = makeHooks(mulberry32((input.seed ^ 0x51ed) >>> 0));
  // The core and square have their own stream too, so a footprint without a core lays out streets exactly as before.
  const shapeRandom = mulberry32((input.seed ^ 0xc0e) >>> 0);
  const allConstraintsRoads = constraints.filter((e): e is Path => e.type === 'path' && (e.role === 'road' || e.role === 'trail'));
  const output: Entity[] = [], streets: Street[] = [];
  const autoWalls: Path[] = [];
  const autoGates: Array<Extract<Entity, { type: 'door' }>> = [];
  const coreRings: Point[][][] = [];
  const rb = bboxFromPoints(region[0]!)!;
  const hub = findHub(region, allConstraintsRoads);
  const constraintWaters = constraints.filter((e): e is Area => e.type === 'area' && e.role === 'water');
  const wantWall = params.walls === 'walled' || (params.walls === 'auto' && (scale === 'town' || scale === 'city') && area(region) > 250_000);
  let coreRadius = 0;
  // Drawn walls or districts already say where the town is; otherwise the core is sized by scale.
  if (!constraints.some(e => (e.type === 'path' && e.role === 'cityWall') || e.type === 'wall' || (e.type === 'area' && e.role === 'district'))) {
    const sides = 16, rot = (shapeRandom() - 0.5) * 0.6;
    const phase2 = shapeRandom() * Math.PI * 2, phase3 = shapeRandom() * Math.PI * 2;
    const radialFactors = Array.from({ length: sides }, (_, i) => {
      const a = rot + (i / sides) * Math.PI * 2;
      const harmonic = 1 + 0.14 * Math.cos(2 * a + phase2) + 0.09 * Math.sin(3 * a + phase3);
      return { a, rad: harmonic * (0.90 + shapeRandom() * 0.14) };
    });
    const target = scale === 'city' ? Math.max(CORE_RADIUS.city, Math.min(rb.maxX - rb.minX, rb.maxY - rb.minY) * .34) : CORE_RADIUS[scale];
    let wallPts: Point[] = [];
    // A footprint too small for the core is filled outright, unless walls were asked for.
    for (const shrink of wantWall ? [1, .85, .7, .55, .45, .35, .27, .2] : [1, .85, .7]) {
      const r = target * shrink;
      const candidate = radialFactors.map(({ a, rad }) => ({ x: hub.x + Math.cos(a) * r * rad, y: hub.y + Math.sin(a) * r * rad }));
      if (candidate.every(p => pointInPolygon(p, region) && !(wantWall && constraintWaters.some(w => pointInPolygon(p, w.rings))))) { wallPts = candidate; coreRadius = r; break; }
    }
    if (wallPts.length === sides) coreRings.push([wallPts]);
    if (wallPts.length === sides && wantWall) {
      // Find gate locations where constraint roads cross wall edges, or fall back to 4 evenly spaced cardinal gates.
      type GateCut = { edgeIdx: number; t: number; width: number };
      const cutsOnWall: GateCut[] = [];
      const segHitT = (a: Point, b: Point, c: Point, d: Point): number | null => {
        const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
        if (Math.abs(den) < 1e-9) return null;
        const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
        const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / den;
        return t >= 0.05 && t <= 0.95 && u >= 0 && u <= 1 ? t : null;
      };
      for (const road of allConstraintsRoads) {
        for (let r = 1; r < road.points.length; r++) {
          const rA = road.points[r - 1]!, rB = road.points[r]!;
          for (let i = 0; i < sides; i++) {
            const p1 = wallPts[i]!, p2 = wallPts[(i + 1) % sides]!;
            const t = segHitT(p1, p2, rA, rB);
            if (t !== null && !cutsOnWall.some((c) => c.edgeIdx === i)) {
              cutsOnWall.push({ edgeIdx: i, t, width: Math.max(12, road.width * 1.45) });
            }
          }
        }
      }
      if (!cutsOnWall.length) {
        for (let g = 0; g < 4; g++) cutsOnWall.push({ edgeIdx: Math.floor((g * sides) / 4), t: 0.5, width: 13 });
      }
      cutsOnWall.sort((a, b) => a.edgeIdx - b.edgeIdx || a.t - b.t);
      const cutMap = new Map<number, GateCut>(cutsOnWall.map((c) => [c.edgeIdx, c]));
      const curtainPts: Point[][] = [];
      let curSegment: Point[] = [];
      for (let i = 0; i < sides; i++) {
        const p1 = wallPts[i]!, p2 = wallPts[(i + 1) % sides]!;
        if (!curSegment.length) curSegment.push(p1);
        const cut = cutMap.get(i);
        if (!cut) {
          curSegment.push(p2);
        } else {
          const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
          const mid = { x: p1.x + dx * cut.t, y: p1.y + dy * cut.t };
          const half = Math.min(len * 0.34, cut.width / 2);
          const ux = dx / len, uy = dy / len;
          const jambA = { x: mid.x - ux * half, y: mid.y - uy * half };
          const jambB = { x: mid.x + ux * half, y: mid.y + uy * half };
          curSegment.push(jambA);
          curtainPts.push(curSegment);
          curSegment = [jambB, p2];
          const gateDoor: Extract<Entity, { type: 'door' }> = {
            ...base, id: `auto-gate-${autoGates.length}`, type: 'door',
            a: jambA, b: jambB, kind: 'door', open: true,
          };
          autoGates.push(gateDoor);
        }
      }
      if (curSegment.length >= 2) {
        if (curtainPts.length > 0 && !cutMap.has(0)) {
          curSegment.push(...curtainPts[0]!.slice(1));
          curtainPts[0] = curSegment;
        } else {
          curtainPts.push(curSegment);
        }
      }
      for (const [ci, pts] of curtainPts.entries()) {
        if (pts.length < 2) continue;
        const wallEnt: Extract<Entity, { type: 'path' }> = {
          ...base, id: `auto-city-wall-${ci}`, type: 'path', role: 'cityWall', name: 'City Wall', points: pts, width: 4.5, closed: false,
        };
        autoWalls.push(wallEnt);
        output.push(wallEnt);
      }
    }
  }
  const allConstraints = [...constraints, ...autoWalls, ...autoGates];
  const districts = allConstraints.filter((e):e is Area=>e.type==='area'&&e.role==='district');
  const waters = allConstraints.filter((e):e is Area=>e.type==='area'&&e.role==='water');
  const plateaus = allConstraints.filter((e):e is Area=>e.type==='area'&&e.role==='plateau');
  const fixed = allConstraints.filter((e):e is Area=>e.type==='area'&&['building','floor'].includes(e.role));
  const gates = allConstraints.filter((e):e is Extract<Entity,{type:'door'}>=>e.type==='door'&&e.kind!=='secret');
  const obstacleParts: MultiPolygon[] = [...waters,...fixed].map(e=>toPolygons([e.rings]));
  const wallParts: MultiPolygon[] = [];
  for (const e of allConstraints) {
    if (e.type==='path'&&['road','trail'].includes(e.role)) streets.push({points:e.closed?[...e.points,e.points[0]!]:e.points,width:e.width});
    if (e.type==='wall'||e.type==='path'&&['river','cliff','cityWall'].includes(e.role)) {
      let shape = bufferLine(e.points,e.type==='path'?e.width/2:.5,e.type==='path'&&e.closed);
      if (e.type==='wall'||e.type==='path'&&e.role==='cityWall') {
        // Ordinary door spans are openings in a drawn wall; secret doors are not public access.
        for (const gate of gates) shape = clipping.difference(shape,bufferLine([gate.a,gate.b],(e.type==='path'?e.width/2:.5)+.25));
        wallParts.push(shape);
      }
      obstacleParts.push(shape);
    }
    if (e.type==='prop' && !isWorldSymbol(e)) {
      const b=getEntityBounds(e)!;
      obstacleParts.push(toPolygons([[rectRing({x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY})]]));
    }
  }
  // The square (or green) is cut out before streets, so avenues end at its edge and houses face it.
  const plazaRing = coreRings.length ? Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + shapeRandom() * .3, r = PLAZA_RADIUS[scale] * (.8 + shapeRandom() * .35);
    return { x: hub.x + Math.cos(a) * r, y: hub.y + Math.sin(a) * r };
  }) : [];
  const plazaParts = plazaRing.length ? fromPolygons(clipping.difference(clipping.intersection(toPolygons([[plazaRing]]), toPolygons([region])), union(obstacleParts))) : [];
  if (plazaParts.length) obstacleParts.push(toPolygons(plazaParts));
  const obstacles=union(obstacleParts), wallMask=union(wallParts);
  const usable=clipping.difference(toPolygons([region]),obstacles);
  const ground=fromPolygons(usable);
  if (!ground.length) throw new Error(`No buildable ground remains: ${waters.length} water areas, ${fixed.length} fixed buildings and ${constraints.filter(e=>e.type==='prop'&&!isWorldSymbol(e)).length} physical props overlap this district. Choose open land or edit the highlighted constraints.`);
  const wards: Array<{ kind: WardKind; p: Point; name: string }> = [];
  const wardAt = (p: Point) => wards.length && inTown(p)
    ? wards.reduce((a, b) => Math.hypot(a.p.x - p.x, a.p.y - p.y) <= Math.hypot(b.p.x - p.x, b.p.y - p.y) ? a : b) : undefined;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const profileAt = (p: Point): DistrictProfile => {
    const drawn = districts.find(d=>pointInPolygon(p,d.rings))?.district;
    const ward = drawn ? undefined : wardAt(p);
    if (!ward) return drawn ?? params;
    const w = WARD_PROFILES[ward.kind];
    return { ...w, density: clamp01(w.density + params.density - .65), wealth: clamp01(w.wealth + params.wealth - .5) };
  };
  const roadDistance = (p: Point) => Math.min(Infinity,...streets.flatMap(s=>s.points.slice(1).map((b,i)=>distanceToSegment(p,s.points[i]!,b)-s.width/2)));
  const addStreet = (line: Point[], polygon: Point[][], width: number) => {
    for (const points of clipLine(line,[polygon])) {
      streets.push({points,width});
      output.push({...base,id:`street-${output.length}`,type:'path',role:'road',name:'Street',points,width,closed:false});
    }
  };
  const walls = allConstraints.filter((e):e is Extract<Entity,{type:'path'}>=>e.type==='path'&&e.role==='cityWall'&&e.closed);
  const wallInterior = union([...walls.map(w=>toPolygons([[w.points]])), ...coreRings.map(r=>toPolygons([r]))]);
  const hasCore = walls.length > 0 || coreRings.length > 0;
  const walled = walls.length > 0 || autoWalls.length > 0;
  const inTown = (p: Point) => !hasCore||walls.some(w=>pointInPolygon(p,[w.points]))||coreRings.some(r=>pointInPolygon(p,r));
  // An area test, not a touch test: blocks cut along the core edge share it, give or take float noise.
  const overlapArea = (polygon: Point[][], mask: MultiPolygon) => fromPolygons(clipping.intersection(toPolygons([polygon]), mask)).reduce((s, p) => s + area(p), 0);
  const inTownPoly = (polygon: Point[][]) => !hasCore || overlapArea(polygon, wallInterior) > 1;
  const townRing = walls[0]?.points ?? coreRings[0]?.[0];
  const townBox = townRing ? bboxFromPoints(townRing)! : undefined;
  const coreR = coreRadius || (townBox ? Math.min(townBox.maxX - townBox.minX, townBox.maxY - townBox.minY) / 2 : Infinity);
  const outskirts = coreR + RIBBON_REACH[scale];
  const hubDistance = (p: Point) => Math.hypot(p.x - hub.x, p.y - hub.y);
  // Empty standalone towns get gate arteries and slightly angled radial avenues meeting at a central hub.
  if (!streets.some(s=>clipLine(s.points,ground).length)) {
    const townGround = walled ? fromPolygons(clipping.intersection(usable,wallInterior)) : ground;
    const arteryWidth = params.streetWidth * (scale === 'hamlet' || scale === 'village' ? .9 : 1.4);
    for (const p of ground) {
      const b=bboxFromPoints((townRing?townRing:p[0])!)!, w=b.maxX-b.minX, h=b.maxY-b.minY;
      const fullBox=bboxFromPoints(p[0]!)!, reach=Math.hypot(fullBox.maxX-fullBox.minX,fullBox.maxY-fullBox.minY)+20;
      const centre=hasCore?hub:{x:(b.minX+b.maxX)/2+(random()-.5)*w*.12,y:(b.minY+b.maxY)/2+(random()-.5)*h*.12};
      for (const gate of gates) {
        const gm={x:(gate.a.x+gate.b.x)/2,y:(gate.a.y+gate.b.y)/2};
        const dx=gate.b.x-gate.a.x,dy=gate.b.y-gate.a.y,len=Math.hypot(dx,dy)||1;
        let nx=-dy/len,ny=dx/len;
        if (walled) {
          if (inTown({x:gm.x+nx*6,y:gm.y+ny*6})) { nx=-nx; ny=-ny; }
          addStreet([{x:gm.x-nx*6,y:gm.y-ny*6},{x:gm.x+nx*reach,y:gm.y+ny*reach}],p,params.streetWidth*1.5);
          addStreet([{x:gm.x+nx*4,y:gm.y+ny*4},centre],p,arteryWidth);
        } else {
          addStreet([{x:gm.x-nx*reach,y:gm.y-ny*reach},{x:gm.x+nx*reach,y:gm.y+ny*reach}],p,params.streetWidth*1.5);
        }
      }
      const baseAngle=(random()-.5)*.42;
      for (let arm=0;arm<4;arm++) {
        const angle=baseAngle+arm*(Math.PI/2)+(random()-.5)*.22;
        const cosA=Math.cos(angle), sinA=Math.sin(angle);
        const curve=(random()-.5)*Math.min(w,h)*.09;
        const mid={x:centre.x+cosA*(reach*.38)-sinA*curve,y:centre.y+sinA*(reach*.38)+cosA*curve};
        const ray=[centre,mid,{x:centre.x+cosA*reach,y:centre.y+sinA*reach}];
        if (walled) {
          for (const tp of townGround) addStreet(ray,tp,arteryWidth);
        } else {
          addStreet(ray,p,arteryWidth);
        }
      }
    }
  }
  if (plazaRing.length) streets.push({ points: [...plazaRing, plazaRing[0]!], width: 0 });
  // Where streets enter the town: gates, or where they cross an unwalled core's edge.
  const entries: Point[] = walled ? gates.map(g => ({ x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }))
    : townRing ? streets.filter(s => s.width > 0).flatMap(s => s.points.slice(1).flatMap((b, i) =>
      townRing.flatMap((c, j) => segHit(s.points[i]!, b, c, townRing[(j + 1) % townRing.length]!) ?? []))) : [];
  const rivers = allConstraints.filter((e): e is Path => e.type === 'path' && e.role === 'river');
  const waterDistance = (p: Point) => Math.min(Infinity, ...waters.flatMap(w => w.rings.map(r => polylineDistance(p, [...r, r[0]!]))), ...rivers.map(r => polylineDistance(p, r.points)));
  const entryDistance = (p: Point) => entries.length ? Math.min(...entries.map(e => Math.hypot(e.x - p.x, e.y - p.y))) : hubDistance(p);
  const edgeDistance = (p: Point) => Number.isFinite(coreR) ? Math.abs(hubDistance(p) - coreR) : -hubDistance(p);
  // Wards: market at the square, the rich away from the gates, crafts by the gates, docks by the water, the poor in what is left.
  if ((scale === 'town' || scale === 'city') && townRing) {
    const n = scale === 'city' ? 6 : 4, rot = random() * Math.PI * 2;
    const seeds = Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * Math.PI * 2 + (random() - .5) * .5, r = coreR * (.5 + random() * .2);
      return { x: hub.x + Math.cos(a) * r, y: hub.y + Math.sin(a) * r };
    });
    const take = (kind: WardKind, score: (p: Point) => number) => {
      if (!seeds.length) return;
      const i = seeds.reduce((best, p, j) => score(p) < score(seeds[best]!) ? j : best, 0);
      wards.push({ kind, p: seeds.splice(i, 1)[0]!, name: namer.ward(kind) });
    };
    if (seeds.some(p => waterDistance(p) < coreR * .8)) take('docks', waterDistance);
    take('high', p => -entryDistance(p));
    if (scale === 'city') take('temple', hubDistance);
    take('craft', entryDistance);
    if (scale === 'city') take('craft', entryDistance);
    while (seeds.length) take('shambles', () => 0);
    wards.push({ kind: 'market', p: hub, name: '' });
  }
  const outerGround = hasCore ? fromPolygons(clipping.difference(usable,wallInterior)) : [];
  const fringeArteries: Street[] = hasCore ? streets.flatMap(s=>clipLine(s.points,outerGround).map(points=>({points,width:s.width}))) : [...streets];
  const arteryDistance = (p: Point) => Math.min(Infinity,...fringeArteries.flatMap(s=>s.points.slice(1).map((b,i)=>distanceToSegment(p,s.points[i]!,b)-s.width/2)));
  const polyArteryDistance = (ring: Point[]) => Math.min(...ring.map((p,i)=>{const q=ring[(i+1)%ring.length]!;return Math.min(arteryDistance(p),arteryDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2}));}));
  const roadMask=union(streets.filter(s=>s.width>0).map(s=>bufferLine(s.points,s.width/2)));
  let initial=fromPolygons(clipping.difference(usable,roadMask));
  // The core's edge and the outskirts' edge split blocks too, so town streets never run out across the fields.
  const outskirtsRing = coreRings.length && townRing ? townRing.map(p => ({ x: hub.x + (p.x - hub.x) * outskirts / coreR, y: hub.y + (p.y - hub.y) * outskirts / coreR })) : undefined;
  for (const ring of [...walls.map(w => w.points), ...coreRings.map(r => r[0]!), ...(outskirtsRing ? [outskirtsRing] : [])]) {
    const mask=toPolygons([[ring]]);
    initial=initial.flatMap(p=>[...fromPolygons(clipping.intersection(toPolygons([p]),mask)),...fromPolygons(clipping.difference(toPolygons([p]),mask))]);
  }
  // District borders are lot boundaries, not extra walls or roads.
  for(const district of districts) {
    const mask=toPolygons([district.rings]);
    initial=initial.flatMap(p=>[...fromPolygons(clipping.intersection(toPolygons([p]),mask)),...fromPolygons(clipping.difference(toPolygons([p]),mask))]);
  }
  const blocks: Point[][][] = [];
  // Beyond the outskirts is countryside: left whole here and parcelled into fields below.
  const countryside = new Set<Point[][]>();
  if (outskirtsRing) initial = initial.filter(p => {
    if (overlapArea(p, toPolygons([[outskirtsRing]])) > 1) return true;
    blocks.push(p); countryside.add(p); return false;
  });
  let cuts=0;
  const queue: Array<{ polygon: Point[][]; depth: number }> = initial.map(polygon => ({ polygon, depth: 0 }));
  for (let qi = 0; qi < queue.length; qi++) {
    const { polygon, depth } = queue[qi]!;
    const b=bboxFromPoints(polygon[0]!)!;
    const center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2}, profile=profileAt(center);
    const fringe=!inTownPoly(polygon), distToArtery=fringe?polyArteryDistance(polygon[0]!):0;
    const centerDistToArtery=fringe?arteryDistance(center):0;
    const hasRoad=polygon[0]!.some((p,i)=>{const q=polygon[0]![(i+1)%polygon[0]!.length]!;return roadDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2})<.5;});
    if (fringe && (!params.fringe || distToArtery > params.blockSize * 0.9 || hubDistance(center) > outskirts || (hasCore && depth >= 1 && centerDistToArtery > params.blockSize * 1.15)) && (depth >= 1 || hasRoad)) { blocks.push(polygon); continue; }
    const frame = orientedFrame(polygon[0]!);
    const target=params.blockSize*(1.25-profile.density*.45)*(fringe?1.35:1);
    const minBlockSq = target * target;
    const polyArea = area(polygon);
    if (depth>=9 || cuts>=900 || frame.spanMajor<=target || frame.spanMinor<params.lotDepth*2+params.streetWidth) { blocks.push(polygon); continue; }
    const fraction=.42+random()*.16;
    const uCut = frame.uMin + frame.spanMajor * fraction;
    const vMid = (frame.vMin + frame.vMax) / 2;
    const pivot = { x: frame.ux * uCut + frame.vx * vMid, y: frame.uy * uCut + frame.vy * vMid };
    // Watabou createAlleys rule: allow slight angle perturbation on large blocks, clamp to 0 when blocks get small so houses stay rectangular.
    const angleSpread = polyArea < minBlockSq * 1.35 || depth >= 3 ? 0 : 0.26 * (1 - profile.wealth * 0.35);
    const angle = (random() - 0.5) * angleSpread;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const dx = frame.vx * cosA - frame.vy * sinA, dy = frame.vx * sinA + frame.vy * cosA;
    const reach = Math.hypot(frame.spanMajor, frame.spanMinor) + 20;
    const line = [{ x: pivot.x - dx * reach, y: pivot.y - dy * reach }, { x: pivot.x + dx * reach, y: pivot.y + dy * reach }];
    const width=params.streetWidth*(.65+profile.activity*.35);
    const mask=bufferLine(line,width/2);
    const parts=fromPolygons(clipping.difference(toPolygons([polygon]),mask)).filter(p=>area(p)>64);
    if (parts.length<2) { blocks.push(polygon); continue; }
    addStreet(line,polygon,width); cuts++;
    for (const part of parts) queue.push({ polygon: part, depth: depth + 1 });
  }
  const roadBuffers = output
    .filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road')
    .concat(allConstraints.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road'))
    .map((s) => {
      const pts = s.closed ? [...s.points, s.points[0]!] : s.points;
      const mask = bufferLine(pts, s.width / 2);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), pad = s.width / 2 + 0.5;
      return { mask, box: { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad } };
    });
  const occupied: Array<{rings:Point[][];box:NonNullable<ReturnType<typeof bboxFromPoints>>}> = [];
  let buildingCount=0;
  const lots: Building[] = [];
  const touchesRoad = (polygon: Point[][]) => polygon[0]!.some((p,i)=>{const q=polygon[0]![(i+1)%polygon[0]!.length]!;return roadDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2})<.5;});
  const blockInfo = blocks.map((poly, idx) => {
    const b = bboxFromPoints(poly[0]!)!, c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    return { idx, poly, c, a: area(poly), d: hubDistance(c), core: inTownPoly(poly), centred: pointInPolygon(c, poly) };
  });
  const nearest = <T extends { c: Point }>(list: T[], to: Point | undefined) => to ? [...list].sort((a, b) => Math.hypot(a.c.x - to.x, a.c.y - to.y) - Math.hypot(b.c.x - to.x, b.c.y - to.y))[0] : undefined;
  const wardSeed = (kind: WardKind) => wards.find(w => w.kind === kind)?.p;
  const inner = blockInfo.filter(x => hasCore && x.core && x.centred && x.a >= 500);
  const keepIdx = scale === 'city' ? (nearest(inner.filter(x => x.a >= 800), wardSeed('high')) ?? inner.filter(x => x.a >= 800).sort((a, b) => b.a - a.a)[0])?.idx ?? -1 : -1;
  const keepAt = blockInfo[keepIdx]?.c;
  const templeIdx = scale === 'town' || scale === 'city'
    ? nearest(inner.filter(x => x.idx !== keepIdx && x.d > PLAZA_RADIUS[scale] + 20 && (!keepAt || Math.hypot(x.c.x - keepAt.x, x.c.y - keepAt.y) > 100)), wardSeed('temple') ?? hub)?.idx ?? -1 : -1;
  // The graveyard lies just outside town beside a road: the town's first way underground.
  const graveIdx = hasCore ? blockInfo.filter(x => !x.core && x.centred && x.a >= (scale === 'hamlet' || scale === 'village' ? 700 : 1200)
    && !countryside.has(x.poly) && x.d > coreR && x.d < coreR + 220 && touchesRoad(x.poly)).sort((a, b) => Math.abs(a.d - coreR - 50) - Math.abs(b.d - coreR - 50))[0]?.idx ?? -1 : -1;
  const keepName = namer.site('stronghold'), templeName = namer.temple();
  const fieldPalette = ['#7c8f59', '#88985d', '#989a64', '#718452'];
  const cityLabels: Entity[] = [];
  const cityPlaces: Extract<Entity, { type: 'place' }>[] = [];
  const localSites: Array<{ kind: SiteKind; name: string; p: Point }> = [];
  const blockOrder = blockInfo.map(x => x.idx).sort((a, b) => blockInfo[a]!.d - blockInfo[b]!.d);

  for (const index of blockOrder) {
    const polygon = blocks[index]!;
    if (area(polygon)<80 || !touchesRoad(polygon)) continue;
    const b=bboxFromPoints(polygon[0]!)!, center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
    const profile=profileAt(center), outer=cleanRing(polygon[0]!);
    const fringe=!inTownPoly(polygon), distToArtery=fringe?polyArteryDistance(outer):0;
    // Far from town the roadside blocks are farmland, picked up with the other fields below.
    if ((countryside.has(polygon) || fringe && hubDistance(center) > outskirts) && index !== graveIdx) continue;
    const isKeep = index === keepIdx;
    const isTemple = index === templeIdx;
    if (index === graveIdx) {
      // A walled yard on the block's longest road edge; the rest of the block stays farmland.
      const edge = outer.map((a, i) => ({ a, b: outer[(i + 1) % outer.length]! })).map(e => ({ ...e, len: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), mid: { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 } }))
        .filter(e => e.len >= 12 && roadDistance(e.mid) <= 1).sort((p, q) => q.len - p.len)[0];
      if (!edge) continue;
      const u = { x: (edge.b.x - edge.a.x) / edge.len, y: (edge.b.y - edge.a.y) / edge.len };
      let n = { x: -u.y, y: u.x };
      if (!pointInPolygon({ x: edge.mid.x + n.x, y: edge.mid.y + n.y }, polygon)) n = { x: -n.x, y: -n.y };
      const depth = { hamlet: 36, village: 50, town: 70, city: 90 }[scale], half = Math.min(depth, edge.len) / 2;
      const yard = fromPolygons(clipping.intersection(toPolygons([rect({ x: edge.mid.x - u.x * half + n.x * 2, y: edge.mid.y - u.y * half + n.y * 2 }, u, n, half * 2, depth)]), toPolygons([polygon])))
        .sort((p, q) => area(q) - area(p))[0];
      if (!yard) continue;
      const name = namer.graveyard(), c = { x: edge.mid.x + n.x * (depth / 2 + 2), y: edge.mid.y + n.y * (depth / 2 + 2) };
      output.push({ ...base, id: 'graveyard', type: 'area', role: 'district', name, rings: yard, fill: '#6f7d5c', district: profile });
      occupied.push({ rings: yard, box: bboxFromPoints(yard[0]!)! });
      const ids = ['graveyard'];
      const crypt = rect({ x: c.x - u.x * 3.5 - n.x * 4.5, y: c.y - u.y * 3.5 - n.y * 4.5 }, u, n, 7, 9);
      if (crypt[0]!.every(p => pointInPolygon(p, yard))) {
        const door = { x: c.x - n.x * 6, y: c.y - n.y * 6 };
        output.push({ ...base, id: 'graveyard-crypt', type: 'area', role: 'building', name: 'Crypt', rings: crypt, fill: '#6b675f', roofShape: 'hip' });
        output.push({ ...base, id: 'graveyard-crypt-stairs', type: 'portal', name: 'Crypt Stairs', x: door.x, y: door.y, targetMapId: 'unlinked', connectorKind: 'stairsDown', elevationDelta: -1 });
        ids.push('graveyard-crypt', 'graveyard-crypt-stairs');
      }
      let stones = 0;
      for (let v = 5; v < depth - 2 && stones < 40; v += 5) for (let s = -half + 3; s < half - 2 && stones < 40; s += 4) {
        const p = { x: edge.mid.x + u.x * s + n.x * v + (random() - .5), y: edge.mid.y + u.y * s + n.y * v + (random() - .5) };
        if (!pointInPolygon(p, yard) || Math.hypot(p.x - c.x, p.y - c.y) < 9 || random() < .3) continue;
        const id = `headstone-${stones++}`;
        output.push({ ...base, id, type: 'prop', name: 'Headstone', x: p.x, y: p.y, w: 1.1, h: .7, scale: 1, rotation: Math.atan2(u.y, u.x), flipX: false,
          ...propArt(input, ['headstone'], id, 'rock') });
      }
      const hook = hooks.site('ruin', band);
      cityPlaces.push({ ...base, id: 'place-graveyard', type: 'place', name, category: 'sacred', notes: 'Headstones, a lychgate and an old family crypt whose stairs go deeper than any family needs.',
        gmNotes: hook.gmNotes, stockingRole: hook.stockingRole, entityIds: ids, layerTier: 'focus', activeHours: { morning: true, day: true, evening: true, night: true } });
      cityLabels.push({ ...base, id: 'city-label-graveyard', type: 'label', text: name, x: c.x, y: c.y - depth / 2 - 6, size: 12 });
      localSites.push({ kind: 'ruin', name, p: c });
      continue;
    }
    const garden=profile.density===0 || (fringe && (!params.fringe || distToArtery > params.lotDepth * 2.5)) || (!fringe && params.fringe && !isKeep && !isTemple && random()<.11);
    const blockFill = fringe ? fieldPalette[index % fieldPalette.length]! : garden ? '#7c8f59' : '#b4a485';
    // Outside the core only small market gardens are their own block; the rest is parcelled with the fields below.
    if (!fringe || (garden && area(polygon) < 8000)) output.push({...base,id:`block-${index}`,type:'area',role:'district',name:isKeep?keepName:isTemple?`${templeName} Close`:garden?(fringe?'Market gardens':'Garden courtyard'):`Block ${index+1}`,
      rings:polygon,fill:blockFill,district:profile});
    if (fringe && garden && area(polygon) >= 8000) continue;

    if (isKeep || isTemple) {
      const frame = orientedFrame(outer);
      const kw = Math.min(isKeep ? 30 : 26, frame.spanMajor * 0.48);
      const kh = Math.min(isKeep ? 22 : 16, frame.spanMinor * 0.46);
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const hw = kw / 2, hh = kh / 2;
      const cand: Point[][] = [[
        { x: cx - frame.ux * hw - frame.vx * hh, y: cy - frame.uy * hw - frame.vy * hh },
        { x: cx + frame.ux * hw - frame.vx * hh, y: cy + frame.uy * hw - frame.vy * hh },
        { x: cx + frame.ux * hw + frame.vx * hh, y: cy + frame.uy * hw + frame.vy * hh },
        { x: cx - frame.ux * hw + frame.vx * hh, y: cy - frame.uy * hw + frame.vy * hh },
      ]];
      const shape = toPolygons([cand]);
      if (!clipping.difference(shape, toPolygons([polygon])).length && !clipping.intersection(shape, wallMask).length) {
        // Paved bailey / temple court apron (role:'floor') + abutting 4-vertex compound wing so silhouette isn't a bare box.
        const apronW = hw + 7, apronH = hh + 6;
        const apronCand: Point[][] = [[
          { x: cx - frame.ux * apronW - frame.vx * apronH, y: cy - frame.uy * apronW - frame.vy * apronH },
          { x: cx + frame.ux * apronW - frame.vx * apronH, y: cy + frame.uy * apronW - frame.vy * apronH },
          { x: cx + frame.ux * apronW + frame.vx * apronH, y: cy + frame.uy * apronW + frame.vy * apronH },
          { x: cx - frame.ux * apronW + frame.vx * apronH, y: cy - frame.uy * apronW + frame.vy * apronH },
        ]];
        for (const apronRing of fromPolygons(clipping.intersection(toPolygons([apronCand]), toPolygons([polygon])))) {
          output.push({
            ...base, id: `${isKeep ? 'keep' : 'temple'}-apron-${output.length}`, type: 'area', role: 'floor',
            floorMaterial: 'stone', name: isKeep ? 'Bailey Courtyard' : 'Temple Parvis',
            rings: apronRing, fill: isKeep ? '#8c867b' : '#9b9585',
          });
        }
        const mainId = `building-${buildingCount++}`;
        const compoundIds = [`block-${index}`, mainId];
        output.push({
          ...base, id: mainId, type: 'area', role: 'building',
          name: isKeep ? keepName : templeName, rings: cand,
          fill: isKeep ? '#6b655d' : '#56646e',
          roofShape: 'hip',
        });
        occupied.push({ rings: cand, box: bboxFromPoints(cand[0]!)! });
        // Try abutting a second 4-vertex wing on +vx (transept / gatehouse bailey hall), staying strictly disjoint.
        const wingW = isKeep ? kw * 0.44 : kw * 0.36;
        const wingH = isKeep ? kh * 0.42 : kh * 0.54;
        const wcx = cx + (isKeep ? frame.ux * (hw + wingW / 2 + 0.6) : frame.vx * (hh + wingH / 2 + 0.6));
        const wcy = cy + (isKeep ? frame.uy * (hw + wingW / 2 + 0.6) : frame.vy * (hh + wingH / 2 + 0.6));
        const wx = isKeep ? frame.ux : frame.vx;
        const wy = isKeep ? frame.uy : frame.vy;
        const px = -wy, py = wx;
        const wHalf = wingW / 2, hHalf = wingH / 2;
        const wingCand: Point[][] = [[
          { x: wcx - wx * wHalf - px * hHalf, y: wcy - wy * wHalf - py * hHalf },
          { x: wcx + wx * wHalf - px * hHalf, y: wcy + wy * wHalf - py * hHalf },
          { x: wcx + wx * wHalf + px * hHalf, y: wcy + wy * wHalf + py * hHalf },
          { x: wcx - wx * wHalf + px * hHalf, y: wcy - wy * wHalf + py * hHalf },
        ]];
        const wingShape = toPolygons([wingCand]);
        const wingBox = bboxFromPoints(wingCand[0]!)!;
        const wingCollides = occupied.some(o => boxesIntersect(o.box, wingBox) && clipping.intersection(wingShape, toPolygons([o.rings])).length > 0);
        if (!clipping.difference(wingShape, toPolygons([polygon])).length && !clipping.intersection(wingShape, wallMask).length && !wingCollides) {
          const wingId = `building-${buildingCount++}`;
          compoundIds.push(wingId);
          output.push({
            ...base, id: wingId, type: 'area', role: 'building',
            name: isKeep ? 'Keep Gatehouse' : 'Temple Cloister', rings: wingCand,
            fill: isKeep ? '#756f66' : '#63717b',
          });
          occupied.push({ rings: wingCand, box: wingBox });
        }
        if (isKeep) {
          for (const [bi, [su, sv]] of ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).entries()) {
            const bx = cx + frame.ux * su * (hw + 2.2) + frame.vx * sv * (hh + 2.2);
            const by = cy + frame.uy * su * (hw + 2.2) + frame.vy * sv * (hh + 2.2);
            if (pointInPolygon({ x: bx, y: by }, polygon) && roadDistance({ x: bx, y: by }) > 2.5) {
              output.push({
                ...base, id: `keep-bastion-${bi}`, type: 'prop', name: 'Corner Watchtower',
                x: bx, y: by, w: 4.2, h: 4.2, scale: 1, rotation: 0, flipX: false, builtin: 'pillar',
              });
            }
          }
        } else {
          const entryPt = { x: cx - frame.vx * (hh + 3.2), y: cy - frame.vy * (hh + 3.2) };
          if (pointInPolygon(entryPt, polygon)) {
            output.push({
              ...base, id: 'temple-altar-steps', type: 'prop', name: 'Temple Forecourt Basin',
              x: entryPt.x, y: entryPt.y, w: 4.5, h: 4.5, scale: 1, rotation: 0, flipX: false,
              ...propArt(input, ['shrineAltar', 'altar'], 'temple-altar-steps', 'altar'),
            });
          }
        }
        const landmark = isKeep ? keepName : templeName;
        cityLabels.push({
          ...base, id: isKeep ? 'city-label-keep' : 'city-label-temple', type: 'label',
          text: landmark, x: cx, y: cy, size: 16,
        });
        cityPlaces.push({
          ...base, id: isKeep ? 'place-keep' : 'place-temple', type: 'place',
          name: landmark, category: isKeep ? 'stronghold' : 'sacred',
          ...hooks.establishment(isKeep ? 'keep' : 'temple', `${isKeep ? 'Lord' : 'High Priest'} ${namer.person()}`),
          entityIds: compoundIds,
          layerTier: isKeep ? 'belligerent' : 'focus',
          activeHours: { morning: true, day: true, evening: true, night: isKeep },
        });
        continue;
      }
    }

    if (garden) {
      // Scatter orchard rows in market gardens and park groves in garden courtyards, clear of roads.
      const step = fringe ? 24 : 16;
      const treeCap = fringe ? 8 : 8;
      const jitterFactor = fringe ? 0.18 : 0.52;
      let addedTrees = 0;
      for (let ty = b.minY + step / 2; ty < b.maxY && addedTrees < treeCap; ty += step) {
        for (let tx = b.minX + step / 2; tx < b.maxX && addedTrees < treeCap; tx += step) {
          const tp = { x: tx + (random() - 0.5) * step * jitterFactor, y: ty + (random() - 0.5) * step * jitterFactor };
          if (!pointInPolygon(tp, polygon) || roadDistance(tp) < 4) continue;
          if (random() > (fringe ? 0.45 : 0.68)) continue;
          const sz = (fringe ? 8 : 6.5) + random() * 4;
          output.push({
            ...base, id: `city-tree-${index}-${addedTrees++}`, type: 'prop', name: fringe ? 'Orchard tree' : 'Park tree',
            x: tp.x, y: tp.y, w: sz, h: sz, scale: 1, rotation: random() * Math.PI * 2, flipX: random() < 0.5,
            ...propArt(input, ['tree'], `garden-tree-${output.length}`, 'tree'),
          });
        }
      }
      continue;
    }
    // Sort street-facing block edges shortest-first (Watabou Cutter.ring) so corner lots get clean cross-street frontage.
    const streetEdges = outer.map((a, edge) => {
      const next = outer[(edge + 1) % outer.length]!, length = Math.hypot(next.x - a.x, next.y - a.y);
      const mid = { x: (a.x + next.x) / 2, y: (a.y + next.y) / 2 };
      return { a, b: next, length, mid };
    }).filter(e => e.length >= 6 && roadDistance(e.mid) <= .65).sort((e1, e2) => e1.length - e2.length);
    for (const { a, b: edgeEnd, length, mid } of streetEdges) {
      const ux=(edgeEnd.x-a.x)/length,uy=(edgeEnd.y-a.y)/length;
      let nx=-uy,ny=ux;
      if (!pointInPolygon({x:mid.x+nx*.1,y:mid.y+ny*.1},polygon)) {nx=-nx;ny=-ny;}
      for (let offset=1;offset<length-5;) {
        const lotPoint = {x:a.x+ux*offset,y:a.y+uy*offset};
        const local=profileAt(lotPoint);
        const frontage=(6+local.wealth*6+(1-local.density)*5)*(.8+random()*.4);
        if (offset+frontage>length-1) break;
        const start=offset; offset+=frontage+1.2+(1-local.density)*2.8;
        // Outside city walls, filterOutskirts decays building probability with distance from main arterial roads (ribbon suburbs).
        const ribbonDecay = fringe ? Math.max(0, 1 - arteryDistance(lotPoint) / (params.lotDepth * 3.2)) * Math.max(0, 1 - (hubDistance(lotPoint) - coreR) / RIBBON_REACH[scale]) : 1;
        if (random()>(local.density+.2)*ribbonDecay || (fringe&&!params.fringe)) continue;
        const setback=local.access==='open'?1.2:local.access==='restricted'?2.5:4;
        const origin={x:a.x+ux*start+nx*setback,y:a.y+uy*start+ny*setback};
        // Rectangular footprints stay rectangular; keep realistic minimum house depth instead of shallow corner slivers.
        let depth=params.lotDepth*(.75+random()*.45)*(fringe?.7:1);
        const minDepth = Math.max(5, Math.min(7.5, frontage * 0.45));
        let rings: Point[][] | undefined;
        while (depth>=minDepth) {
          const candidate=[[origin,{x:origin.x+ux*frontage,y:origin.y+uy*frontage},
            {x:origin.x+ux*frontage+nx*depth,y:origin.y+uy*frontage+ny*depth},{x:origin.x+nx*depth,y:origin.y+ny*depth}]];
          const shape=toPolygons([candidate]);
          const outside=clipping.difference(shape,toPolygons([polygon]));
          const box=bboxFromPoints(candidate[0]!)!;
          const collision=occupied.some(o=>boxesIntersect(o.box,box)&&clipping.intersection(shape,toPolygons([o.rings])).length>0);
          const crossesRoad=roadBuffers.some(r=>boxesIntersect(r.box,box)&&clipping.intersection(shape,r.mask).length>0);
          const crossesPlateau=plateaus.some(p=>{const intersection=fromPolygons(clipping.intersection(shape,toPolygons([p.rings])));const covered=intersection.reduce((s,p)=>s+area(p),0);return covered>1e-6&&covered<frontage*depth-1e-5;});
          if (!outside.length&&!collision&&!crossesRoad&&!crossesPlateau&&!clipping.intersection(shape,wallMask).length) {rings=candidate;occupied.push({rings,box});break;}
          depth-=1.5;
        }
        if (!rings) continue;
        const height=plateaus.find(p=>pointInPolygon(rings![0]![0]!,p.rings))?.elevation;
        const colors=local.wealth>.65?['#a4543c','#616c73','#b59153','#8d4937','#7d5a42']:['#924c38','#785942','#a8864e','#5b656c','#875641'];
        const ward = fringe ? undefined : wardAt(lotPoint)?.kind;
        const bId = buildingCount++;
        const roof = roofTexture(input, local.wealth > .65 ? ['roofWealthy', 'roof'] : ['roof'], `building-${bId}`);
        const entity: Area = {...base,id:`building-${bId}`,type:'area',role:'building',
          name: ward ? WARD_HOUSE[ward] : fringe || scale === 'hamlet' || scale === 'village' ? 'Cottage' : local.wealth > .65 ? 'Townhouse' : 'House',rings,
          fill:colors[Math.floor(random()*colors.length)]!,...(height===undefined?{}:{elevation:height}),
          ...(bId % 3 === 0 ? { roofShape: 'hip' as const } : {}),
          ...(roof ? { texture: roof } : {})};
        output.push(entity);
        lots.push({ entity, c: { x: (rings[0]![0]!.x + rings[0]![2]!.x) / 2, y: (rings[0]![0]!.y + rings[0]![2]!.y) / 2 }, ward, fringe });
        if (buildingCount>=BUILDING_CAP[scale]) break;
      }
      if (buildingCount>=BUILDING_CAP[scale]) break;
    }
    if (buildingCount>=BUILDING_CAP[scale]) break;
  }
  // The square or green: one monument or well, stalls on market days, and a Place for the heart of town.
  const plazaIds: string[] = [];
  const isGreen = scale === 'hamlet' || scale === 'village';
  const squareName = isGreen ? 'Village Green' : 'Market Square';
  for (const [i, rings] of plazaParts.entries()) {
    plazaIds.push(`plaza-${i}`);
    output.push({ ...base, id: `plaza-${i}`, type: 'area', role: 'district', name: squareName, rings, fill: isGreen ? '#83935f' : '#cbbda0', district: profileAt(hub) });
  }
  if (plazaParts.length) {
    const constraintRoadDistance = (p: Point) => Math.min(Infinity, ...allConstraintsRoads.map(r => polylineDistance(p, r.points) - r.width / 2));
    const spots = [hub, ...Array.from({ length: 6 }, (_, i) => ({ x: hub.x + Math.cos(i * 1.05) * PLAZA_RADIUS[scale] * .45, y: hub.y + Math.sin(i * 1.05) * PLAZA_RADIUS[scale] * .45 }))]
      .filter(p => plazaParts.some(r => pointInPolygon(p, r)) && constraintRoadDistance(p) > 3);
    const well = spots[0];
    if (well) {
      plazaIds.push('plaza-centrepiece');
      output.push({ ...base, id: 'plaza-centrepiece', type: 'prop', name: isGreen ? 'Village Well' : 'Market Cross', x: well.x, y: well.y, w: isGreen ? 4 : 7, h: isGreen ? 4 : 7, scale: 1, rotation: 0, flipX: false,
        ...propArt(input, [isGreen ? 'well' : 'marketCross'], 'plaza-centrepiece', 'altar') });
      if (isGreen) {
        const oak = spots.find(p => Math.hypot(p.x - well.x, p.y - well.y) > 8);
        if (oak) output.push({ ...base, id: 'plaza-oak', type: 'prop', name: 'Old Oak', x: oak.x, y: oak.y, w: 11, h: 11, scale: 1, rotation: random() * 6, flipX: false,
          ...propArt(input, ['tree'], 'plaza-oak', 'tree') });
      } else {
        for (const [si, ang] of [0.4, 1.9, 3.5, 5.1].entries()) {
          const sp = { x: well.x + Math.cos(ang) * 11, y: well.y + Math.sin(ang) * 11 };
          if (plazaParts.some(r => pointInPolygon(sp, r)) && constraintRoadDistance(sp) > 2.5) output.push({
            ...base, id: `city-stall-${si}`, type: 'prop', name: 'Market Stall', x: sp.x, y: sp.y, w: 3.5, h: 3.5, scale: 1, rotation: ang, flipX: false,
            ...propArt(input, ['marketStall'], `city-stall-${si}`, si % 2 === 0 ? 'table' : 'crate'),
          });
        }
      }
    }
    cityLabels.push({ ...base, id: 'city-label-plaza', type: 'label', text: squareName, x: hub.x, y: hub.y - PLAZA_RADIUS[scale] - 6, size: 15 });
    cityPlaces.push({
      ...base, id: 'place-square', type: 'place', name: squareName, category: 'landmark',
      ...(isGreen ? { notes: 'Common grazing, the well and every scrap of gossip in the parish.', gmNotes: `Trouble talk starts here: ${parent?.trouble ?? 'ask anyone at the well'}.` }
        : hooks.establishment('market', `the market reeve ${namer.person()}`)),
      entityIds: plazaIds, layerTier: 'focus', activeHours: { morning: true, day: true, evening: true, night: false },
    });
  }
  // Pedestrian cut-through alleys in large blocks & garden blocks + plateau stairs facing adjacent roads
  const alleyW = Math.max(1.8, params.streetWidth * 0.38);
  const alleyPad = alleyW / 2 + 0.4;
  for (const [index, polygon] of blocks.entries()) {
    const polyArea = area(polygon);
    if (polyArea < 650 || !inTownPoly(polygon)) continue;
    const outer = cleanRing(polygon[0]!);
    if (outer.length < 3) continue;
    const frame = orientedFrame(outer);
    const uMid = (frame.uMin + frame.uMax) / 2;
    const reach = frame.spanMinor + 10;
    const alleyLine = [
      { x: frame.ux * uMid - frame.vx * reach, y: frame.uy * uMid - frame.vy * reach },
      { x: frame.ux * uMid + frame.vx * reach, y: frame.uy * uMid + frame.vy * reach },
    ];
    const bBox = bboxFromPoints(outer)!;
    const paddedBox = { minX: bBox.minX - alleyPad, minY: bBox.minY - alleyPad, maxX: bBox.maxX + alleyPad, maxY: bBox.maxY + alleyPad };
    const nearbyBuildings = occupied.filter((o) => boxesIntersect(o.box, paddedBox));
    const paddedKeepouts = nearbyBuildings.map((o) =>
      union([toPolygons([o.rings]), bufferLine(o.rings[0]!, alleyPad, true)]),
    );
    const openSpace = paddedKeepouts.length
      ? fromPolygons(clipping.difference(toPolygons([polygon]), union(paddedKeepouts)))
      : [polygon];
    const rawBuildingsUnion = nearbyBuildings.length ? union(nearbyBuildings.map((o) => toPolygons([o.rings]))) : [];
    const clippedAlleys = clipLine(alleyLine, openSpace).filter(
      (seg) =>
        Math.hypot(seg[seg.length - 1]!.x - seg[0]!.x, seg[seg.length - 1]!.y - seg[0]!.y) >= 12
        && (!rawBuildingsUnion.length || !clipping.intersection(bufferLine(seg, alleyW / 2), rawBuildingsUnion).length),
    );
    for (const [ai, pts] of clippedAlleys.slice(0, 2).entries()) {
      output.push({
        ...base,
        id: `alley-${index}-${ai}`,
        type: 'path',
        role: 'trail',
        routeTier: 'track',
        name: 'Cut-through Alley',
        points: pts,
        width: alleyW,
        closed: false,
      });
    }
  }
  for (const [pi, plateau] of plateaus.entries()) {
    const ring = plateau.rings[0];
    if (!ring || ring.length < 3) continue;
    let bestPt: Point | null = null;
    let bestD = 22;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = roadDistance(mid);
      if (d < bestD) { bestD = d; bestPt = mid; }
    }
    if (bestPt) {
      output.push({
        ...base, id: `plateau-stairs-${pi}`, type: 'portal', name: 'Terrace Steps',
        x: bestPt.x, y: bestPt.y, targetMapId: 'unlinked', connectorKind: 'stairsUp', elevationDelta: 1,
      });
    }
  }

  // Unbuilt rural outskirt agricultural parcels (role:'land' avoids breaking district street-adjacency invariants)
  const emitted = new Set(output.map(e => e.id));
  const fields = blockInfo.filter(f => !f.core && f.a >= 420 && !emitted.has(`block-${f.idx}`));
  const fits = (rings: Point[][], within: Point[][]) => {
    const shape = toPolygons([rings]), box = bboxFromPoints(rings[0]!)!;
    return !clipping.difference(shape, toPolygons([within])).length && !clipping.intersection(shape, wallMask).length
      && !occupied.some(o => boxesIntersect(o.box, box) && clipping.intersection(shape, toPolygons([o.rings])).length > 0)
      && !roadBuffers.some(r => boxesIntersect(r.box, box) && clipping.intersection(shape, r.mask).length > 0);
  };
  // A few farmsteads on roadside fields just beyond town.
  const farms: Point[] = [];
  for (const field of hasCore ? [...fields].sort((a, b) => a.d - b.d) : []) {
    if (farms.length >= { hamlet: 1, village: 4, town: 5, city: 5 }[scale]) break;
    if (field.a < 2500) continue;
    const ring = cleanRing(field.poly[0]!);
    const edge = ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length]! })).map(e => ({ ...e, len: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), mid: { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 } }))
      .filter(e => e.len >= 30 && roadDistance(e.mid) <= 1 && hubDistance(e.mid) > coreR + 40 && !farms.some(f => Math.hypot(f.x - e.mid.x, f.y - e.mid.y) < 120))
      .sort((p, q) => q.len - p.len)[0];
    if (!edge) continue;
    const u = { x: (edge.b.x - edge.a.x) / edge.len, y: (edge.b.y - edge.a.y) / edge.len };
    let n = { x: -u.y, y: u.x };
    if (!pointInPolygon({ x: edge.mid.x + n.x, y: edge.mid.y + n.y }, field.poly)) n = { x: -n.x, y: -n.y };
    const house = rect({ x: edge.mid.x - u.x * 12 + n.x * 5, y: edge.mid.y - u.y * 12 + n.y * 5 }, u, n, 11, 8);
    const barn = rect({ x: edge.mid.x + u.x * 3 + n.x * 7, y: edge.mid.y + u.y * 3 + n.y * 7 }, u, n, 15, 9);
    if (!fits(house, field.poly)) continue;
    occupied.push({ rings: house, box: bboxFromPoints(house[0]!)! });
    output.push({ ...base, id: `farm-${farms.length}`, type: 'area', role: 'building', name: namer.farm(), rings: house, fill: '#8d5a40', roofShape: 'gable' });
    if (fits(barn, field.poly)) {
      occupied.push({ rings: barn, box: bboxFromPoints(barn[0]!)! });
      const id = `barn-${farms.length}`;
      const texture = roofTexture(input, ['barnRoof'], id);
      output.push({ ...base, id, type: 'area', role: 'building', name: 'Barn', rings: barn, fill: '#7a5a3c', roofShape: 'gable',
        ...(texture ? { texture } : {}) });
    }
    farms.push(edge.mid);
  }
  // Fields are parcelled by hedgerows so the countryside reads as farmland, not as giant blocks.
  for (const { poly, idx } of fields) {
    for (const [k, rings] of splitFields(poly, 18000, random).entries())
      output.push({ ...base, id: `field-${idx}-${k}`, type: 'area', role: 'land', name: 'Agricultural Field', rings, fill: fieldPalette[(idx + k) % fieldPalette.length]! });
  }

  // Waterfront piers & moored boats along water edges bordering city land
  const waterConstraints = constraints.filter(
    (e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role === 'water',
  );
  const regBox = bboxFromPoints(region[0] ?? []);
  const quayPad = 48;
  const nearDistrict = (pt: Point) =>
    !regBox || (
      pt.x >= regBox.minX - quayPad &&
      pt.x <= regBox.maxX + quayPad &&
      pt.y >= regBox.minY - quayPad &&
      pt.y <= regBox.maxY + quayPad
    );
  const placedDocks: Array<{ m: Point; nIn: Point; nOut: Point; tx: number; ty: number }> = [];
  let dockCount = 0;
  for (const wArea of waterConstraints) {
    const outer = wArea.rings[0] ?? [];
    for (let i = 0; i < outer.length && dockCount < 5; i++) {
      const a = outer[i]!;
      const b = outer[(i + 1) % outer.length]!;
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 18) continue;
      const steps = Math.max(1, Math.min(12, Math.floor(segLen / 65)));
      for (let s = 1; s <= steps && dockCount < 5; s++) {
        const frac = s / (steps + 1);
        const m = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
        if (!nearDistrict(m)) continue;
        const tx = (b.x - a.x) / segLen;
        const ty = (b.y - a.y) / segLen;
        const nA = { x: -ty, y: tx };
        const inIsA = pointInPolygon({ x: m.x + nA.x * 6, y: m.y + nA.y * 6 }, wArea.rings);
        const nIn = inIsA ? nA : { x: -nA.x, y: -nA.y };
        const nOut = { x: -nIn.x, y: -nIn.y };
        const landPt = { x: m.x + nOut.x * 6, y: m.y + nOut.y * 6 };
        const pierTip = { x: m.x + nIn.x * 11, y: m.y + nIn.y * 11 };
        if (
          !nearDistrict(landPt) ||
          waterConstraints.some((w) => pointInPolygon(landPt, w.rings)) ||
          !pointInPolygon(pierTip, wArea.rings)
        ) {
          continue;
        }
        if (roadDistance(landPt) > 95) continue;
        if (occupied.some((o) => pointInPolygon(landPt, o.rings))) continue;
        if (placedDocks.some((d) => Math.hypot(d.m.x - m.x, d.m.y - m.y) < 26)) continue;
        placedDocks.push({ m, nIn, nOut, tx, ty });
        const dockIdx = dockCount++;
        const dockW = 24;
        const dockH = 6;
        output.push({
          ...base,
          id: `quay-${dockIdx}`,
          type: 'area',
          role: 'floor',
          floorMaterial: 'stone',
          name: 'Harbor Quay Apron',
          fill: '#9c927d',
          rings: [[
            { x: m.x + nOut.x * 14 - tx * 14, y: m.y + nOut.y * 14 - ty * 14 },
            { x: m.x - nOut.x * 1 - tx * 14, y: m.y - nOut.y * 1 - ty * 14 },
            { x: m.x - nOut.x * 1 + ty * 0 + tx * 14, y: m.y - nOut.y * 1 + ty * 14 },
            { x: m.x + nOut.x * 14 + tx * 14, y: m.y + nOut.y * 14 + ty * 14 },
          ]],
        });
        output.push({
          ...base,
          id: `dock-${dockIdx}`,
          type: 'prop',
          name: 'Harbor Pier',
          x: m.x + nIn.x * (dockW * 0.44),
          y: m.y + nIn.y * (dockW * 0.44),
          w: dockW,
          h: dockH,
          scale: 1,
          rotation: Math.atan2(nIn.y, nIn.x),
          flipX: false,
          ...propArt(input, ['dock'], `dock-${dockIdx}`, 'dock'),
        });
        // Quay cargo crates/barrels beside the pier
        output.push({
          ...base,
          id: `quay-cargo-${dockIdx}`,
          type: 'prop',
          name: 'Harbor Cargo',
          x: m.x + nOut.x * 3.5 + tx * 5.5,
          y: m.y + nOut.y * 3.5 + ty * 5.5,
          w: 3.2,
          h: 3.2,
          scale: 1,
          rotation: Math.atan2(ty, tx),
          flipX: false,
          ...propArt(input, [dockIdx % 2 === 0 ? 'crate' : 'barrel'], `quay-cargo-${dockIdx}`, dockIdx % 2 === 0 ? 'crate' : 'barrel'),
        });
        if (pointInPolygon({ x: m.x + nIn.x * 22 + tx * 7, y: m.y + nIn.y * 22 + ty * 7 }, wArea.rings)) {
          output.push({
            ...base,
            id: `boat-${dockIdx}`,
            type: 'prop',
            name: 'Moored Merchantman',
            x: m.x + nIn.x * 20 + tx * 7,
            y: m.y + nIn.y * 20 + ty * 7,
            w: 16,
            h: 6.2,
            scale: 1,
            rotation: Math.atan2(ty, tx) + (dockIdx % 2 ? 0.14 : -0.14),
            flipX: false,
            ...propArt(input, ['boat'], `boat-${dockIdx}`, 'boat'),
          });
        }
        if (dockIdx < 3) {
          const shipX = m.x + nIn.x * (46 + dockIdx * 18) + tx * (dockIdx === 1 ? -14 : 12);
          const shipY = m.y + nIn.y * (46 + dockIdx * 18) + ty * (dockIdx === 1 ? -14 : 12);
          if (pointInPolygon({ x: shipX, y: shipY }, wArea.rings)) {
            output.push({
              ...base,
              id: `vessel-${dockIdx}`,
              type: 'prop',
              name: dockIdx === 0 ? 'Galleon' : 'Harbor Cog',
              x: shipX,
              y: shipY,
              w: 22,
              h: 8.5,
              scale: 1,
              rotation: Math.atan2(ty, tx) + (dockIdx - 1) * 0.45,
              flipX: false,
              ...propArt(input, ['boat'], `vessel-${dockIdx}`, 'boat'),
            });
          }
        }
        if (dockIdx === 0) {
          cityLabels.push({
            ...base,
            id: 'city-label-quays',
            type: 'label',
            text: 'Harbor Quays',
            x: m.x + nIn.x * 48,
            y: m.y + nIn.y * 48 - 18,
            size: 15,
          });
        }
      }
    }
  }
  // Connect docks with a coastal Harbor Wharf Road + waterfront dockhouses/customs warehouses along the land edge.
  if (placedDocks.length >= 2) {
    const quayRoadPts = placedDocks.map((d) => ({ x: d.m.x + d.nOut.x * 13, y: d.m.y + d.nOut.y * 13 }));
    const quayRoadW = Math.min(params.streetWidth, 5.5);
    const buildingsMask = occupied.length ? union(occupied.map((o) => toPolygons([o.rings]))) : [];
    const quayClipPolys = buildingsMask.length
      ? fromPolygons(clipping.difference(toPolygons([region]), buildingsMask))
      : [region];
    const addedQuayRoadBuffers: Array<{ mask: MultiPolygon; box: { minX: number; minY: number; maxX: number; maxY: number } }> = [];
    for (const segPts of clipLine(quayRoadPts, quayClipPolys)) {
      if (segPts.length < 2) continue;
      output.push({
        ...base,
        id: `harbor-road-${output.length}`,
        type: 'path',
        role: 'road',
        name: 'Harbor Quays Road',
        points: segPts,
        width: quayRoadW,
        closed: false,
      });
      const xs = segPts.map((p) => p.x), ys = segPts.map((p) => p.y), pad = quayRoadW / 2 + 0.5;
      addedQuayRoadBuffers.push({
        mask: bufferLine(segPts, quayRoadW / 2),
        box: { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad },
      });
    }
    const dockhouseNames = ['Customs House', 'Salt Warehouse', 'Fishmonger Wharf', 'Shipwright Shed', 'Sailor Inn'];
    const allRoadMasksNow = [...roadBuffers, ...addedQuayRoadBuffers];
    for (const [di, d] of placedDocks.entries()) {
      const cx = d.m.x + d.nOut.x * 24;
      const cy = d.m.y + d.nOut.y * 24;
      const hw = 7.5, hh = 5.5;
      const cand: Point[][] = [[
        { x: cx - d.tx * hw - d.nOut.x * hh, y: cy - d.ty * hw - d.nOut.y * hh },
        { x: cx + d.tx * hw - d.nOut.x * hh, y: cy + d.ty * hw - d.nOut.y * hh },
        { x: cx + d.tx * hw + d.nOut.x * hh, y: cy + d.ty * hw + d.nOut.y * hh },
        { x: cx - d.tx * hw + d.nOut.x * hh, y: cy - d.ty * hw + d.nOut.y * hh },
      ]];
      const shape = toPolygons([cand]);
      const box = bboxFromPoints(cand[0]!)!;
      const fitsRegion = !clipping.difference(shape, toPolygons([region])).length;
      const hitsWater = waterConstraints.some((w) => clipping.intersection(shape, toPolygons([w.rings])).length > 0);
      const hitsWall = clipping.intersection(shape, wallMask).length > 0;
      const hitsBld = occupied.some((o) => boxesIntersect(o.box, box) && clipping.intersection(shape, toPolygons([o.rings])).length > 0);
      const hitsRoad = allRoadMasksNow.some((r) => boxesIntersect(r.box, box) && clipping.intersection(shape, r.mask).length > 0);
      if (fitsRegion && !hitsWater && !hitsWall && !hitsBld && !hitsRoad) {
        const treePadBox = { minX: box.minX - 4, minY: box.minY - 4, maxX: box.maxX + 4, maxY: box.maxY + 4 };
        for (let oi = output.length - 1; oi >= 0; oi--) {
          const prev = output[oi]!;
          if (prev.type === 'prop' && prev.id.startsWith('city-tree-') && prev.x >= treePadBox.minX && prev.x <= treePadBox.maxX && prev.y >= treePadBox.minY && prev.y <= treePadBox.maxY) {
            output.splice(oi, 1);
          }
        }
        occupied.push({ rings: cand, box });
        output.push({
          ...base,
          id: `building-${buildingCount++}`,
          type: 'area',
          role: 'building',
          name: dockhouseNames[di % dockhouseNames.length]!,
          rings: cand,
          fill: ['#7d543e', '#65594c', '#8c533c', '#5d656b', '#876342'][di % 5]!,
          roofShape: di % 2 === 0 ? 'hip' : 'gable',
        });
      }
    }
  }

  // Undercity sewer runs mirrored strictly inside major arterial street centerlines (towns and cities only)
  const majorRoads = scale === 'town' || scale === 'city' ? output
    .filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road' && e.points.length >= 2)
    .sort((a, b) => b.width - a.width)
    .slice(0, 6) : [];
  let manholeCount = 0;
  for (const [si, road] of majorRoads.entries()) {
    output.push({
      ...base,
      id: `sewer-${si}`,
      type: 'path',
      role: 'road',
      routeTier: 'sewer',
      name: 'Undercity Drain',
      points: road.points,
      width: Math.max(1.2, Math.min(road.width * 0.42, 2.2)),
      closed: false,
    });
    if (manholeCount < 4) {
      const mp = road.points[Math.floor(road.points.length / 2)]!;
      if (pointInPolygon(mp, region) && !occupied.some((o) => pointInPolygon(mp, o.rings))) {
        const id = `manhole-${manholeCount++}`;
        output.push({
          ...base,
          id,
          type: 'prop',
          name: 'Sewer Grate',
          x: mp.x,
          y: mp.y,
          w: 2.4,
          h: 2.4,
          scale: 1,
          rotation: 0,
          flipX: false,
          ...propArt(input, ['sewerGrate'], id, 'manhole'),
        });
        // A city's first grate is a way into the undercity.
        if (scale === 'city' && manholeCount === 1) {
          const hook = hooks.site('lair', band);
          output.push({ ...base, id: 'sewer-entrance', type: 'portal', name: 'Sewer Entrance', x: mp.x, y: mp.y, targetMapId: 'unlinked', connectorKind: 'stairsDown', elevationDelta: -1 });
          cityPlaces.push({ ...base, id: 'place-sewers', type: 'place', name: 'The Undercity', category: 'lair', notes: 'Brick drains under the main streets, big enough to walk bent double.',
            gmNotes: hook.gmNotes, stockingRole: hook.stockingRole, entityIds: ['manhole-0', 'sewer-entrance'], layerTier: 'belligerent', activeHours: { morning: true, day: true, evening: true, night: true } });
          localSites.push({ kind: 'lair', name: 'the Undercity', p: mp });
        }
      }
    }
  }

  // Inland river & canal bridges where streets cross water constraints
  const waterPaths = allConstraints.filter(
    (e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'river',
  );
  const placedBridges: Point[] = [];
  for (const road of output.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road' && e.routeTier !== 'sewer')) {
    for (const [ei, endPt] of [road.points[0]!, road.points[road.points.length - 1]!].entries()) {
      const otherPt = ei === 0 ? road.points[1]! : road.points[road.points.length - 2]!;
      const segLen = Math.hypot(endPt.x - otherPt.x, endPt.y - otherPt.y) || 1;
      const ux = (endPt.x - otherPt.x) / segLen, uy = (endPt.y - otherPt.y) / segLen;
      const probeNear = { x: endPt.x + ux * 4, y: endPt.y + uy * 4 };
      const inWaterArea = waterConstraints.some((w) => pointInPolygon(probeNear, w.rings));
      const overWaterPath = waterPaths.some((wp) =>
        wp.points.slice(1).some((b, i) => distanceToSegment(probeNear, wp.points[i]!, b) <= wp.width * 0.65),
      );
      if (!inWaterArea && !overWaterPath) continue;
      // Search ahead along street tangent for opposite dry bank within 42m
      for (let span = 8; span <= 42; span += 4) {
        const farBank = { x: endPt.x + ux * span, y: endPt.y + uy * span };
        const stillWet = waterConstraints.some((w) => pointInPolygon(farBank, w.rings))
          || waterPaths.some((wp) => wp.points.slice(1).some((b, i) => distanceToSegment(farBank, wp.points[i]!, b) <= wp.width * 0.55));
        if (!stillWet && pointInPolygon(farBank, region)) {
          const mid = { x: (endPt.x + farBank.x) / 2, y: (endPt.y + farBank.y) / 2 };
          if (placedBridges.every((p) => Math.hypot(p.x - mid.x, p.y - mid.y) >= 24)) {
            placedBridges.push(mid);
            const id = `city-bridge-${placedBridges.length}`;
            output.push({
              ...base, id, type: 'prop', name: 'Stone River Bridge',
              x: mid.x, y: mid.y, w: span + 3, h: Math.max(4.5, road.width * 0.9),
              scale: 1, rotation: Math.atan2(uy, ux), flipX: false,
              ...propArt(input, ['bridge'], id, 'bridge'),
            });
          }
          break;
        }
      }
    }
  }
  if (dockCount > 0) {
    cityPlaces.push({
      ...base, id: 'place-harbor-quays', type: 'place', name: 'Harbor Quays', category: 'landmark',
      ...hooks.establishment('harbor', `harbourmaster ${namer.person()}`),
      entityIds: output.filter((e) => e.id.startsWith('quay-') || e.id.startsWith('dock-')).map((e) => e.id),
      layerTier: 'incidental',
      activeHours: { morning: true, day: true, evening: true, night: false },
    });
  }
  // Notable establishments: each scale's quota, each placed where it belongs, each with an owner, a secret and a job.
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const notables: Array<{ kind: Establishment; lot: Building; place: Extract<Entity, { type: 'place' }> }> = [];
  for (const kind of NOTABLES[scale]) {
    const site = NOTABLE_SITE[kind];
    const score = (p: Point): number => site === 'gate' ? entryDistance(p) : site === 'plaza' ? hubDistance(p)
      : site === 'water' && Number.isFinite(waterDistance(p)) ? waterDistance(p)
      : site === 'water' || site === 'edge' ? edgeDistance(p) : dist(p, wardSeed(site) ?? hub);
    const same = notables.filter(n => n.kind === kind).map(n => n.lot.c);
    const pick = lots.filter(l => !l.notable && (!l.fringe || site === 'water' || site === 'edge'))
      .map(l => ({ l, s: score(l.c) + random() * 15 + (same.some(c => dist(c, l.c) < 90) ? 400 : 0) }))
      .sort((a, b) => a.s - b.s)[0]?.l;
    if (!pick) break;
    pick.notable = kind;
    const owner = namer.person(), [given, family] = owner.split(' ') as [string, string];
    const name = kind === 'inn' || kind === 'tavern' ? namer.inn() : kind === 'shrine' ? `Chapel of St. ${given}`
      : kind === 'watch' || kind === 'guildhall' || kind === 'thieves' ? NOTABLE_TITLE[kind]! : `${family}'s ${NOTABLE_TITLE[kind]}`;
    // The den passes for an ordinary house on the player map; only its GM-only Place gives it away.
    if (kind !== 'thieves') {
      pick.entity.name = name;
      pick.entity.roofShape = 'hip';
      const role = kind === 'inn' || kind === 'tavern' ? 'innRoof' :
        kind === 'mill' ? 'millRoof' : kind === 'shrine' ? 'chapelRoof' : undefined;
      const texture = role ? roofTexture(input, [role], pick.entity.id) : undefined;
      if (texture) pick.entity.texture = texture;
    }
    const night = ['inn', 'tavern', 'watch', 'thieves', 'wizard'].includes(kind);
    const place: Extract<Entity, { type: 'place' }> = {
      ...base, id: `place-${pick.entity.id}`, type: 'place', name: kind === 'thieves' ? "Thieves' Den" : name,
      category: kind === 'thieves' ? 'hideout' : 'establishment', ...(kind === 'thieves' ? { gmOnly: true } : {}),
      ...hooks.establishment(kind, kind === 'watch' ? `Captain ${owner}` : owner), entityIds: [pick.entity.id],
      layerTier: kind === 'inn' || kind === 'tavern' ? 'focus' : kind === 'thieves' ? 'belligerent' : 'incidental',
      activeHours: { morning: !night || kind === 'inn', day: kind !== 'thieves', evening: true, night },
    };
    notables.push({ kind, lot: pick, place });
    cityPlaces.push(place);
    if (kind === 'thieves') localSites.push({ kind: 'travel', name: `a ${pick.entity.name} in ${wardAt(pick.c)?.name || 'the back lanes'}`, p: pick.c });
    if (kind === 'inn' || kind === 'tavern') cityLabels.push({ ...base, id: `city-label-${pick.entity.id}`, type: 'label', text: name, x: pick.c.x, y: pick.c.y - 9, size: 11 });
  }
  // Villages get one odd site out in the fields: a barrow, standing stones or a ruined tower.
  if (isGreen && hasCore) {
    const field = [...fields].filter(f => f.centred && f.d > coreR + 120 && roadDistance(f.c) > 25 && !farms.some(p => dist(p, f.c) < 60))
      .sort((a, b) => Math.abs(a.d - coreR - 200) - Math.abs(b.d - coreR - 200))[0];
    if (field) {
      const [kind, builtin] = ([['ruin', 'ruin'], ['sacred', 'altar'], ['stronghold', 'ruin']] as const)[Math.floor(random() * 3)]!;
      const name = namer.site(kind), ids = ['oddity'], hook = hooks.site(kind, band);
      output.push({ ...base, id: 'oddity', type: 'prop', name, x: field.c.x, y: field.c.y, w: 12, h: 12, scale: 1, rotation: 0, flipX: false, builtin });
      if (kind === 'sacred') for (let i = 0; i < 7; i++) {
        ids.push(`oddity-stone-${i}`);
        const id = `oddity-stone-${i}`;
        output.push({ ...base, id, type: 'prop', name: 'Standing Stone', x: field.c.x + Math.cos(i * .9) * 11, y: field.c.y + Math.sin(i * .9) * 11, w: 2.5, h: 2.5, scale: 1, rotation: 0, flipX: false,
          ...propArt(input, ['standingStone'], id, 'pillar') });
      }
      if (kind === 'ruin') {
        ids.push('oddity-stairs');
        output.push({ ...base, id: 'oddity-stairs', type: 'portal', name: 'Barrow Entrance', x: field.c.x, y: field.c.y + 8, targetMapId: 'unlinked', connectorKind: 'stairsDown', elevationDelta: -1 });
      }
      cityPlaces.push({ ...base, id: 'place-oddity', type: 'place', name, category: kind, notes: 'Locals plough around it and will not say why.', gmNotes: hook.gmNotes, stockingRole: hook.stockingRole, entityIds: ids, layerTier: 'focus' });
      cityLabels.push({ ...base, id: 'city-label-oddity', type: 'label', text: name, x: field.c.x, y: field.c.y - 16, size: 12 });
      localSites.push({ kind, name, p: field.c });
    }
  }
  // The town itself: adopted from the world when developed from it, else rolled here with a trait and a trouble.
  const townName = townPlace?.name ?? namer.town();
  const rank = (scale[0]!.toUpperCase() + scale.slice(1)) as 'City' | 'Town' | 'Village' | 'Hamlet';
  const townNotes = townPlace ? undefined : hooks.settlement(rank, band);
  const trouble = parent?.trouble ?? parseSettlement(townNotes)?.trouble;
  const rumours = [...(townPlace?.rumours ?? []), ...localSites.map(s => hooks.localRumour(s.kind, s.name, hub, s.p))];
  const taverns = notables.filter(n => n.kind === 'inn' || n.kind === 'tavern');
  rumours.forEach((r, i) => { const t = taverns[i % Math.max(1, taverns.length)]; if (t) (t.place.rumours ??= []).push(`Heard in ${t.place.name}: ${r}`); });
  if (townNotes) cityPlaces.push({ ...base, id: 'place-town', type: 'place', name: townName, category: 'Settlement', notes: townNotes, gmNotes: '',
    ...(taverns.length ? {} : { rumours }), entityIds: plazaIds });
  const clueAt = lots.filter(l => !l.notable && !l.fringe);
  const clue = clueAt[Math.floor(random() * clueAt.length)];
  if (trouble && clue) cityPlaces.push({ ...base, id: 'place-trouble', type: 'place', name: 'Where the trouble starts', category: 'hook', gmOnly: true,
    notes: '', gmNotes: `Trouble: ${trouble}. Here: ${hooks.troubleClue()}.`, entityIds: [clue.entity.id], layerTier: 'focus' });

  // Wire competing urban factions into PlaceEntity.factionLinks so settlements have immediate civic tension.
  const notableByPlaceId = new Map(notables.map((n) => [n.place.id, n.kind]));
  for (const place of cityPlaces) {
    if (place.type !== 'place') continue;
    const links: string[] = [];
    const kind = notableByPlaceId.get(place.id);
    if (place.id === 'place-keep' || kind === 'watch') {
      links.push(`Town Watch (${place.id === 'place-keep' ? 'Garrison & Command' : 'Patrol Post'})`);
    } else if (place.id === 'place-temple' || place.id === 'place-graveyard' || kind === 'shrine' || kind === 'healer') {
      links.push(`Temple Chapter (${place.id === 'place-temple' ? 'High Sanctuary' : 'Ward & Charity'})`);
    } else if (place.id === 'place-sewers' || kind === 'thieves') {
      links.push(`Thieves' Guild (${kind === 'thieves' ? 'Safe House' : 'Smuggling Network'})`);
      links.push('Town Watch (Rival Crackdown Target)');
    } else if (place.id === 'place-harbor-quays' || kind === 'guildhall' || kind === 'store' || kind === 'smithy' || kind === 'stables' || kind === 'mill' || kind === 'moneylender' || kind === 'tannery') {
      links.push(`Merchant Guild (${kind === 'guildhall' ? 'Charter Hall' : 'Taxed Trade'})`);
      if (place.id === 'place-harbor-quays') links.push("Thieves' Guild (Night Contraband)");
    } else if (kind === 'inn' || kind === 'tavern' || kind === 'bathhouse') {
      links.push('Merchant Guild (Caravan Patronage)', "Thieves' Guild (Whisper Broker)");
    } else if (kind === 'wizard' || kind === 'apothecary') {
      links.push('Temple Chapter (Watched Closely)');
    } else if (place.id === 'place-town') {
      links.push(
        'Town Watch (Gates & Curfew)',
        'Merchant Guild (Market Tolls)',
        'Temple Chapter (Civic Oaths)',
        "Thieves' Guild (Back-Alley Shadow)",
      );
      place.gmNotes = `${place.gmNotes ? `${place.gmNotes} ` : ''}Urban Factions: Town Watch and Merchant Guild dispute gate tolls while the Thieves' Guild works the alleys under the Temple Chapter's nose.`;
    }
    if (links.length) place.factionLinks = links;
  }
  cityLabels.push({ ...base, id: 'city-label-title', type: 'label', text: townName, x: hub.x, y: Math.max(rb.minY + 40, hub.y - (Number.isFinite(coreR) ? coreR : 0) - 30), size: 26 });
  for (const ward of wards.filter(w => w.kind !== 'market')) {
    const homes = lots.filter(l => l.ward === ward.kind && wardAt(l.c) === ward);
    if (homes.length) cityLabels.push({ ...base, id: `city-label-ward-${ward.kind}-${wards.indexOf(ward)}`, type: 'label', text: ward.name,
      x: homes.reduce((s, l) => s + l.c.x, 0) / homes.length, y: homes.reduce((s, l) => s + l.c.y, 0) / homes.length, size: 13 });
  }
  // Roads leaving the sheet say where they lead.
  const exits = new Set<string>();
  for (const road of allConstraintsRoads) {
    const ends = road.name?.match(/^(.+)–(.+) Road$/)?.slice(1) ?? road.name?.match(/^(.+) Road$/)?.slice(1) ?? [];
    const dest = ends.find(n => n !== townName);
    if (!dest || exits.has(dest)) continue;
    for (const p of [road.points[0]!, road.points.at(-1)!]) {
      if (p.x - rb.minX > 30 && rb.maxX - p.x > 30 && p.y - rb.minY > 30 && rb.maxY - p.y > 30) continue;
      const d = hubDistance(p) || 1, at = { x: p.x + (hub.x - p.x) / d * 60, y: p.y + (hub.y - p.y) / d * 60 };
      cityLabels.push({ ...base, id: `city-label-exit-${exits.size}`, type: 'label', text: `to ${dest}`, x: at.x, y: at.y, size: 12 });
      exits.add(dest);
      break;
    }
  }

  // Separate nearby city labels so landmarks never overlap each other horizontally.
  for (let i = 0; i < cityLabels.length; i++) {
    const cur = cityLabels[i]!;
    if (cur.type !== 'label') continue;
    for (let j = 0; j < i; j++) {
      const prev = cityLabels[j]!;
      if (prev.type !== 'label') continue;
      const minDx = Math.max(cur.text.length, prev.text.length) * 6.5 + 16;
      if (Math.abs(cur.x - prev.x) < minDx && Math.abs(cur.y - prev.y) < 22) {
        cur.y += cur.y >= prev.y ? 22 : -22;
      }
    }
  }

  const square = surfaceTexture(input, [isGreen ? 'villageGreenTexture' : 'plazaTexture']);
  const field = surfaceTexture(input, ['fieldTexture']);
  const paving = surfaceTexture(input, ['stoneFloorTexture', 'floorTexture']);
  for (const entity of output) {
    if (entity.type === 'area') {
      const tile = entity.id.startsWith('plaza-') ? square :
        entity.id.startsWith('field-') ? field : entity.role === 'floor' ? paving : undefined;
      if (tile) entity.texture = tile;
    }
    if (entity.type === 'path' && (entity.role === 'cityWall' || (entity.role === 'road' && entity.routeTier !== 'sewer'))) {
      const roles = entity.role === 'cityWall' ? ['cityWallTexture'] :
        isGreen ? ['roadTexture', 'pathTexture'] : ['streetTexture', 'roadTexture', 'pathTexture'];
      const tile = surfaceTexture(input, roles, entity.width);
      if (tile) entity.texture = tile;
    }
  }

  // Put farmland underneath districts, streets above block fills, buildings above streets, and props/labels on top.
  return [
    ...output.filter(e=>e.type==='area'&&e.role==='land'),
    ...output.filter(e=>e.type==='area'&&e.role==='district'),
    ...output.filter(e=>e.type==='area'&&e.role==='floor'),
    ...output.filter(e=>e.type==='path'),
    ...output.filter(e=>e.type==='area'&&e.role==='building'),
    ...output.filter(e=>e.type==='door'||e.type==='prop'||e.type==='portal'),
    ...cityPlaces,
    ...cityLabels,
  ];
}

registerGenerator({type:'city',title:'City / district',params:CityParamsSchema,generate:generateCity});
