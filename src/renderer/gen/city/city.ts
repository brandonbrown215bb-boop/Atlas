import { isWorldSymbol } from '../../geom/geography';
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
  blockSize: z.number().min(30).max(180).default(75),
  streetWidth: z.number().min(3).max(16).default(6),
  lotDepth: z.number().min(8).max(30).default(15),
  fringe: z.boolean().default(true),
});
export type CityParams = z.infer<typeof CityParamsSchema>;
type Area = Extract<Entity, {type:'area'}>;
type Street = { points: Point[]; width: number };
const base = {origin:'generated' as const,layerId:'generated',rev:0};
export const ringArea = (r: Point[]) => Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length]!;return s+a.x*b.y-b.x*a.y;},0)/2);
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
  const output: Entity[] = [], streets: Street[] = [];
  const autoWalls: Array<Extract<Entity, { type: 'path' }>> = [];
  const autoGates: Array<Extract<Entity, { type: 'door' }>> = [];
  if (area(region) > 250_000 && !constraints.some(e => (e.type === 'path' && e.role === 'cityWall') || e.type === 'wall' || (e.type === 'area' && e.role === 'district'))) {
    const rb = bboxFromPoints(region[0]!)!;
    const cx = (rb.minX + rb.maxX) / 2, cy = (rb.minY + rb.maxY) / 2;
    const rx = (rb.maxX - rb.minX) * 0.34, ry = (rb.maxY - rb.minY) * 0.34;
    const sides = 16, rot = (random() - 0.5) * 0.6;
    const phase2 = random() * Math.PI * 2, phase3 = random() * Math.PI * 2;
    const wallPts: Point[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const harmonic = 1 + 0.14 * Math.cos(2 * a + phase2) + 0.09 * Math.sin(3 * a + phase3);
      const rad = harmonic * (0.90 + random() * 0.14);
      wallPts.push({ x: cx + Math.cos(a) * rx * rad, y: cy + Math.sin(a) * ry * rad });
    }
    if (wallPts.every(p => pointInPolygon(p, region))) {
      const wallEnt: Extract<Entity, { type: 'path' }> = {
        ...base, id: 'auto-city-wall', type: 'path', role: 'cityWall', name: 'City Wall', points: wallPts, width: 4.5, closed: true,
      };
      autoWalls.push(wallEnt);
      output.push(wallEnt);
      for (let g = 0; g < 4; g++) {
        const i = Math.floor((g * sides) / 4);
        const p1 = wallPts[i]!, p2 = wallPts[(i + 1) % sides]!;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
        autoGates.push({
          ...base, id: `auto-gate-${g}`, type: 'door',
          a: { x: mid.x - (dx / len) * 6, y: mid.y - (dy / len) * 6 },
          b: { x: mid.x + (dx / len) * 6, y: mid.y + (dy / len) * 6 },
          kind: 'door', open: true,
        });
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
  const wallInterior = union(walls.map(w=>toPolygons([[w.points]])));
  const inTown = (p: Point) => !walls.length||walls.some(w=>pointInPolygon(p,[w.points]));
  const inTownPoly = (polygon: Point[][]) => !walls.length||clipping.intersection(toPolygons([polygon]),wallInterior).length>0;
  // Empty standalone towns get gate arteries and slightly angled radial avenues meeting at a central hub.
  if (!streets.some(s=>clipLine(s.points,ground).length)) {
    const townGround = walls.length ? fromPolygons(clipping.intersection(usable,wallInterior)) : ground;
    for (const p of ground) {
      const b=bboxFromPoints((walls.length?walls[0]!.points:p[0])!)!, w=b.maxX-b.minX, h=b.maxY-b.minY;
      const fullBox=bboxFromPoints(p[0]!)!, reach=Math.hypot(fullBox.maxX-fullBox.minX,fullBox.maxY-fullBox.minY)+20;
      const hub={x:(b.minX+b.maxX)/2+(random()-.5)*w*.12,y:(b.minY+b.maxY)/2+(random()-.5)*h*.12};
      for (const gate of gates) {
        const gm={x:(gate.a.x+gate.b.x)/2,y:(gate.a.y+gate.b.y)/2};
        const dx=gate.b.x-gate.a.x,dy=gate.b.y-gate.a.y,len=Math.hypot(dx,dy)||1;
        let nx=-dy/len,ny=dx/len;
        if (walls.length) {
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
        const ray=[hub,{x:hub.x+Math.cos(angle)*reach,y:hub.y+Math.sin(angle)*reach}];
        if (walls.length) {
          for (const tp of townGround) addStreet(ray,tp,params.streetWidth*1.4);
        } else {
          addStreet(ray,p,params.streetWidth*1.4);
        }
      }
    }
  }
  const outerGround = walls.length ? fromPolygons(clipping.difference(usable,wallInterior)) : [];
  const fringeArteries: Street[] = walls.length ? streets.flatMap(s=>clipLine(s.points,outerGround).map(points=>({points,width:s.width}))) : [...streets];
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
    const hasRoad=polygon[0]!.some((p,i)=>{const q=polygon[0]![(i+1)%polygon[0]!.length]!;return roadDistance({x:(p.x+q.x)/2,y:(p.y+q.y)/2})<.5;});
    if (fringe && (!params.fringe || distToArtery > params.blockSize * 0.9) && (depth >= 1 || hasRoad)) { blocks.push(polygon); continue; }
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
    const angleSpread = polyArea < minBlockSq * 1.6 || depth >= 2 ? 0 : 0.24 * (1 - profile.wealth * 0.35);
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
      cityLabels.push({ ...base, id: 'city-label-plaza', type: 'label', text: 'Market Square', x: center.x, y: center.y - 12, size: 17 });
      continue;
    }

    if (isKeep || isTemple) {
      const frame = orientedFrame(outer);
      const kw = Math.min(isKeep ? 34 : 28, frame.spanMajor * 0.56);
      const kh = Math.min(isKeep ? 24 : 18, frame.spanMinor * 0.52);
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
        output.push({
          ...base, id: `building-${buildingCount++}`, type: 'area', role: 'building',
          name: isKeep ? 'High Keep' : 'Grand Temple', rings: cand,
          fill: isKeep ? '#6b655d' : '#56646e',
        });
        occupied.push({ rings: cand, box: bboxFromPoints(cand[0]!)! });
        cityLabels.push({
          ...base, id: isKeep ? 'city-label-keep' : 'city-label-temple', type: 'label',
          text: isKeep ? 'High Keep' : 'Grand Temple', x: cx, y: cy - hh - 7, size: 16,
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
          const crossesPlateau=plateaus.some(p=>{const intersection=fromPolygons(clipping.intersection(shape,toPolygons([p.rings])));const covered=intersection.reduce((s,p)=>s+area(p),0);return covered>1e-6&&covered<frontage*depth-1e-5;});
          if (!outside.length&&!collision&&!crossesPlateau&&!clipping.intersection(shape,wallMask).length) {rings=candidate;occupied.push({rings,box});break;}
          depth-=1.5;
        }
        if (!rings) continue;
        const height=plateaus.find(p=>pointInPolygon(rings![0]![0]!,p.rings))?.elevation;
        const colors=local.wealth>.65?['#a4543c','#616c73','#b59153','#8d4937','#7d5a42']:['#924c38','#785942','#a8864e','#5b656c','#875641'];
        const roofs=input.theme[local.wealth>.65?'roofWealthy':'roof'] ?? input.theme.roof ?? [];
        const roof=roofs.length?roofs[Math.floor(random()*roofs.length)]:undefined;
        output.push({...base,id:`building-${buildingCount++}`,type:'area',role:'building',name:`Building ${buildingCount}`,rings,
          fill:colors[Math.floor(random()*colors.length)]!,...(height===undefined?{}:{elevation:height}),
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
  // Put streets above block fills, buildings above streets, and park trees on top.
  return [
    ...output.filter(e=>e.type==='area'&&e.role==='district'),
    ...output.filter(e=>e.type==='path'),
    ...output.filter(e=>e.type==='area'&&e.role==='building'),
    ...output.filter(e=>e.type==='prop'),
    ...cityLabels,
  ];
}

registerGenerator({type:'city',title:'City / district',params:CityParamsSchema,generate:generateCity});
