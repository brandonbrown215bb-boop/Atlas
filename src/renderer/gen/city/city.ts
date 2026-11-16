import { isWorldSymbol, signedArea } from '../../geom/geography';
import type { MultiPolygon } from 'polygon-clipping';
import clipping from '../../geom/polygonClipping';
import { z } from 'zod';
import { DistrictProfileSchema, type DistrictProfile, type Entity, type Point } from '../../model/schema';
import { bboxFromPoints, boxesIntersect, distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { fromPolygons, rectRing, toPolygons } from '../../geom/fog';
import { clipOutside } from '../../geom/clipOutside';
import { registerGenerator, type GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';

export const CityParamsSchema = DistrictProfileSchema.extend({
  scale: z.enum(['hamlet', 'village', 'town', 'city']).default('town'),
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

/** Drawn constraints first; oriented/radial streets form blocks, then street-facing lots and ribbon outskirts are built. */
export function generateCity(input: GeneratorInput<CityParams>): Entity[] {
  const {region,params,constraints} = input, random = mulberry32(input.seed);
  if (area(region) > 16_000_000) throw new Error('Choose a city footprint no larger than 16 square kilometres.');
  if (area(region)<900) throw new Error('City footprint needs at least 900 square metres.');
  if (params.scale === 'hamlet') {
    const rb = bboxFromPoints(region[0]!)!;
    const cx = (rb.minX + rb.maxX) / 2, cy = (rb.minY + rb.maxY) / 2;
    const span = Math.min(rb.maxX - rb.minX, rb.maxY - rb.minY);
    const laneLen = Math.min(span * 0.42, 110);
    const ang = (random() - 0.5) * 0.8;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const nx = -uy, ny = ux;
    const lane: Point[] = [
      { x: cx - ux * laneLen, y: cy - uy * laneLen },
      { x: cx + (random() - 0.5) * 10, y: cy + (random() - 0.5) * 10 },
      { x: cx + ux * laneLen, y: cy + uy * laneLen },
    ].filter(p => pointInPolygon(p, region));
    const hamletOut: Entity[] = [];
    if (lane.length >= 2) {
      hamletOut.push({ ...base, id: 'hamlet-lane', type: 'path', role: 'road', name: 'Village Lane', points: lane, width: Math.min(params.streetWidth, 4.5), closed: false });
    }
    hamletOut.push({ ...base, id: 'hamlet-well', type: 'prop', name: 'Village Well', x: cx, y: cy, w: 4, h: 4, scale: 1, rotation: 0, flipX: false, builtin: 'altar' });
    const names = [
      "Bailiff's Cottage & Store", "Milkmaid's Barn & Dairy", 'Smithy & Wheelwright',
      'Wayside Tavern & Post', "Miller's House", 'Croft & Bakery', "Herbalist's Hut", "Shepherd's Fold",
    ];
    const targetCount = Math.max(4, Math.min(8, Math.round(4 + params.density * 4)));
    const occupied: Array<{ rings: Point[][]; box: ReturnType<typeof bboxFromPoints> & {} }> = [];
    const roofs = input.theme.roof ?? [];
    for (let i = 0; i < targetCount; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const t = ((Math.floor(i / 2) + 0.5) / Math.ceil(targetCount / 2) - 0.5) * 1.6;
      const distAlong = t * laneLen;
      const setback = 9 + random() * 6;
      const bx = cx + ux * distAlong + nx * side * setback;
      const by = cy + uy * distAlong + ny * side * setback;
      const bw = 9 + random() * 5, bh = 7 + random() * 4;
      const rings: Point[][] = [[
        { x: bx - ux * bw / 2 - nx * bh / 2, y: by - uy * bw / 2 - ny * bh / 2 },
        { x: bx + ux * bw / 2 - nx * bh / 2, y: by + uy * bw / 2 - ny * bh / 2 },
        { x: bx + ux * bw / 2 + nx * bh / 2, y: by + uy * bw / 2 + ny * bh / 2 },
        { x: bx - ux * bw / 2 + nx * bh / 2, y: by - uy * bw / 2 + ny * bh / 2 },
      ]];
      if (!rings[0]!.every(p => pointInPolygon(p, region))) continue;
      const box = bboxFromPoints(rings[0]!)!;
      const shape = toPolygons([rings]);
      if (occupied.some(o => boxesIntersect(o.box, box) && clipping.intersection(shape, toPolygons([o.rings])).length > 0)) continue;
      occupied.push({ rings, box });
      const roof = roofs.length ? roofs[Math.floor(random() * roofs.length)] : undefined;
      const bName = names[i % names.length]!;
      hamletOut.push({
        ...base, id: `building-${i}`, type: 'area', role: 'building', name: bName, rings,
        fill: ['#924c38', '#785942', '#a8864e', '#875641'][i % 4]!,
        ...(roof && !roof.startsWith('builtin:') ? { texture: { assetId: roof, metersPerPixel: 1, fitToArea: true } } : {}),
      });
      hamletOut.push({ ...base, id: `hamlet-label-${i}`, type: 'label', text: bName, x: bx, y: by - bh / 2 - 4, size: 12 });
    }
    return hamletOut;
  }
  const allConstraintsRoads = constraints.filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && (e.role === 'road' || e.role === 'trail'));
  const output: Entity[] = [], streets: Street[] = [];
  const autoWalls: Array<Extract<Entity, { type: 'path' }>> = [];
  const autoGates: Array<Extract<Entity, { type: 'door' }>> = [];
  const wallRingsForMask: Point[][][] = [];
  const wantWall = params.walls === 'walled' || (params.walls === 'auto' && params.scale !== 'village' && area(region) > 250_000);
  if (wantWall && !constraints.some(e => (e.type === 'path' && e.role === 'cityWall') || e.type === 'wall' || (e.type === 'area' && e.role === 'district'))) {
    const rb = bboxFromPoints(region[0]!)!;
    const cx = (rb.minX + rb.maxX) / 2, cy = (rb.minY + rb.maxY) / 2;
    const sides = 16, rot = (random() - 0.5) * 0.6;
    const phase2 = random() * Math.PI * 2, phase3 = random() * Math.PI * 2;
    const radialFactors = Array.from({ length: sides }, (_, i) => {
      const a = rot + (i / sides) * Math.PI * 2;
      const harmonic = 1 + 0.14 * Math.cos(2 * a + phase2) + 0.09 * Math.sin(3 * a + phase3);
      return { a, rad: harmonic * (0.90 + random() * 0.14) };
    });
    let wallPts: Point[] = [];
    for (const shrink of [0.34, 0.28, 0.22, 0.16]) {
      const rx = (rb.maxX - rb.minX) * shrink, ry = (rb.maxY - rb.minY) * shrink;
      const candidate = radialFactors.map(({ a, rad }) => ({ x: cx + Math.cos(a) * rx * rad, y: cy + Math.sin(a) * ry * rad }));
      if (candidate.every(p => pointInPolygon(p, region))) { wallPts = candidate; break; }
    }
    if (wallPts.length === sides) {
      wallRingsForMask.push([wallPts]);
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
  const obstacles=union(obstacleParts), wallMask=union(wallParts);
  const usable=clipping.difference(toPolygons([region]),obstacles);
  const ground=fromPolygons(usable);
  if (!ground.length) throw new Error(`No buildable ground remains: ${waters.length} water areas, ${fixed.length} fixed buildings and ${constraints.filter(e=>e.type==='prop'&&!isWorldSymbol(e)).length} physical props overlap this district. Choose open land or edit the highlighted constraints.`);
  const profileAt = (p: Point): DistrictProfile => districts.find(d=>pointInPolygon(p,d.rings))?.district ?? params;
  const roadDistance = (p: Point) => Math.min(Infinity,...streets.flatMap(s=>s.points.slice(1).map((b,i)=>distanceToSegment(p,s.points[i]!,b)-s.width/2)));
  const addStreet = (line: Point[], polygon: Point[][], width: number) => {
    for (const points of clipLine(line,[polygon])) {
      streets.push({points,width});
      output.push({...base,id:`street-${output.length}`,type:'path',role:'road',name:'Street',points,width,closed:false});
    }
  };
  const walls = allConstraints.filter((e):e is Extract<Entity,{type:'path'}>=>e.type==='path'&&e.role==='cityWall'&&e.closed);
  const wallInterior = union([...walls.map(w=>toPolygons([[w.points]])), ...wallRingsForMask.map(r=>toPolygons([r]))]);
  const hasAnyCityWall = walls.length > 0 || wallRingsForMask.length > 0;
  const inTown = (p: Point) => !hasAnyCityWall||walls.some(w=>pointInPolygon(p,[w.points]))||wallRingsForMask.some(r=>pointInPolygon(p,r));
  const inTownPoly = (polygon: Point[][]) => !hasAnyCityWall||clipping.intersection(toPolygons([polygon]),wallInterior).length>0;
  // Empty standalone towns get gate arteries and slightly angled radial avenues meeting at a central hub.
  if (!streets.some(s=>clipLine(s.points,ground).length)) {
    const townGround = hasAnyCityWall ? fromPolygons(clipping.intersection(usable,wallInterior)) : ground;
    const townRing = walls[0]?.points ?? wallRingsForMask[0]?.[0];
    for (const p of ground) {
      const b=bboxFromPoints((townRing?townRing:p[0])!)!, w=b.maxX-b.minX, h=b.maxY-b.minY;
      const fullBox=bboxFromPoints(p[0]!)!, reach=Math.hypot(fullBox.maxX-fullBox.minX,fullBox.maxY-fullBox.minY)+20;
      const hub={x:(b.minX+b.maxX)/2+(random()-.5)*w*.12,y:(b.minY+b.maxY)/2+(random()-.5)*h*.12};
      for (const gate of gates) {
        const gm={x:(gate.a.x+gate.b.x)/2,y:(gate.a.y+gate.b.y)/2};
        const dx=gate.b.x-gate.a.x,dy=gate.b.y-gate.a.y,len=Math.hypot(dx,dy)||1;
        let nx=-dy/len,ny=dx/len;
        if (hasAnyCityWall) {
          if (inTown({x:gm.x+nx*6,y:gm.y+ny*6})) { nx=-nx; ny=-ny; }
          addStreet([{x:gm.x-nx*6,y:gm.y-ny*6},{x:gm.x+nx*reach,y:gm.y+ny*reach}],p,params.streetWidth*1.5);
          addStreet([{x:gm.x+nx*4,y:gm.y+ny*4},hub],p,params.streetWidth*1.4);
        } else {
          addStreet([{x:gm.x-nx*reach,y:gm.y-ny*reach},{x:gm.x+nx*reach,y:gm.y+ny*reach}],p,params.streetWidth*1.5);
        }
      }
      const baseAngle=(random()-.5)*.42;
      for (let arm=0;arm<4;arm++) {
        const angle=baseAngle+arm*(Math.PI/2)+(random()-.5)*.22;
        const cosA=Math.cos(angle), sinA=Math.sin(angle);
        const curve=(random()-.5)*Math.min(w,h)*.09;
        const mid={x:hub.x+cosA*(reach*.38)-sinA*curve,y:hub.y+sinA*(reach*.38)+cosA*curve};
        const ray=[hub,mid,{x:hub.x+cosA*reach,y:hub.y+sinA*reach}];
        if (hasAnyCityWall) {
          for (const tp of townGround) addStreet(ray,tp,params.streetWidth*1.4);
        } else {
          addStreet(ray,p,params.streetWidth*1.4);
        }
      }
    }
  }
  const outerGround = hasAnyCityWall ? fromPolygons(clipping.difference(usable,wallInterior)) : [];
  const fringeArteries: Street[] = hasAnyCityWall ? streets.flatMap(s=>clipLine(s.points,outerGround).map(points=>({points,width:s.width}))) : [...streets];
  const arteryDistance = (p: Point) => Math.min(Infinity,...fringeArteries.flatMap(s=>s.points.slice(1).map((b,i)=>distanceToSegment(p,s.points[i]!,b)-s.width/2)));
  const polyArteryDistance = (ring: Point[]) => Math.min(...ring.map((p,i)=>{const q=ring[(i+1)%ring.length]!;return Math.min(arteryDistance(p),arteryDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2}));}));
  const roadMask=union(streets.map(s=>bufferLine(s.points,s.width/2)));
  let initial=fromPolygons(clipping.difference(usable,roadMask));
  for (const wall of walls) {
    const mask=toPolygons([[wall.points]]);
    initial=initial.flatMap(p=>[...fromPolygons(clipping.intersection(toPolygons([p]),mask)),...fromPolygons(clipping.difference(toPolygons([p]),mask))]);
  }
  // District borders are lot boundaries, not extra walls or roads.
  for(const district of districts) {
    const mask=toPolygons([district.rings]);
    initial=initial.flatMap(p=>[...fromPolygons(clipping.intersection(toPolygons([p]),mask)),...fromPolygons(clipping.difference(toPolygons([p]),mask))]);
  }
  const blocks: Point[][][] = [];
  let cuts=0;
  const queue: Array<{ polygon: Point[][]; depth: number }> = initial.map(polygon => ({ polygon, depth: 0 }));
  for (let qi = 0; qi < queue.length; qi++) {
    const { polygon, depth } = queue[qi]!;
    const b=bboxFromPoints(polygon[0]!)!;
    const center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2}, profile=profileAt(center);
    const fringe=!inTownPoly(polygon), distToArtery=fringe?polyArteryDistance(polygon[0]!):0;
    const centerDistToArtery=fringe?arteryDistance(center):0;
    const hasRoad=polygon[0]!.some((p,i)=>{const q=polygon[0]![(i+1)%polygon[0]!.length]!;return roadDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2})<.5;});
    if (fringe && (!params.fringe || distToArtery > params.blockSize * 0.9 || (hasAnyCityWall && depth >= 1 && centerDistToArtery > params.blockSize * 1.15)) && (depth >= 1 || hasRoad)) { blocks.push(polygon); continue; }
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
  let placedPlaza = false;
  const cityBounds = bboxFromPoints(region[0]!)!;
  const cityMid = { x: (cityBounds.minX + cityBounds.maxX) / 2, y: (cityBounds.minY + cityBounds.maxY) / 2 };
  const isLargeCity = area(region) > 250_000;
  const innerCandidates = isLargeCity
    ? blocks
        .map((poly, idx) => {
          const b = bboxFromPoints(poly[0]!)!;
          const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
          return { idx, poly, b, c, a: area(poly), d: Math.hypot(c.x - cityMid.x, c.y - cityMid.y) };
        })
        .filter(x => inTownPoly(x.poly) && x.a >= 500 && pointInPolygon(x.c, x.poly))
    : [];
  const plazaCand = innerCandidates.sort((a, b) => a.d - b.d)[0];
  const plazaIdx = plazaCand?.idx ?? -1;
  const keepCand = innerCandidates.filter(x => x.idx !== plazaIdx && x.a >= 800).sort((a, b) => b.a - a.a)[0];
  const keepIdx = keepCand?.idx ?? -1;
  const templeIdx = innerCandidates.filter(x =>
    x.idx !== plazaIdx && x.idx !== keepIdx && x.a >= 500
    && (!plazaCand || Math.hypot(x.c.x - plazaCand.c.x, x.c.y - plazaCand.c.y) > 100)
    && (!keepCand || Math.hypot(x.c.x - keepCand.c.x, x.c.y - keepCand.c.y) > 100)
  ).sort((a, b) => a.d - b.d)[0]?.idx ?? -1;
  const fieldPalette = ['#7c8f59', '#88985d', '#989a64', '#718452'];
  const cityLabels: Entity[] = [];
  const cityPlaces: Extract<Entity, { type: 'place' }>[] = [];

  for (const [index,polygon] of blocks.entries()) {
    if (area(polygon)<80 || !polygon[0]!.some((p,i)=>{const q=polygon[0]![(i+1)%polygon[0]!.length]!;return roadDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2})<.5;})) continue;
    const b=bboxFromPoints(polygon[0]!)!, center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
    const profile=profileAt(center), outer=cleanRing(polygon[0]!);
    const fringe=!inTownPoly(polygon), distToArtery=fringe?polyArteryDistance(outer):0;
    const isPlaza = index === plazaIdx;
    const isKeep = index === keepIdx;
    const isTemple = index === templeIdx;
    const garden=profile.density===0 || (fringe && (!params.fringe || distToArtery > params.lotDepth * 2.5)) || (!fringe && params.fringe && !isKeep && !isTemple && random()<.11);
    const blockFill = isPlaza
      ? '#cbbda0'
      : garden
        ? (fringe ? fieldPalette[index % fieldPalette.length]! : '#7c8f59')
        : '#b4a485';
    output.push({...base,id:`block-${index}`,type:'area',role:'district',name:isPlaza?'Market Square':isKeep?'High Keep':isTemple?'Temple Ward':garden?(fringe?'Market gardens':'Garden courtyard'):`Block ${index+1}`,
      rings:polygon,fill:blockFill,district:profile});

    if (isPlaza) {
      placedPlaza = true;
      output.push({
        ...base, id: `city-plaza-${index}`, type: 'prop', name: 'Town Square Monument',
        x: center.x, y: center.y, w: 9, h: 9, scale: 1, rotation: 0, flipX: false,
        builtin: 'altar',
      });
      for (const [si, ang] of [0.4, 1.9, 3.5, 5.1].entries()) {
        const sp = { x: center.x + Math.cos(ang) * 11, y: center.y + Math.sin(ang) * 11 };
        if (pointInPolygon(sp, polygon) && roadDistance(sp) >= 3.5) {
          output.push({
            ...base, id: `city-stall-${index}-${si}`, type: 'prop', name: 'Market Stall',
            x: sp.x, y: sp.y, w: 3.5, h: 3.5, scale: 1, rotation: ang, flipX: false,
            builtin: si % 2 === 0 ? 'table' : 'crate',
          });
        }
      }
      cityLabels.push({ ...base, id: 'city-label-plaza', type: 'label', text: 'Market Square', x: center.x, y: center.y, size: 17 });
      cityPlaces.push({
        ...base, id: 'place-market-square', type: 'place', name: 'Market Square', category: 'landmark',
        notes: 'Open stone plaza bustling with merchant stalls, town criers, and caravan wagons.',
        gmNotes: 'Hook: Cutpurses work the spice stalls at noon; an alderman seeks escorts for a delayed grain barge.',
        entityIds: [`block-${index}`, `city-plaza-${index}`],
        layerTier: 'focus',
        activeHours: { morning: true, day: true, evening: true, night: false },
      });
      continue;
    }

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
          name: isKeep ? 'High Keep' : 'Grand Temple', rings: cand,
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
              x: entryPt.x, y: entryPt.y, w: 4.5, h: 4.5, scale: 1, rotation: 0, flipX: false, builtin: 'altar',
            });
          }
        }
        cityLabels.push({
          ...base, id: isKeep ? 'city-label-keep' : 'city-label-temple', type: 'label',
          text: isKeep ? 'High Keep' : 'Grand Temple', x: cx, y: cy, size: 16,
        });
        cityPlaces.push({
          ...base, id: isKeep ? 'place-high-keep' : 'place-grand-temple', type: 'place',
          name: isKeep ? 'High Keep' : 'Grand Temple', category: isKeep ? 'stronghold' : 'sacred',
          notes: isKeep
            ? 'Fortified citadel commanding the town walls, garrison courtyard, and inner dungeon vaults.'
            : 'Vaulted nave and cloister bell-tower tending the town archives, ossuary, and healing shrine.',
          gmNotes: isKeep
            ? 'Watch patrols double at dusk; the under-bailey postern links to the old storm sewers.'
            : 'High Prelate withholds burial records from the western crypt unless a tithe or relic is returned.',
          entityIds: compoundIds,
          layerTier: isKeep ? 'belligerent' : 'focus',
          activeHours: { morning: true, day: true, evening: true, night: isKeep },
        });
        continue;
      }
    }

    if (garden) {
      // Place a central plaza monument in the innermost garden courtyard when near the hub.
      if (!fringe && !placedPlaza && Math.hypot(center.x - cityMid.x, center.y - cityMid.y) < params.blockSize * 2.5 && pointInPolygon(center, polygon) && roadDistance(center) >= 5) {
        placedPlaza = true;
        output.push({
          ...base, id: `city-plaza-${index}`, type: 'prop', name: 'Town Square Monument',
          x: center.x, y: center.y, w: 7, h: 7, scale: 1, rotation: 0, flipX: false,
          builtin: 'altar',
        });
      }
      // Scatter orchard rows in market gardens and park groves in garden courtyards, clear of roads.
      const step = fringe ? 24 : 16;
      const treeCap = fringe ? 8 : 8;
      const jitterFactor = fringe ? 0.18 : 0.52;
      let addedTrees = 0;
      for (let ty = b.minY + step / 2; ty < b.maxY && addedTrees < treeCap; ty += step) {
        for (let tx = b.minX + step / 2; tx < b.maxX && addedTrees < treeCap; tx += step) {
          const tp = { x: tx + (random() - 0.5) * step * jitterFactor, y: ty + (random() - 0.5) * step * jitterFactor };
          if (!pointInPolygon(tp, polygon) || roadDistance(tp) < 4) continue;
          if (placedPlaza && Math.hypot(tp.x - center.x, tp.y - center.y) < 7) continue;
          if (random() > (fringe ? 0.45 : 0.68)) continue;
          const sz = (fringe ? 8 : 6.5) + random() * 4;
          output.push({
            ...base, id: `city-tree-${index}-${addedTrees++}`, type: 'prop', name: fringe ? 'Orchard tree' : 'Park tree',
            x: tp.x, y: tp.y, w: sz, h: sz, scale: 1, rotation: random() * Math.PI * 2, flipX: random() < 0.5,
            builtin: 'tree',
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
        const ribbonDecay = fringe ? Math.max(0, 1 - arteryDistance(lotPoint) / (params.lotDepth * 3.2)) : 1;
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
        const roofs=input.theme[local.wealth>.65?'roofWealthy':'roof'] ?? input.theme.roof ?? [];
        const roof=roofs.length?roofs[Math.floor(random()*roofs.length)]:undefined;
        const buildingRoles = [
          'Inn', 'Tavern', 'Smithy', 'Bakery', 'General Store', 'Apothecary',
          'Temple', 'Guardhouse', 'Carpenter', 'Tailor', 'Warehouse', 'Shrine',
          'Townhouse', 'Townhouse', 'Cottage', 'Cottage', 'Cottage',
        ];
        const bRole = buildingRoles[buildingCount % buildingRoles.length]!;
        const bId = buildingCount++;
        output.push({...base,id:`building-${bId}`,type:'area',role:'building',name:`${bRole} ${bId + 1}`,rings,
          fill:colors[Math.floor(random()*colors.length)]!,...(height===undefined?{}:{elevation:height}),
          ...(bId % 3 === 0 ? { roofShape: 'hip' as const } : {}),
          ...(roof&&!roof.startsWith('builtin:')?{texture:{assetId:roof,metersPerPixel:1,fitToArea:true}}:{})});
        if (buildingCount>=8000) break;
      }
      if (buildingCount>=8000) break;
    }
    if (buildingCount>=8000) break;
  }
  if (!placedPlaza) {
    const innerBlocks = blocks
      .filter(poly => inTownPoly(poly) && area(poly) > 120)
      .map(poly => {
        const b = bboxFromPoints(poly[0]!)!;
        return { poly, b, center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } };
      })
      .sort((a, b) => Math.hypot(a.center.x - cityMid.x, a.center.y - cityMid.y) - Math.hypot(b.center.x - cityMid.x, b.center.y - cityMid.y));
    for (const blk of innerBlocks.slice(0, 8)) {
      const c = blk.center;
      const inBuilding = occupied.some(o => pointInPolygon(c, o.rings));
      if (pointInPolygon(c, blk.poly) && !inBuilding && roadDistance(c) >= 4) {
        output.push({
          ...base, id: 'city-plaza-central', type: 'prop', name: 'Town Square Monument',
          x: c.x, y: c.y, w: 7, h: 7, scale: 1, rotation: 0, flipX: false,
          builtin: 'altar',
        });
        placedPlaza = true;
        break;
      }
    }
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
  for (const [index, polygon] of blocks.entries()) {
    if (inTownPoly(polygon) || area(polygon) < 420) continue;
    if (output.some((e) => e.id === `block-${index}`)) continue;
    output.push({
      ...base,
      id: `field-${index}`,
      type: 'area',
      role: 'land',
      name: 'Agricultural Field',
      rings: polygon,
      fill: fieldPalette[index % fieldPalette.length]!,
    });
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
          builtin: 'dock',
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
          builtin: dockIdx % 2 === 0 ? 'crate' : 'barrel',
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
            builtin: 'boat',
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
              builtin: 'boat',
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

  // Undercity sewer runs mirrored strictly inside major arterial street centerlines
  const majorRoads = output
    .filter((e): e is Extract<Entity, { type: 'path' }> => e.type === 'path' && e.role === 'road' && e.points.length >= 2)
    .sort((a, b) => b.width - a.width)
    .slice(0, 6);
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
        output.push({
          ...base,
          id: `manhole-${manholeCount++}`,
          type: 'prop',
          name: 'Sewer Grate',
          x: mp.x,
          y: mp.y,
          w: 2.4,
          h: 2.4,
          scale: 1,
          rotation: 0,
          flipX: false,
          builtin: 'manhole',
        });
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
            output.push({
              ...base, id: `city-bridge-${placedBridges.length}`, type: 'prop', name: 'Stone River Bridge',
              x: mid.x, y: mid.y, w: span + 3, h: Math.max(4.5, road.width * 0.9),
              scale: 1, rotation: Math.atan2(uy, ux), flipX: false, builtin: 'bridge',
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
      notes: 'Stone embankments, timber piers, and moored trading cogs unloading salt, wool, and timber.',
      gmNotes: 'Harbor master keeps two smuggler manifests hidden in the customs shed office.',
      entityIds: output.filter((e) => e.id.startsWith('quay-') || e.id.startsWith('dock-')).map((e) => e.id),
      layerTier: 'incidental',
      activeHours: { morning: true, day: true, evening: true, night: false },
    });
  }
  // Register notable procedural establishments (Inn / Tavern / Smithy) for click-to-inspect OSE pins
  let shopPinCount = 0;
  for (const ent of output) {
    if (shopPinCount >= 2 || ent.type !== 'area' || ent.role !== 'building') continue;
    const bName = ent.name ?? '';
    if (!/^(Inn|Tavern|Smithy)\b/.test(bName)) continue;
    shopPinCount++;
    cityPlaces.push({
      ...base, id: `place-${ent.id}`, type: 'place', name: bName, category: 'establishment',
      notes: bName.startsWith('Smithy')
        ? 'Glowing coal forge producing horseshoes, spearheads, and heavy wagon rims.'
        : 'Crowded common room with spiced ale, rumor-trading drovers, and warm bunk lofts.',
      gmNotes: bName.startsWith('Smithy')
        ? 'Apprentice spotted masked riders shoeing mounts in reverse near the north gate.'
        : 'Proprietor buys odd dungeon salvage and holds locked cellar stairs behind the cask rack.',
      entityIds: [ent.id],
      layerTier: shopPinCount === 1 ? 'focus' : 'incidental',
      activeHours: { morning: bName.startsWith('Smithy'), day: true, evening: true, night: !bName.startsWith('Smithy') },
    });
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
