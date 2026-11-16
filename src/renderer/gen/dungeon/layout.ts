import clipping from '../../geom/polygonClipping';
import { z } from 'zod';
import { distanceToSegment, pointInPolygon } from '../../geom/hitTest';
import { fromPolygons, toPolygons } from '../../geom/fog';
import { simplifyRDP } from '../../geom/simplify';
import type { Entity, Point } from '../../model/schema';
import { scaleEntityPatch } from '../../geom/transform';
import { registerGenerator, type GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { dressDungeon, ROOM_PURPOSES } from './dressing';

export const DungeonParamsSchema = z.object({
  mode: z.enum(['building', 'dungeon', 'chamber', 'cave']).default('building'),
  corridorWidth: z.number().int().min(1).max(6).default(2),
  rooms: z.number().int().min(1).max(20).default(6),
  mirror: z.boolean().default(false),
  purpose: z.enum(ROOM_PURPOSES).default('random'),
  roomPurposes: z.record(z.string(),z.enum(ROOM_PURPOSES)).default({}),
  density: z.number().min(0).max(3).default(1),
  caveIrregularity: z.number().min(0).max(1).optional(),
  renderSeed: z.number().int().optional(),
});
export type DungeonParams = z.infer<typeof DungeonParamsSchema>;
type Cell = { x: number; y: number; center: Point; key: string };
const key = (x: number, y: number) => `${x},${y}`;
const directions = [[1,0], [0,1], [-1,0], [0,-1]] as const;
const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);

function crossing(a: Point, b: Point, c: Point, d: Point): boolean {
  return cross(a,b,c)*cross(a,b,d) <= 0 && cross(c,d,a)*cross(c,d,b) <= 0
    && Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)) <= Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x)) + 1e-7
    && Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)) <= Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y)) + 1e-7;
}

export function dungeonLayout(input: GeneratorInput<DungeonParams>): Entity[] {
  const { region, constraints, grid: g, params } = input;
  const random = mulberry32(input.seed);
  const points = region[0]!;
  const x0 = Math.min(...points.map(p => p.x)), y0 = Math.min(...points.map(p => p.y));
  const width = Math.max(...points.map(p => p.x))-x0, height = Math.max(...points.map(p => p.y))-y0;
  if(params.mirror) {
    const center={x:x0+width/2,y:0};
    const reflect=(e:Entity):Entity=>({...e,...scaleEntityPatch(e,center,-1,1)});
    return dungeonLayout({...input,params:{...params,mirror:false},region:region.map(r=>r.map(p=>({x:2*center.x-p.x,y:p.y}))),
      constraints:constraints.map(reflect)}).map(reflect);
  }
  const cols = Math.ceil(width/g), rows = Math.ceil(height/g);
  if (cols*rows > 20000) throw new Error('Footprint is too large: use at most 20,000 grid squares.');
  const blueprintKeepouts = constraints.filter(
    (e): e is Extract<Entity, { type: 'area' }> =>
      e.type === 'area' && e.usage === 'blueprint' && e.role !== 'floor',
  );
  const cells = new Map<string, Cell>();
  for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) {
    const center = {x:x0+(x+0.5)*g,y:y0+(y+0.5)*g};
    if (
      pointInPolygon(center, region) &&
      !blueprintKeepouts.some((b) => pointInPolygon(center, b.rings))
    ) {
      cells.set(key(x,y), {x,y,center,key:key(x,y)});
    }
  }
  if (cells.size < 9) throw new Error('Footprint needs at least nine grid squares.');
  const manualWalls = constraints.filter((e): e is Extract<Entity,{type:'wall'}> => e.type === 'wall');
  const manualDoors = constraints.filter((e): e is Extract<Entity,{type:'door'}> => e.type === 'door');
  const doorAt = (p: Point, tolerance = g*0.51) => manualDoors.find(d => distanceToSegment(p,d.a,d.b) < tolerance);
  const wallAt = (p: Point) => manualWalls.some(w => w.points.slice(1).some((b,i) => distanceToSegment(p,w.points[i]!,b)<g*0.01));
  const neighbors = (cell: Cell): Cell[] => directions.flatMap(([dx,dy]) => {
    const n = cells.get(key(cell.x+dx,cell.y+dy));
    if (!n) return [];
    const mid = {x:(cell.center.x+n.center.x)/2,y:(cell.center.y+n.center.y)/2};
    // Do not bridge holes, a concave cutout, or a deliberately drawn solid wall.
    if (!pointInPolygon(mid,region)) return [];
    const crossesBoundary = region.some(ring => ring.some((p,i) => crossing(cell.center,n.center,p,ring[(i+1)%ring.length]!)));
    if (crossesBoundary) return [];
    if (!doorAt(mid) && manualWalls.some(w => w.points.slice(1).some((b,i) => crossing(cell.center,n.center,w.points[i]!,b)))) return [];
    return [n];
  });
  const path = (start: Cell, target?: Cell): Cell[] => {
    const queue = [start], seen = new Map<string,Cell | null>([[start.key,null]]);
    for (let i=0;i<queue.length;i++) {
      const c = queue[i]!;
      if (target?.key === c.key) {
        const result: Cell[] = []; let current: Cell | null = c;
        while (current) { result.push(current); current = seen.get(current.key)!; }
        return result.reverse();
      }
      for (const n of neighbors(c)) if (!seen.has(n.key)) {seen.set(n.key,c);queue.push(n);}
    }
    return target ? [] : queue;
  };
  const all = [...cells.values()];
  if (path(all[0]!).length !== cells.size) throw new Error('Footprint is disconnected or a manual wall seals it. Add a door or choose a connected footprint.');

  // The labels describe connected rooms. The corridor is room zero in dungeon mode.
  const labels = new Map<string,number>();
  const wideCells=(c:Cell):Cell[]=>{
    const k=params.corridorWidth, result:Cell[]=[];
    for(let y=0;y<k;y++)for(let x=0;x<k;x++){const n=cells.get(key(c.x+x,c.y+y));if(n)result.push(n);}
    return result;
  };
  const carveRoute=(start:Cell,target:Cell)=>{
    const k=params.corridorWidth;
    const anchor=(c:Cell)=>cells.get(key(Math.min(c.x,cols-k),Math.min(c.y,rows-k)))??c;
    start=anchor(start);target=anchor(target);
    const allowedLabels=new Set([0,labels.get(start.key),labels.get(target.key)]);
    const fits=(c:Cell)=>{
      const block=wideCells(c);if(block.length!==k*k||block.some(n=>labels.has(n.key)&&!allowedLabels.has(labels.get(n.key))))return false;
      return block.every(n=>[[1,0],[0,1]].every(([dx,dy])=>{const q=cells.get(key(n.x+dx!,n.y+dy!));return !q||!block.includes(q)||neighbors(n).includes(q);}));
    };
    const queue=[start],seen=new Map<string,Cell|null>([[start.key,null]]);
    for(let i=0;i<queue.length;i++){
      const c=queue[i]!;
      if(c.key===target.key){let at:Cell|null=c;while(at){for(const n of wideCells(at))if(!labels.has(n.key))labels.set(n.key,0);at=seen.get(at.key)!;}return;}
      for(const n of neighbors(c))if(!seen.has(n.key)&&fits(n)){seen.set(n.key,c);queue.push(n);}
    }
    throw new Error(`No ${k*5} ft wide corridor fits without crossing a room or wall. Reduce corridor width or use a larger footprint.`);
  };
  const ordered = [...all].sort((a,b) => a.y-b.y || (params.mirror ? b.x-a.x : a.x-b.x));
  if (params.mode === 'building') {
    const groups: Cell[][] = [ordered];
    while (groups.length < params.rooms) {
      groups.sort((a,b) => b.length-a.length);
      const group = groups[0]!;
      if (group.length < 18) break;
      const minX=Math.min(...group.map(c=>c.x)), maxX=Math.max(...group.map(c=>c.x));
      const minY=Math.min(...group.map(c=>c.y)), maxY=Math.max(...group.map(c=>c.y));
      const axis = maxX-minX >= maxY-minY ? 'x' : 'y';
      const sorted = [...group].sort((a,b) => (a[axis]-b[axis])*(axis==='x'&&params.mirror?-1:1));
      const fraction=0.4+random()*0.2, cutCell=sorted[Math.floor(sorted.length*fraction)]!;
      const left=group.filter(c => c[axis] < cutCell[axis]), right=group.filter(c => c[axis] >= cutCell[axis]);
      if (left.length < 6 || right.length < 6) break;
      groups.splice(0,1,left,right);
    }
    let label=0;
    for (const group of groups) {
      const remaining = new Set(group.map(c=>c.key));
      while (remaining.size) {
        const queue=[cells.get(remaining.values().next().value!)!]; remaining.delete(queue[0]!.key);
        for (let i=0;i<queue.length;i++) for (const n of neighbors(queue[i]!)) if (remaining.delete(n.key)) queue.push(n);
        for (const c of queue) labels.set(c.key,label);
        label++;
      }
    }
  } else if (params.mode === 'dungeon') {
    const centers: Cell[]=[];
    const roomScale = Math.max(1, Math.min(3, Math.floor(Math.min(cols, rows) / 24)));
    for (let attempt=0;attempt<params.rooms*80 && centers.length<params.rooms;attempt++) {
      const c=ordered[Math.floor(random()*ordered.length)]!;
      const minimum=Math.max(3,params.corridorWidth+1) * roomScale;
      const w=minimum+Math.floor(random()*(3*roomScale)), h=minimum+Math.floor(random()*(3*roomScale));
      const room: Cell[]=[];
      for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) {
        const n=cells.get(key(c.x+(params.mirror?-dx:dx),c.y+dy)); if(n) room.push(n);
      }
      if(room.length!==w*h || room.some(n => directions.some(([dx,dy])=>Array.from({length:params.corridorWidth},(_,i)=>i+1).some(d=>labels.has(key(n.x+dx*d,n.y+dy*d)))) || labels.has(n.key))) continue;
      centers.push(room[Math.floor(room.length/2)]!);
      for (const n of room) labels.set(n.key,centers.length);
    }
    if(!centers.length) throw new Error('No room fits. Use a larger footprint or Chamber mode.');
    // Connect rooms in nearest-neighbor MST order so corridors stay compact and logical.
    const linked = [centers[0]!];
    const unlinked = centers.slice(1);
    const connectedPairs = new Set<string>();
    while (unlinked.length) {
      let bestU = 0, bestL = 0, bestD = Infinity;
      for (let u = 0; u < unlinked.length; u++) {
        for (let l = 0; l < linked.length; l++) {
          const d = Math.hypot(unlinked[u]!.x - linked[l]!.x, unlinked[u]!.y - linked[l]!.y);
          if (d < bestD) { bestD = d; bestU = u; bestL = l; }
        }
      }
      const next = unlinked.splice(bestU, 1)[0]!;
      carveRoute(linked[bestL]!, next);
      connectedPairs.add([linked[bestL]!.key, next.key].sort().join('|'));
      linked.push(next);
    }
    // Add up to 2 extra loop corridors between nearby unlinked rooms for tactical flanking.
    if (centers.length >= 4) {
      const pairs: Array<{ a: Cell; b: Cell; d: number }> = [];
      for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) {
        const a = centers[i]!, b = centers[j]!;
        if (!connectedPairs.has([a.key, b.key].sort().join('|'))) {
          pairs.push({ a, b, d: Math.hypot(a.x - b.x, a.y - b.y) });
        }
      }
      pairs.sort((p, q) => p.d - q.d);
      const maxCorridorLoops = Math.min(6, Math.max(2, Math.floor(centers.length / 2)));
      let loops = 0;
      for (const { a, b } of pairs) {
        if (loops >= maxCorridorLoops) break;
        try { carveRoute(a, b); loops++; } catch { /* skip blocked shortcut */ }
      }
    }
  } else if (params.mode === 'cave') {
    const outerSet = new Set(ordered.filter(c => directions.some(([dx, dy]) => !cells.has(key(c.x + dx, c.y + dy)))).map(c => c.key));
    let cave = new Set(ordered.filter(c => !outerSet.has(c.key) && random() < 0.56).map(c => c.key));
    for (let step = 0; step < 4; step++) {
      const next = new Set<string>();
      for (const c of ordered) {
        if (outerSet.has(c.key)) continue;
        let wallCount = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = cells.get(key(c.x + dx, c.y + dy));
          if (!n || !cave.has(n.key)) wallCount++;
        }
        const alive = cave.has(c.key) ? wallCount <= 4 : wallCount <= 3;
        if (alive) next.add(c.key);
      }
      cave = next;
    }
    if (cave.size < 9) {
      for (const c of ordered) if (!outerSet.has(c.key)) cave.add(c.key);
      if (!cave.size) cave.add(ordered[0]!.key);
    }
    for (const k of cave) labels.set(k, 0);
    // Bridge disconnected cavern pockets into one connected cave system.
    const seen = new Set<string>();
    const pockets: Cell[][] = [];
    for (const k of cave) {
      if (seen.has(k)) continue;
      const q = [cells.get(k)!]; seen.add(k);
      for (let i = 0; i < q.length; i++) for (const n of neighbors(q[i]!)) if (cave.has(n.key) && !seen.has(n.key)) { seen.add(n.key); q.push(n); }
      pockets.push(q);
    }
    pockets.sort((a, b) => b.length - a.length);
    const mainPocket = pockets[0] ?? [];
    for (const pocket of pockets.slice(1)) {
      let bestA = mainPocket[0]!, bestB = pocket[0]!, bestD = Infinity;
      for (const a of mainPocket) for (const b of pocket) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < bestD) { bestD = d; bestA = a; bestB = b; }
      }
      for (const c of path(bestA, bestB)) {
        labels.set(c.key, 0);
        for (const n of neighbors(c)) if (!outerSet.has(n.key)) labels.set(n.key, 0);
      }
      mainPocket.push(...pocket);
    }
    // Widen 1-cell cave bottlenecks along any interior neighbor so smooth bevels never pinch passages
    for (const k of [...labels.keys()]) {
      const c = cells.get(k)!;
      if (outerSet.has(k)) continue;
      const openN = neighbors(c).filter(n => labels.has(n.key));
      if (openN.length <= 1) {
        const grow = neighbors(c).find(n => !labels.has(n.key) && !outerSet.has(n.key));
        if (grow) labels.set(grow.key, 0);
      }
    }
    // Jaquaying / subterranean loop breaches: join distant cavern branches separated by a thin rock wall.
    if (labels.size >= 36) {
      let caveLoops = 0;
      const maxCaveLoops = Math.min(3, Math.max(1, Math.floor(labels.size / 45)));
      const caveDist = (src: Cell, dst: Cell): number => {
        const q: Array<[Cell, number]> = [[src, 0]], seen = new Set([src.key]);
        for (let i = 0; i < q.length; i++) {
          const [u, d] = q[i]!;
          if (u.key === dst.key) return d;
          for (const n of neighbors(u)) {
            if (labels.has(n.key) && !seen.has(n.key)) { seen.add(n.key); q.push([n, d + 1]); }
          }
        }
        return Infinity;
      };
      for (const c of ordered) {
        if (caveLoops >= maxCaveLoops) break;
        if (outerSet.has(c.key) || labels.has(c.key)) continue;
        const nList = neighbors(c).filter(n => labels.has(n.key));
        if (nList.length >= 2) {
          const [a, b] = [nList[0]!, nList[1]!];
          if (caveDist(a, b) >= 8) {
            labels.set(c.key, 0);
            caveLoops++;
          }
        }
      }
    }
  } else {
    // A broad central hall with shallow, alternating alcoves around its sides.
    for(const c of ordered) {
      const nx=(c.x+0.5)/cols, ny=(c.y+0.5)/rows;
      if((nx>0.18&&nx<0.82&&ny>0.18&&ny<0.82) || (ny>0.35&&ny<0.65) || (nx>0.38&&nx<0.62)) labels.set(c.key,0);
    }
    if (!labels.size) labels.set(ordered[0]!.key,0);
    const start=cells.get(labels.keys().next().value!)!;
    for(const k of [...labels.keys()]) for(const c of path(start,cells.get(k)!)) labels.set(c.key,0);
  }
  // Bring every supplied entrance into the connected floor, or add a clear exterior entrance.
  const outerDistance=(p:Point)=>Math.min(...region[0]!.map((a,i)=>distanceToSegment(p,a,region[0]![(i+1)%region[0]!.length]!)));
  const boundary = ordered.filter(c => outerDistance(c.center)<g*0.75);
  const exteriorDoors=manualDoors.filter(d => outerDistance({x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2}) < g*0.55);
  const roomCounts = new Map<number, number>();
  if (params.mode === 'building') {
    for (const lbl of labels.values()) roomCounts.set(lbl, (roomCounts.get(lbl) ?? 0) + 1);
  }
  const largestLabel = [...roomCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const largestBoundary = largestLabel !== undefined ? boundary.filter(c => labels.get(c.key) === largestLabel) : [];
  const defaultEntrance = (largestBoundary.length ? largestBoundary[Math.floor(largestBoundary.length / 2)] : boundary[Math.floor(boundary.length / 2)])!;
  const entrances = exteriorDoors.length ? exteriorDoors.map(d => {
    const p={x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2};
    return [...all].sort((a,b)=>Math.hypot(a.center.x-p.x,a.center.y-p.y)-Math.hypot(b.center.x-p.x,b.center.y-p.y))[0]!;
  }) : [defaultEntrance];
  if (!exteriorDoors.length && (params.mode === 'dungeon' || params.mode === 'cave') && ordered.length >= 100 && boundary.length >= 2) {
    const farEntrance = [...boundary].sort((a, b) =>
      Math.hypot(b.center.x - defaultEntrance.center.x, b.center.y - defaultEntrance.center.y)
      - Math.hypot(a.center.x - defaultEntrance.center.x, a.center.y - defaultEntrance.center.y),
    )[0];
    if (farEntrance && farEntrance.key !== defaultEntrance.key) entrances.push(farEntrance);
  }
  const start = cells.get(labels.keys().next().value!)!;
  for(let i=0;i<entrances.length;i++) {
    const entrance=entrances[i]!;
    if(params.mode==='dungeon'){
      const candidates=exteriorDoors.length?[entrance]:[...boundary].sort((a,b)=>Math.hypot(a.center.x-entrance.center.x,a.center.y-entrance.center.y)-Math.hypot(b.center.x-entrance.center.x,b.center.y-entrance.center.y));
      let connected=false,lastError:unknown;
      for(const candidate of candidates){try{carveRoute(start,candidate);entrances[i]=candidate;connected=true;break;}catch(error){lastError=error;}}
      if(!connected)throw lastError??new Error('No clear entrance fits.');
    }else for(const c of path(start,entrance))if(!labels.has(c.key))labels.set(c.key,0);
  }

  // A concavity or manual wall can split one label into separate rooms.
  const roomNames=new Map<number,string>();
  const newLabels=new Map<string,number>();
  const remaining=new Set(labels.keys()); let nextLabel=0;
  while(remaining.size) {
    const first=remaining.values().next().value!, old=labels.get(first)!;
    const queue=[cells.get(first)!];remaining.delete(first);
    for(let i=0;i<queue.length;i++) for(const n of neighbors(queue[i]!)) if(labels.get(n.key)===old && remaining.delete(n.key)) queue.push(n);
    const label=nextLabel++;
    roomNames.set(label,params.mode==='dungeon'&&old===0?'Corridor':`Room ${label+1}`);
    for(const c of queue) newLabels.set(c.key,label);
  }
  for(const [k,label] of newLabels) labels.set(k,label);

  const base = {origin:'generated' as const,layerId:'generated',rev:0};
  const output: Entity[]=[];
  const caveIrreg = params.caveIrregularity ?? 0.65;
  const isPinnedCavePt = (p: Point): boolean =>
    outerDistance(p) < g * 0.08
    || manualDoors.some(d => distanceToSegment(p, d.a, d.b) < g * 0.12)
    || manualWalls.some(w => w.points.slice(1).some((b, i) => distanceToSegment(p, w.points[i]!, b) < g * 0.12));
  const smoothCaveRing = (ring: Point[]): Point[] => {
    let pts = simplifyRDP([...ring, ring[0]!], g * 0.01);
    if (pts.length > 2) pts.pop();
    if (pts.length < 3) return ring;
    const cornerPass = (src: Point[], frac: number): Point[] => {
      const out: Point[] = [];
      for (let i = 0; i < src.length; i++) {
        const prev = src[(i - 1 + src.length) % src.length]!;
        const curr = src[i]!;
        const next = src[(i + 1) % src.length]!;
        if (isPinnedCavePt(curr)) {
          out.push(curr);
          continue;
        }
        const dPrev = Math.hypot(prev.x - curr.x, prev.y - curr.y);
        const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
        const crossVal = Math.abs(cross(prev, curr, next));
        const collinear = crossVal < dPrev * dNext * 0.05;
        if (collinear) {
          out.push(curr);
          continue;
        }
        const t1 = Math.min(frac, (g * 0.34) / Math.max(1e-4, dPrev));
        const t2 = Math.min(frac, (g * 0.34) / Math.max(1e-4, dNext));
        out.push(
          { x: curr.x + (prev.x - curr.x) * t1, y: curr.y + (prev.y - curr.y) * t1 },
          { x: curr.x + (next.x - curr.x) * t2, y: curr.y + (next.y - curr.y) * t2 },
        );
      }
      return out;
    };
    pts = cornerPass(pts, 0.28 + caveIrreg * 0.06);
    pts = cornerPass(pts, 0.22);
    return pts.map((p) => {
      if (isPinnedCavePt(p) || caveIrreg <= 0) return p;
      const jit = (random() - 0.5) * g * 0.1 * caveIrreg;
      const jitY = (random() - 0.5) * g * 0.1 * caveIrreg;
      const cand = { x: p.x + jit, y: p.y + jitY };
      return pointInPolygon(cand, region) ? cand : p;
    });
  };

  // Union per row first: substantially less work than unioning hundreds of individual tiles.
  for(const label of [...new Set(labels.values())].sort((a,b)=>a-b)) {
    const strips: Point[][]=[];
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) if(labels.get(key(x,y))===label) {
      const first=x; while(labels.get(key(x+1,y))===label) x++;
      strips.push([{x:x0+first*g,y:y0+y*g},{x:x0+(x+1)*g,y:y0+y*g},{x:x0+(x+1)*g,y:y0+(y+1)*g},{x:x0+first*g,y:y0+(y+1)*g}]);
    }
    const union=clipping.union(toPolygons(strips.map(r=>[r])));
    let floors=clipping.intersection(union,toPolygons([region]));
    const fixedFloors=constraints.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='floor');
    for(const floor of fixedFloors) floors=clipping.difference(floors,toPolygons([floor.rings]));
    const floorMaterial = params.mode === 'cave' ? 'earth' : params.mode === 'building' ? 'wood' : 'stone';
    const floorFill =
      params.mode === 'cave'
        ? '#8f7a5e'
        : params.mode === 'building'
          ? (label % 2 ? '#8f6945' : '#9c754f')
          : (label % 2 ? '#787368' : '#857f73');
    for(const [i,rawRings] of fromPolygons(floors).entries()) {
      let rings = rawRings;
      if (params.mode === 'cave') {
        const smoothed = rawRings.map((ring) => smoothCaveRing(ring)).filter((r) => r.length >= 3);
        const clipped = fromPolygons(clipping.intersection(toPolygons([smoothed]), toPolygons([region])))[0];
        if (clipped && clipped.length) rings = clipped;
      }
      output.push({
        ...base,
        id: `floor-${label}-${i}`,
        type: 'area',
        role: 'floor',
        floorMaterial,
        name: roomNames.get(label),
        rings,
        fill: floorFill,
      });
    }
  }
  type Edge={a:Point;b:Point;left:number;right?:number;manual?:boolean};
  const edges: Edge[]=[];
  for(const c of ordered) if(labels.has(c.key)) for(const [dx,dy] of directions) {
    const n=cells.get(key(c.x+dx,c.y+dy)), left=labels.get(c.key)!, right=n?labels.get(n.key):undefined;
    if(right===undefined || left===right || dy<0||dx<0) continue;
    const a=dx===1?{x:x0+(c.x+1)*g,y:y0+c.y*g}:dy===1?{x:x0+c.x*g,y:y0+(c.y+1)*g}:{x:x0+c.x*g,y:y0+c.y*g};
    const b=dx!==0?{x:a.x,y:a.y+g}:{x:a.x+g,y:a.y};
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(right!==undefined && n && !neighbors(c).some(v=>v.key===n.key)) continue;
    edges.push({a,b,left,right,manual:!!doorAt(mid,g*0.05)});
  }
  // Exact exterior walls follow the clipped floor polygon, including diagonal edges and holes.
  const allFloors=output.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area');
  const fixedFloors=constraints.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='floor');
  if(!allFloors.length && !fixedFloors.length) throw new Error('No floor fits inside this footprint.');
  const outline=clipping.union(toPolygons([...allFloors,...fixedFloors].map(e=>e.rings)));

  if (params.mode === 'cave') {
    const boundarySegs: Array<[Point, Point]> = [];
    for (const poly of fromPolygons(outline)) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
          const len = Math.hypot(q.x - p.x, q.y - p.y);
          const count = Math.max(1, Math.ceil(len / g));
          for (let j = 0; j < count; j++) {
            const a = { x: p.x + (q.x - p.x) * j / count, y: p.y + (q.y - p.y) * j / count };
            const b = { x: p.x + (q.x - p.x) * (j + 1) / count, y: p.y + (q.y - p.y) * (j + 1) / count };
            boundarySegs.push([a, b]);
          }
        }
      }
    }
    const entranceDoors: Array<{ a: Point; b: Point }> = [];
    for (let ei = 0; ei < entrances.length; ei++) {
      const entrance = entrances[ei]!;
      const candidates = boundarySegs
        .map(([a, b]) => ({ a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }))
        .filter((s) => outerDistance(s.mid) < g * 0.05 && !wallAt(s.mid))
        .sort((u, v) => Math.hypot(u.mid.x - entrance.center.x, u.mid.y - entrance.center.y) - Math.hypot(v.mid.x - entrance.center.x, v.mid.y - entrance.center.y));
      const chosen = candidates[0];
      if (!chosen) throw new Error('No clear entrance fits. Add an entrance door to the footprint.');
      const isManual = !!doorAt(chosen.mid, g * 0.5);
      entranceDoors.push({ a: chosen.a, b: chosen.b });
      if (!isManual) {
        output.push({ ...base, id: `door-cave-${ei}`, type: 'door', a: chosen.a, b: chosen.b, kind: 'door', open: false });
      }
    }
    let caveWallIdx = 0;
    for (const poly of fromPolygons(outline)) {
      for (const ring of poly) {
        const chains: Point[][] = [[]];
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const steps = Math.max(1, Math.ceil(len / g));
          for (let j = 0; j < steps; j++) {
            const p = { x: a.x + (b.x - a.x) * j / steps, y: a.y + (b.y - a.y) * j / steps };
            const q = { x: a.x + (b.x - a.x) * (j + 1) / steps, y: a.y + (b.y - a.y) * (j + 1) / steps };
            const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            const isDoor = entranceDoors.some((d) => distanceToSegment(mid, d.a, d.b) < g * 0.08)
              || manualDoors.some((d) => distanceToSegment(mid, d.a, d.b) < g * 0.08);
            const isOutside = !pointInPolygon({ x: mid.x + g * 0.001, y: mid.y + g * 0.001 }, region)
              && !pointInPolygon({ x: mid.x - g * 0.001, y: mid.y - g * 0.001 }, region);
            if (isDoor || wallAt(mid) || isOutside) {
              if (chains.at(-1)!.length >= 2) chains.push([]);
              else chains[chains.length - 1] = [];
            } else {
              const cur = chains.at(-1)!;
              if (!cur.length) cur.push(p);
              cur.push(q);
            }
          }
        }
        // Merge wrap-around segments if closed ring starts & ends cleanly
        if (chains.length > 1 && chains[0]!.length >= 2 && chains.at(-1)!.length >= 2) {
          const firstPt = chains[0]![0]!;
          const lastPt = chains.at(-1)!.at(-1)!;
          if (Math.hypot(firstPt.x - lastPt.x, firstPt.y - lastPt.y) < g * 0.01) {
            const tail = chains.pop()!;
            chains[0] = [...tail.slice(0, -1), ...chains[0]!];
          }
        }
        for (const ch of chains) {
          if (ch.length >= 2) {
            let points = ch;
            if (ch.length > 3) {
              const isLoop = Math.hypot(ch[0]!.x - ch.at(-1)!.x, ch[0]!.y - ch.at(-1)!.y) < g * 0.01;
              if (isLoop) {
                const simplified = simplifyRDP(ch.slice(0, -1), g * 0.08, true);
                points = simplified.length >= 3 ? [...simplified, simplified[0]!] : ch;
              } else {
                points = simplifyRDP(ch, g * 0.08);
              }
            }
            output.push({
              ...base,
              id: `wall-${caveWallIdx++}`,
              type: 'wall',
              wallKind: 'terrain',
              points,
              blocksMove: true,
              blocksSight: true,
            });
          }
        }
      }
    }
  } else {
  for(const polygon of fromPolygons(outline)) for(const ring of polygon) for(let i=0;i<ring.length;i++) {
    const p=ring[i]!, q=ring[(i+1)%ring.length]!;
    const length=Math.hypot(q.x-p.x,q.y-p.y), count=Math.max(1,Math.ceil(length/g));
    for(let j=0;j<count;j++) {
      const a={x:p.x+(q.x-p.x)*j/count,y:p.y+(q.y-p.y)*j/count};
      const b={x:p.x+(q.x-p.x)*(j+1)/count,y:p.y+(q.y-p.y)*(j+1)/count};
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      let near: Cell | undefined;
      for(const [dx,dy] of [[0.01,0.01],[-0.01,-0.01],[0.01,-0.01],[-0.01,0.01]]) {
        const c=cells.get(key(Math.floor((mid.x-x0)/g+dx!),Math.floor((mid.y-y0)/g+dy!)));
        if(c&&labels.has(c.key)) {near=c;break;}
      }
      if(near) edges.push({a,b,left:labels.get(near.key)!,manual:!!doorAt(mid,g*0.5)});
    }
  }
  // A spanning tree of room adjacencies gives every room a door to the entrance.
  // In building mode, prioritize direct hub spokes from the entrance/main hall so private rooms stay dead-end leaves.
  const hubLabel = labels.get(entrances[0]!.key)!;
  const connected=new Set<number>([hubLabel]);
  const doors=new Set<Edge>();
  const pickMidWallEdge = (edge: Edge): Edge => {
    if (params.mode !== 'building' || edge.right === undefined || edge.manual) return edge;
    const loL = Math.min(edge.left, edge.right), hiL = Math.max(edge.left, edge.right);
    const dx = Math.abs(edge.b.x - edge.a.x), dy = Math.abs(edge.b.y - edge.a.y);
    const horiz = dy <= dx;
    const axisVal = horiz ? (edge.a.y + edge.b.y) / 2 : (edge.a.x + edge.b.x) / 2;
    const samePair = edges.filter((cand) => {
      if (cand.right === undefined || wallAt({ x: (cand.a.x + cand.b.x) / 2, y: (cand.a.y + cand.b.y) / 2 })) return false;
      if (Math.min(cand.left, cand.right) !== loL || Math.max(cand.left, cand.right) !== hiL) return false;
      const cdx = Math.abs(cand.b.x - cand.a.x), cdy = Math.abs(cand.b.y - cand.a.y);
      if ((cdy <= cdx) !== horiz) return false;
      const cAxis = horiz ? (cand.a.y + cand.b.y) / 2 : (cand.a.x + cand.b.x) / 2;
      return Math.abs(cAxis - axisVal) < g * 0.05;
    });
    if (samePair.some((c) => c.manual)) return samePair.find((c) => c.manual)!;
    samePair.sort((a, b) => horiz ? (a.a.x + a.b.x) - (b.a.x + b.b.x) : (a.a.y + a.b.y) - (b.a.y + b.b.y));
    const idx = samePair.indexOf(edge);
    if (idx < 0) return edge;
    const run = [edge];
    const centerPos = (c: Edge) => horiz ? (c.a.x + c.b.x) / 2 : (c.a.y + c.b.y) / 2;
    for (let li = idx - 1; li >= 0; li--) {
      if (Math.abs(centerPos(samePair[li]!) - centerPos(run[0]!)) <= g * 1.15) run.unshift(samePair[li]!);
      else break;
    }
    for (let ri = idx + 1; ri < samePair.length; ri++) {
      if (Math.abs(centerPos(samePair[ri]!) - centerPos(run[run.length - 1]!)) <= g * 1.15) run.push(samePair[ri]!);
      else break;
    }
    return run[Math.floor(run.length / 2)]!;
  };
  const shuffled=[...edges];
  for(let i=shuffled.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j]!,shuffled[i]!];}
  if (params.mode === 'building') {
    for (const edge of shuffled) {
      if (edge.right === undefined) continue;
      if ((edge.left === hubLabel || edge.right === hubLabel) && connected.has(edge.left) !== connected.has(edge.right)) {
        doors.add(pickMidWallEdge(edge));
        connected.add(edge.left);
        connected.add(edge.right);
      }
    }
  }
  let changed=true;
  while(changed) {changed=false;for(const edge of shuffled) if(edge.right!==undefined && connected.has(edge.left)!==connected.has(edge.right)) {
    doors.add(pickMidWallEdge(edge));connected.add(edge.left);connected.add(edge.right);changed=true;
  }}
  const secretDoors = new Set<Edge>();
  // Jaquaying/Xandering loop injection for dungeon & building modes: add shortcut loops between rooms >= 3 steps apart (only hub spokes in buildings).
  if (params.mode === 'building' || params.mode === 'dungeon') {
    const graphDist = (from: number, to: number): number => {
      const adj = new Map<number, number[]>();
      for (const d of doors) {
        if (d.right === undefined) continue;
        adj.set(d.left, [...(adj.get(d.left) ?? []), d.right]);
        adj.set(d.right, [...(adj.get(d.right) ?? []), d.left]);
      }
      const q: Array<[number, number]> = [[from, 0]], seen = new Set([from]);
      for (let i = 0; i < q.length; i++) {
        const [u, dist] = q[i]!;
        if (u === to) return dist;
        for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); q.push([v, dist + 1]); }
      }
      return Infinity;
    };
    const loopCap = params.mode === 'dungeon' ? Math.min(6, Math.max(2, Math.floor(roomNames.size / 2))) : 1;
    let addedLoops = 0;
    const loopCandidates = params.mode === 'building'
      ? [...shuffled].sort((a, b) => {
          const aHub = a.left === hubLabel || a.right === hubLabel ? 0 : 1;
          const bHub = b.left === hubLabel || b.right === hubLabel ? 0 : 1;
          return aHub - bHub;
        })
      : shuffled;
    for (const edge of loopCandidates) {
      if (addedLoops >= loopCap) break;
      if (edge.right === undefined || doors.has(edge) || wallAt({ x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 })) continue;
      const d = graphDist(edge.left, edge.right);
      if (d >= 3) {
        const picked = pickMidWallEdge(edge);
        doors.add(picked);
        if (d >= 4 && random() < 0.35) secretDoors.add(picked);
        addedLoops++;
      }
    }
  }
  // Each corridor/room contact gets an opening; no hallway is drawn into a solid room wall.
  if(params.mode==='dungeon'){
    const contacts=new Map<string,Edge[]>();
    for(const e of edges)if(e.right!==undefined&&(roomNames.get(e.left)==='Corridor')!==(roomNames.get(e.right)==='Corridor')){
      const k=[e.left,e.right].sort((a,b)=>a-b).join(':');const list=contacts.get(k)??[];list.push(e);contacts.set(k,list);
    }
    for(const list of contacts.values()){
      const remaining=new Set(list);
      while(remaining.size){const first=remaining.values().next().value!;remaining.delete(first);const run=[first];
        for(let i=0;i<run.length;i++)for(const e of [...remaining])if([run[i]!.a,run[i]!.b].some(p=>[e.a,e.b].some(q=>Math.hypot(p.x-q.x,p.y-q.y)<g*.01))){run.push(e);remaining.delete(e);}
        const chosen=run.slice(Math.max(0,Math.floor((run.length-params.corridorWidth)/2)),Math.max(0,Math.floor((run.length-params.corridorWidth)/2))+params.corridorWidth);chosen.forEach(e=>doors.add(e));
      }
    }
  }
  if(connected.size!==new Set(labels.values()).size) throw new Error('Could not connect rooms around the manual walls.');
  for(const entrance of entrances) {
    const candidates=edges.filter(e=>e.right===undefined && e.left===labels.get(entrance.key) && outerDistance({x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2})<g*0.01);
    candidates.sort((a,b)=>Math.hypot((a.a.x+a.b.x)/2-entrance.center.x,(a.a.y+a.b.y)/2-entrance.center.y)-Math.hypot((b.a.x+b.b.x)/2-entrance.center.x,(b.a.y+b.b.y)/2-entrance.center.y));
    const edge=candidates.find(e=>e.manual||!wallAt({x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2}));
    if(edge) {
      doors.add(edge);
      if(params.mode==='dungeon'){
        const run=[edge];
        for(let i=0;i<run.length&&run.length<params.corridorWidth;i++)for(const e of candidates){
          if(run.includes(e)||e.manual||wallAt({x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2}))continue;
          if(Math.abs(cross(edge.a,edge.b,e.a))<g*1e-6&&Math.abs(cross(edge.a,edge.b,e.b))<g*1e-6&&[run[i]!.a,run[i]!.b].some(p=>[e.a,e.b].some(q=>Math.hypot(p.x-q.x,p.y-q.y)<g*.01))){run.push(e);doors.add(e);if(run.length>=params.corridorWidth)break;}
        }
      }
    }
    else throw new Error('No clear entrance fits. Add an entrance door to the footprint.');
  }
  const rawWalls: Array<[Point, Point]> = [];
  for(const [i,e] of edges.entries()) {
    const mid={x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2};
    if(wallAt(mid)) continue;
    // Clipping keeps boundary wall pieces inside concave footprints and holes.
    if(!pointInPolygon({x:mid.x+g*0.001,y:mid.y+g*0.001},region) && !pointInPolygon({x:mid.x-g*0.001,y:mid.y-g*0.001},region)) continue;
    if (doors.has(e) && !e.manual) {
      if (params.mode === 'building' && e.right !== undefined) {
        // Inset interior doors cleanly from corners so jambs never collide with perpendicular partitions.
        const jambA = { x: e.a.x + (e.b.x - e.a.x) * 0.22, y: e.a.y + (e.b.y - e.a.y) * 0.22 };
        const jambB = { x: e.a.x + (e.b.x - e.a.x) * 0.78, y: e.a.y + (e.b.y - e.a.y) * 0.78 };
        rawWalls.push([e.a, jambA], [jambB, e.b]);
        output.push({ ...base, id: `door-${i}`, type: 'door', a: jambA, b: jambB, kind: secretDoors.has(e) ? 'secret' : 'door', open: false });
      } else {
        output.push({ ...base, id: `door-${i}`, type: 'door', a: e.a, b: e.b, kind: secretDoors.has(e) ? 'secret' : 'door', open: false });
      }
    }
    else {
      const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,len2=dx*dx+dy*dy;
      let pieces:[number,number][]=[[0,1]];
      for(const door of manualDoors) {
        const lineDistance=(p:Point)=>Math.abs((p.x-e.a.x)*dy-(p.y-e.a.y)*dx)/Math.sqrt(len2);
        if(lineDistance(door.a)>0.001||lineDistance(door.b)>0.001) continue;
        const project=(p:Point)=>((p.x-e.a.x)*dx+(p.y-e.a.y)*dy)/len2;
        const lo=Math.max(0,Math.min(project(door.a),project(door.b))),hi=Math.min(1,Math.max(project(door.a),project(door.b)));
        if(lo>=hi) continue;
        pieces=pieces.flatMap(([a,b])=>hi<=a||lo>=b?[[a,b] as [number,number]]:
          [...(lo>a?[[a,lo] as [number,number]]:[]),...(hi<b?[[hi,b] as [number,number]]:[])]);
      }
      for(const [lo,hi] of pieces) if(hi-lo>1e-8) rawWalls.push([{x:e.a.x+lo*dx,y:e.a.y+lo*dy},{x:e.a.x+hi*dx,y:e.a.y+hi*dy}]);
    }
  }
  // Merge touching collinear wall segments so walls render seamlessly without segment tick marks.
  const ptKey = (p: Point) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
  const usedWall = new Array(rawWalls.length).fill(false);
  let wallIdx = 0;
  for (let i = 0; i < rawWalls.length; i++) {
    if (usedWall[i]) continue;
    usedWall[i] = true;
    let [start, end] = rawWalls[i]!;
    let merged = true;
    while (merged) {
      merged = false;
      for (let j = 0; j < rawWalls.length; j++) {
        if (usedWall[j]) continue;
        const [a, b] = rawWalls[j]!;
        const collinear = Math.abs(cross(start, end, a)) < g * 1e-4 && Math.abs(cross(start, end, b)) < g * 1e-4;
        if (!collinear) continue;
        if (ptKey(end) === ptKey(a)) { end = b; usedWall[j] = true; merged = true; }
        else if (ptKey(end) === ptKey(b)) { end = a; usedWall[j] = true; merged = true; }
        else if (ptKey(start) === ptKey(b)) { start = a; usedWall[j] = true; merged = true; }
        else if (ptKey(start) === ptKey(a)) { start = b; usedWall[j] = true; merged = true; }
      }
    }
    output.push({ ...base, id: `wall-${wallIdx++}`, type: 'wall', points: [start, end], blocksMove: true, blocksSight: true });
  }
  }
  // Validate the produced geometry, including actual wall and doorway openings.
  const finalWalls=[...output,...constraints].filter((e):e is Extract<Entity,{type:'wall'}>=>e.type==='wall');
  const finalDoors=[...output,...constraints].filter((e):e is Extract<Entity,{type:'door'}>=>e.type==='door');
  const walkable=new Map([...cells].filter(([,c])=>[...allFloors,...fixedFloors].some(f=>pointInPolygon(c.center,f.rings))));
  const entranceCell=[...walkable.values()].sort((a,b)=>Math.hypot(a.center.x-entrances[0]!.center.x,a.center.y-entrances[0]!.center.y)-Math.hypot(b.center.x-entrances[0]!.center.x,b.center.y-entrances[0]!.center.y))[0];
  if(entranceCell){const queue=[entranceCell],seen=new Set([entranceCell.key]);
    const connections=new Map<string,boolean>();
    const clear=(a:Cell,b:Cell)=>{const k=[a.key,b.key].sort().join('|');const saved=connections.get(k);if(saved!==undefined)return saved;
      const mid={x:(a.center.x+b.center.x)/2,y:(a.center.y+b.center.y)/2};
      const door=finalDoors.some(d=>crossing(a.center,b.center,d.a,d.b));
      const wall=finalWalls.some(w=>w.points.slice(1).some((p,i)=>crossing(a.center,b.center,w.points[i]!,p)));
      const value=pointInPolygon(mid,region)&&(!wall||door);connections.set(k,value);return value;
    };
    for(let i=0;i<queue.length;i++)for(const [dx,dy]of directions){const a=queue[i]!,n=walkable.get(key(a.x+dx,a.y+dy));if(n&&!seen.has(n.key)&&clear(a,n)){seen.add(n.key);queue.push(n);}}
    if(seen.size!==walkable.size)throw new Error('Generated dungeon has a blocked floor connection after walls and doors. The result was not applied.');
  }
  return output;
}

export function generateDungeon(input: GeneratorInput<DungeonParams>): Entity[] {
  const layout = dungeonLayout(input);
  const renderSeed = (input.seed ^ (((input.params.renderSeed ?? 0) * 2654435761) >>> 0)) >>> 0;
  const g = input.grid;
  const roomFloors = layout.filter(
    (e): e is Extract<Entity, { type: 'area' }> =>
      e.type === 'area' && e.role === 'floor' && e.name !== 'Corridor',
  );
  // Pre-build compact sunken cistern & vertical portals BEFORE dressDungeon so furniture arranges cleanly around them.
  const preFeatures: Entity[] = [];
  const stairRoom = roomFloors.length >= 4 ? roomFloors[roomFloors.length - 1] : undefined;
  let cisternRoomId: string | undefined;
  let cisternCenter: Point | undefined;
  if (input.params.density > 0) {
    const pickClearSpot = (room: Extract<Entity, { type: 'area' }>): Point | undefined => {
      const r = room.rings[0] ?? [];
      if (r.length < 3) return undefined;
      const cx = r.reduce((s, p) => s + p.x, 0) / r.length;
      const cy = r.reduce((s, p) => s + p.y, 0) / r.length;
      const doorsInLayout = layout.filter((d): d is Extract<Entity, { type: 'door' }> => d.type === 'door');
      // Offset portals cleanly into a quiet corner so room numbers / names stay legible beside them.
      for (const [ox, oy] of [[-1.5, -1.35], [1.5, -1.35], [-1.5, 1.35], [1.5, 1.35], [-1, 1], [1, 1], [0, 1.2], [0, 0]] as const) {
        const cand = { x: cx + ox * g, y: cy + oy * g };
        if (!pointInPolygon(cand, room.rings)) continue;
        if (doorsInLayout.some((d) => distanceToSegment(cand, d.a, d.b) < g * 1.1)) continue;
        return cand;
      }
      return pointInPolygon({ x: cx, y: cy }, room.rings) ? { x: cx, y: cy } : undefined;
    };
    const mainSpot = stairRoom ? pickClearSpot(stairRoom) : undefined;
    if (mainSpot) {
      preFeatures.push({
        id: 'stairs-main',
        type: 'portal',
        layerId: 'generated',
        origin: 'generated',
        rev: 0,
        name: input.params.mode === 'building' ? 'Staircase' : 'Stairs Down',
        x: mainSpot.x,
        y: mainSpot.y,
        targetMapId: 'unlinked',
        connectorKind: input.params.mode === 'building' ? 'spiralStairs' : 'stairsDown',
        elevationDelta: -1,
      });
    }
    if (input.params.mode !== 'building') {
      const altKinds = ['ladder', 'chute', 'balcony', 'hatch', 'pit'] as const;
      const altRoom = roomFloors.length >= 5 ? roomFloors[Math.floor(roomFloors.length / 2)] : undefined;
      const altSpot = altRoom && altRoom.id !== stairRoom?.id ? pickClearSpot(altRoom) : undefined;
      if (altSpot) {
        const altKind = altKinds[input.seed % altKinds.length]!;
        preFeatures.push({
          id: 'stairs-alt',
          type: 'portal',
          layerId: 'generated',
          origin: 'generated',
          rev: 0,
          name: altKind === 'ladder' ? 'Shaft Ladder' : altKind === 'chute' ? 'Refuse Chute' : altKind === 'balcony' ? 'Overlook Gallery' : altKind === 'hatch' ? 'Iron Hatch' : 'Sunken Pit',
          x: altSpot.x,
          y: altSpot.y,
          targetMapId: 'unlinked',
          connectorKind: altKind,
          elevationDelta: altKind === 'ladder' || altKind === 'balcony' ? 1 : -1,
        });
      }
      // Compact Brogue cistern basin inside large dungeons, or multi-pocket natural cavern ecology in cave mode.
      if (!input.params.mirror && input.params.mode === 'dungeon') {
        const cisternCand = roomFloors.find((f) => {
          const r = f.rings[0] ?? [];
          const xs = r.map((p) => p.x), ys = r.map((p) => p.y);
          return r.length >= 4 && Math.max(...xs) - Math.min(...xs) >= g * 5.5 && Math.max(...ys) - Math.min(...ys) >= g * 5 && f.id !== stairRoom?.id && f.id !== altRoom?.id;
        });
        if (cisternCand?.rings[0]) {
          const xs = cisternCand.rings[0].map((p) => p.x), ys = cisternCand.rings[0].map((p) => p.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          const bw = Math.min(g * 1.6, (Math.max(...xs) - Math.min(...xs)) * 0.22);
          const bh = Math.min(g * 1.25, (Math.max(...ys) - Math.min(...ys)) * 0.22);
          const corners = [{ x: cx - bw, y: cy - bh }, { x: cx + bw, y: cy - bh }, { x: cx + bw, y: cy + bh }, { x: cx - bw, y: cy + bh }];
          if (bw >= g * 0.7 && bh >= g * 0.6 && corners.every((c) => pointInPolygon(c, cisternCand.rings))) {
            cisternRoomId = cisternCand.id;
            cisternCenter = { x: cx, y: cy - bh - g * 0.55 };
            preFeatures.push({
              id: 'dungeon-cistern',
              type: 'area',
              role: 'water',
              layerId: 'generated',
              origin: 'generated',
              rev: 0,
              name: 'Flooded Cistern',
              rings: [corners],
              fill: '#3c7a89',
            });
          }
        }
      }
      if (input.params.mode === 'cave' && roomFloors[0]?.rings[0]) {
        const caveRng = mulberry32(input.seed ^ 0x51f29a3b);
        const caveFloor = roomFloors[0];
        const ring = caveFloor.rings[0]!;
        const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const span = Math.min(maxX - minX, maxY - minY);
        const featScale = Math.max(g, span * 0.042);
        const caveWalls = layout.filter((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall');
        const wallDist = (pt: Point) =>
          Math.min(Infinity, ...caveWalls.flatMap((w) => w.points.slice(1).map((b, i) => distanceToSegment(pt, w.points[i]!, b))));
        const caveDoors = layout.filter((e): e is Extract<Entity, { type: 'door' }> => e.type === 'door');
        const clearOfDoors = (pt: Point, r: number) =>
          caveDoors.every((d) => distanceToSegment(pt, d.a, d.b) > r + featScale)
          && preFeatures.every((f) => !('x' in f) || Math.hypot(pt.x - f.x, pt.y - f.y) > r + featScale);
        const step = Math.max(g * 1.4, featScale * 0.85);
        const samplePts: Point[] = [];
        for (let py = minY + g * 0.8; py < maxY - g * 0.8; py += step) {
          for (let px = minX + g * 0.8; px < maxX - g * 0.8; px += step) {
            const p = { x: px + (caveRng() - 0.5) * step * 0.35, y: py + (caveRng() - 0.5) * step * 0.35 };
            if (pointInPolygon(p, caveFloor.rings) && wallDist(p) >= g * 0.75 && clearOfDoors(p, g * 0.6)) {
              samplePts.push(p);
            }
          }
        }
        for (let i = samplePts.length - 1; i > 0; i--) {
          const j = Math.floor(caveRng() * (i + 1));
          [samplePts[i], samplePts[j]] = [samplePts[j]!, samplePts[i]!];
        }
        const occupiedZones: Array<{ x: number; y: number; r: number }> = [];
        const zoneClear = (pt: Point, r: number) =>
          occupiedZones.every((z) => Math.hypot(pt.x - z.x, pt.y - z.y) >= r + z.r + g * 0.7);
        const streamPtsList: Point[] = [];
        const streamDist = (pt: Point) =>
          streamPtsList.length >= 2
            ? Math.min(...streamPtsList.slice(1).map((b, i) => distanceToSegment(pt, streamPtsList[i]!, b)))
            : Infinity;

        // 1. Graph-routed subterranean stream winding cleanly through cavern tunnels + wooden footbridge
        if (!input.params.mirror) {
          const nodes = samplePts.filter((p) => wallDist(p) >= g * 0.85).slice(0, 180);
          if (nodes.length >= 4) {
            const segOk = (u: Point, v: Point) => {
              const st = Math.max(2, Math.ceil(Math.hypot(v.x - u.x, v.y - u.y) / (g * 0.45)));
              for (let k = 0; k <= st; k++) {
                const pt = { x: u.x + ((v.x - u.x) * k) / st, y: u.y + ((v.y - u.y) * k) / st };
                if (!pointInPolygon(pt, caveFloor.rings) || wallDist(pt) < g * 0.72) return false;
              }
              return true;
            };
            const adj: Array<Array<{ to: number; cost: number }>> = nodes.map(() => []);
            const maxHop = step * 3.1;
            for (let i = 0; i < nodes.length; i++) {
              for (let j = i + 1; j < nodes.length; j++) {
                const d = Math.hypot(nodes[j]!.x - nodes[i]!.x, nodes[j]!.y - nodes[i]!.y);
                if (d > maxHop || !segOk(nodes[i]!, nodes[j]!)) continue;
                const pen = (wallDist(nodes[i]!) + wallDist(nodes[j]!)) < g * 2.2 ? 1.35 : 1;
                adj[i]!.push({ to: j, cost: d * pen });
                adj[j]!.push({ to: i, cost: d * pen });
              }
            }
            const pairs: Array<[number, number]> = [
              [nodes.reduce((b, p, i) => (p.x + p.y < nodes[b]!.x + nodes[b]!.y ? i : b), 0), nodes.reduce((b, p, i) => (p.x + p.y > nodes[b]!.x + nodes[b]!.y ? i : b), 0)],
              [nodes.reduce((b, p, i) => (p.x - p.y < nodes[b]!.x - nodes[b]!.y ? i : b), 0), nodes.reduce((b, p, i) => (p.x - p.y > nodes[b]!.x - nodes[b]!.y ? i : b), 0)],
            ];
            let bestPath: Point[] = [];
            for (const [sIdx, tIdx] of pairs) {
              if (sIdx === tIdx) continue;
              const dist = new Array(nodes.length).fill(Infinity);
              const prev = new Array(nodes.length).fill(-1);
              const vis = new Array(nodes.length).fill(false);
              dist[sIdx] = 0;
              for (;;) {
                let u = -1;
                for (let i = 0; i < nodes.length; i++) if (!vis[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
                if (u < 0 || u === tIdx || !Number.isFinite(dist[u]!)) break;
                vis[u] = true;
                for (const e of adj[u]!) if (dist[u]! + e.cost < dist[e.to]!) { dist[e.to] = dist[u]! + e.cost; prev[e.to] = u; }
              }
              if (Number.isFinite(dist[tIdx]!)) {
                const path: Point[] = [];
                for (let cur = tIdx; cur >= 0; cur = prev[cur]!) path.push(nodes[cur]!);
                path.reverse();
                if (path.length > bestPath.length) bestPath = path;
              }
            }
            if (bestPath.length >= 4) {
              const smooth: Point[] = [bestPath[0]!];
              for (let i = 1; i < bestPath.length - 1; i++) {
                const a = bestPath[i - 1]!, b = bestPath[i]!, c = bestPath[i + 1]!;
                smooth.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
              }
              smooth.push(bestPath[bestPath.length - 1]!);
              const finalPts = smooth.slice(1).every((p, i) => segOk(smooth[i]!, p)) ? smooth : bestPath;
              streamPtsList.push(...finalPts);
              const streamW = Math.max(g * 1.45, featScale * 0.72);
              preFeatures.push({
                id: 'cave-stream', type: 'path', role: 'river', layerId: 'generated', origin: 'generated', rev: 0,
                name: 'Subterranean Stream', points: finalPts, width: streamW, closed: false,
              });
              // Pick the segment midpoint furthest from cave walls for a sturdy footbridge
              let bestMid = { pa: finalPts[1]!, pb: finalPts[2]!, clear: -1 };
              for (let i = 1; i < finalPts.length - 1; i++) {
                const a = finalPts[i]!, b = finalPts[i + 1]!;
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const wd = wallDist(mid);
                if (wd > bestMid.clear) bestMid = { pa: a, pb: b, clear: wd };
              }
              const bm = { x: (bestMid.pa.x + bestMid.pb.x) / 2, y: (bestMid.pa.y + bestMid.pb.y) / 2 };
              occupiedZones.push({ x: bm.x, y: bm.y, r: featScale * 0.9 });
              preFeatures.push({
                id: 'cave-bridge', type: 'prop', layerId: 'generated', origin: 'generated', rev: 0,
                name: 'Cavern Footbridge', x: bm.x, y: bm.y, w: Math.max(g * 2.5, featScale * 1.45), h: Math.max(g * 1.0, featScale * 0.55), scale: 1,
                rotation: Math.atan2(bestMid.pb.y - bestMid.pa.y, bestMid.pb.x - bestMid.pa.x) + Math.PI / 2, flipX: false, builtin: 'bridge',
              });
            }
          }
          // 1b. Subterranean pools (up to 2) anchored off stream bends or wide grottos
          for (let pi = 0; pi < 2; pi++) {
            const poolSpot = samplePts.find((p) => wallDist(p) >= g * 1.9 && zoneClear(p, featScale * 1.5) && (pi === 0 || streamDist(p) > featScale * 2.5));
            if (!poolSpot) break;
            const rx = featScale * (1.2 + caveRng() * 0.55), ry = featScale * (0.9 + caveRng() * 0.45);
            const poolPts = Array.from({ length: 12 }, (_, k) => {
              const a = (k / 12) * Math.PI * 2;
              const wob = 0.78 + caveRng() * 0.36;
              return { x: poolSpot.x + Math.cos(a) * rx * wob, y: poolSpot.y + Math.sin(a) * ry * wob };
            });
            if (poolPts.every((p) => pointInPolygon(p, caveFloor.rings) && wallDist(p) >= g * 0.55)) {
              occupiedZones.push({ x: poolSpot.x, y: poolSpot.y, r: Math.max(rx, ry) });
              preFeatures.push({
                id: pi === 0 ? 'cave-spring' : `cave-pool-${pi}`, type: 'area', role: 'water', layerId: 'generated', origin: 'generated', rev: 0,
                name: pi === 0 ? 'Subterranean Pool' : 'Echoing Cenote', rings: [poolPts], fill: '#2c5e6c',
              });
            }
          }
          // 2. Multi-level elevated limestone terraces (up to 3)
          for (let li = 0; li < 3; li++) {
            const ledgeSpot = samplePts.find((p) => wallDist(p) >= g * 1.7 && zoneClear(p, featScale * 1.45) && streamDist(p) > featScale * 1.3);
            if (!ledgeSpot) break;
            const rx = featScale * (1.25 + caveRng() * 0.55), ry = featScale * (0.85 + caveRng() * 0.4);
            const ledgePts = Array.from({ length: 10 }, (_, k) => {
              const a = (k / 10) * Math.PI * 2;
              const wob = 0.78 + caveRng() * 0.34;
              return { x: ledgeSpot.x + Math.cos(a) * rx * wob, y: ledgeSpot.y + Math.sin(a) * ry * wob };
            });
            if (ledgePts.every((p) => pointInPolygon(p, caveFloor.rings) && wallDist(p) >= g * 0.45)) {
              occupiedZones.push({ x: ledgeSpot.x, y: ledgeSpot.y, r: Math.max(rx, ry) });
              preFeatures.push({
                id: `cave-ledge-${li}`, type: 'area', role: 'plateau', layerId: 'generated', origin: 'generated', rev: 0,
                name: ['Limestone Terrace', 'High Grotto Shelf', 'Broken Stone Dais'][li]!, rings: [ledgePts], fill: '#968265', elevation: 2,
              });
            }
          }
          // 2b. Ruined sunken shrine pocket with broken stone pavement, pillars & cyan light
          const ruinSpot = samplePts.find((p) => wallDist(p) >= g * 1.75 && zoneClear(p, featScale * 1.35) && streamDist(p) > featScale * 1.2);
          if (ruinSpot) {
            occupiedZones.push({ x: ruinSpot.x, y: ruinSpot.y, r: featScale * 1.35 });
            const rw = featScale * 1.15, rh = featScale * 0.9;
            preFeatures.push(
              {
                id: 'cave-shrine-dais', type: 'area', role: 'floor', floorMaterial: 'stone', layerId: 'generated', origin: 'generated', rev: 0,
                name: 'Sunken Shrine Dais',
                rings: [[
                  { x: ruinSpot.x - rw, y: ruinSpot.y - rh }, { x: ruinSpot.x + rw, y: ruinSpot.y - rh },
                  { x: ruinSpot.x + rw, y: ruinSpot.y + rh }, { x: ruinSpot.x - rw, y: ruinSpot.y + rh },
                ]],
                fill: '#6c685c',
              },
              { id: 'cave-crystal-shrine', type: 'prop', layerId: 'generated', origin: 'generated', rev: 0, name: 'Sunken Shrine Altar', x: ruinSpot.x, y: ruinSpot.y, w: featScale * 0.72, h: featScale * 0.46, scale: 1, rotation: caveRng() * 0.6, flipX: false, builtin: 'altar', tacticalTag: 'cover' },
              { id: 'cave-crystal-light', type: 'light', layerId: 'generated', origin: 'generated', rev: 0, x: ruinSpot.x, y: ruinSpot.y, radius: featScale * 2.8, color: '#38bdf8' },
              { id: 'cave-ruin-pil-a', type: 'prop', layerId: 'generated', origin: 'generated', rev: 0, name: 'Ruined Pillar', x: ruinSpot.x - featScale * 0.72, y: ruinSpot.y - featScale * 0.35, w: featScale * 0.42, h: featScale * 0.42, scale: 1, rotation: 0, flipX: false, builtin: 'pillar', tacticalTag: 'cover' },
              { id: 'cave-ruin-pil-b', type: 'prop', layerId: 'generated', origin: 'generated', rev: 0, name: 'Ruined Pillar', x: ruinSpot.x + featScale * 0.72, y: ruinSpot.y + featScale * 0.35, w: featScale * 0.42, h: featScale * 0.42, scale: 1, rotation: 0, flipX: false, builtin: 'pillar', tacticalTag: 'cover' },
            );
          }
          // 2c. Bioluminescent fungal grove with clustered foliage + teal cave glow
          const fungalSpot = samplePts.find((p) => wallDist(p) >= g * 1.4 && zoneClear(p, featScale * 1.2) && streamDist(p) > featScale * 0.9);
          if (fungalSpot) {
            occupiedZones.push({ x: fungalSpot.x, y: fungalSpot.y, r: featScale * 1.2 });
            preFeatures.push({
              id: 'cave-fungal-light', type: 'light', layerId: 'generated', origin: 'generated', rev: 0,
              x: fungalSpot.x, y: fungalSpot.y, radius: featScale * 2.5, color: '#2dd4bf',
            });
            for (let fi = 0; fi < 6; fi++) {
              const ang = (fi / 6) * Math.PI * 2 + caveRng() * 0.5;
              const rad = featScale * (0.25 + caveRng() * 0.65);
              const fp = { x: fungalSpot.x + Math.cos(ang) * rad, y: fungalSpot.y + Math.sin(ang) * rad };
              if (pointInPolygon(fp, caveFloor.rings) && wallDist(fp) >= g * 0.45) {
                const sz = featScale * (0.38 + caveRng() * 0.35);
                preFeatures.push({
                  id: `cave-fungi-${fi}`, type: 'prop', layerId: 'generated', origin: 'generated', rev: 0,
                  name: fi % 2 === 0 ? 'Giant Glowcap Cluster' : 'Luminous Spore Moss',
                  x: fp.x, y: fp.y, w: sz, h: sz, scale: 1, rotation: caveRng() * Math.PI * 2, flipX: caveRng() < 0.5,
                  builtin: fi % 2 === 0 ? 'bush' : 'tuft', tacticalTag: 'concealment',
                });
              }
            }
          }
        }
        // 3. Smuggler / explorer campfire alcove + table + light + crates & barrels
        const campSpot = samplePts.find((p) => wallDist(p) >= g * 1.4 && zoneClear(p, featScale * 1.05) && streamDist(p) > featScale * 1.0);
        if (campSpot) {
          occupiedZones.push({ x: campSpot.x, y: campSpot.y, r: featScale * 1.05 });
          preFeatures.push(
            { id: 'cave-camp-fire', type: 'prop', layerId: 'generated', origin: 'generated', rev: 0, name: 'Campfire', x: campSpot.x, y: campSpot.y, w: featScale * 0.48, h: featScale * 0.48, scale: 1, rotation: 0, flipX: false, builtin: 'campfire' },
            { id: 'cave-camp-light', type: 'light', layerId: 'generated', origin: 'generated', rev: 0, x: campSpot.x, y: campSpot.y, radius: featScale * 2.4, color: '#ff9e44' },
          );
          for (const [ci, [ox, oy, kind]] of ([[0.62, -0.35, 'crate'], [-0.6, 0.4, 'barrel'], [0.5, 0.55, 'table'], [-0.55, -0.5, 'crate']] as const).entries()) {
            const sp = { x: campSpot.x + ox * featScale, y: campSpot.y + oy * featScale };
            if (pointInPolygon(sp, caveFloor.rings) && wallDist(sp) >= g * 0.5) {
              preFeatures.push({
                id: `cave-camp-${ci}`, type: 'prop', layerId: 'generated', origin: 'generated', rev: 0,
                name: kind === 'crate' ? 'Supply Crate' : kind === 'barrel' ? 'Provision Barrel' : 'Field Table',
                x: sp.x, y: sp.y, w: featScale * (kind === 'table' ? 0.55 : 0.36), h: featScale * (kind === 'table' ? 0.35 : 0.36),
                scale: 1, rotation: caveRng() * Math.PI, flipX: false, builtin: kind, tacticalTag: 'cover',
              });
            }
          }
        }
        // 4. Clustered mossy boulder fall, stalagmites, and cavern ferns across open cave chambers
        let clutterCount = 0;
        for (const pt of samplePts) {
          if (clutterCount >= 42) break;
          if (!zoneClear(pt, featScale * 0.35) || wallDist(pt) < g * 0.6 || streamDist(pt) < featScale * 0.7) continue;
          const roll = caveRng();
          const kind = roll < 0.46 ? 'rock' : roll < 0.72 ? 'pillar' : roll < 0.88 ? 'bush' : 'tuft';
          const sz = kind === 'rock'
            ? featScale * (0.38 + caveRng() * 0.45)
            : kind === 'pillar'
              ? featScale * (0.34 + caveRng() * 0.25)
              : featScale * (0.35 + caveRng() * 0.3);
          occupiedZones.push({ x: pt.x, y: pt.y, r: sz * 0.65 });
          preFeatures.push({
            id: `cave-deco-${clutterCount++}`,
            type: 'prop',
            layerId: 'generated',
            origin: 'generated',
            rev: 0,
            name: kind === 'rock' ? 'Cave Boulder' : kind === 'pillar' ? 'Stalagmite' : kind === 'bush' ? 'Fungal Clump' : 'Cave Moss',
            x: pt.x,
            y: pt.y,
            w: sz,
            h: sz,
            scale: 1,
            rotation: caveRng() * Math.PI * 2,
            flipX: caveRng() < 0.5,
            builtin: kind,
            ...(kind === 'bush' || kind === 'tuft' ? { tacticalTag: 'concealment' as const } : { tacticalTag: 'cover' as const }),
          });
        }
      }
    }
  }
  const dressed = dressDungeon({ ...input, seed: renderSeed }, [...layout, ...preFeatures]);
  const purposeLabel: Record<string, string> = {
    tavern: 'Taproom',
    storage: 'Pantry',
    bedroom: 'Guest Room',
    shrine: 'Shrine',
    guardroom: 'Guardroom',
    crypt: 'Ossuary',
    cistern: 'Cistern',
    prison: 'Cells',
    alchemy: 'Laboratory',
    treasury: 'Vault',
  };
  const labels: Entity[] = [];
  const places: Extract<Entity, { type: 'place' }>[] = [];
  const secretDoors = layout.filter((e): e is Extract<Entity, { type: 'door' }> => e.type === 'door' && e.kind === 'secret');
  const stockingRoles = ['Empty', 'Empty', 'Monster', 'Monster', 'Special', 'Trap'] as const;
  const emitNumericRoomLabels = input.params.mode === 'building' || roomFloors.length > 1;
  let roomNum = 1;
  for (const e of layout) {
    if (e.type !== 'area' || e.role !== 'floor' || e.name === 'Corridor') continue;
    const ring = e.rings[0];
    if (!ring || ring.length < 3) continue;
    let cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    let cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    if (e.id === cisternRoomId && cisternCenter && pointInPolygon(cisternCenter, e.rings)) {
      cx = cisternCenter.x;
      cy = cisternCenter.y;
    }
    const thisNum = roomNum++;
    if (emitNumericRoomLabels) {
      const text = input.params.mode === 'building'
        ? (e.roomPurpose === 'shrine' && input.params.purpose === 'shrine' && thisNum === 1 ? 'Sanctuary' : (purposeLabel[e.roomPurpose ?? ''] ?? e.name ?? `Room ${thisNum}`))
        : String(thisNum);
      labels.push({
        id: `room-label-${thisNum}`,
        type: 'label',
        layerId: 'generated',
        origin: 'generated',
        rev: 0,
        text,
        x: cx,
        y: cy,
        size: input.params.mode === 'building' ? 15 : 17,
      });
    }
    if (input.params.mode !== 'building') {
      const role = stockingRoles[(input.seed + thisNum * 5) % stockingRoles.length]!;
      const nearSecret = secretDoors.some((d) =>
        ring.some((p) => Math.hypot((d.a.x + d.b.x) / 2 - p.x, (d.a.y + d.b.y) / 2 - p.y) <= input.grid * 1.6),
      );
      const roomTitle = purposeLabel[e.roomPurpose ?? ''] ?? 'Chamber';
      places.push({
        id: `place-area-${thisNum}`,
        type: 'place',
        layerId: 'generated',
        origin: 'generated',
        rev: 0,
        name: `Area ${thisNum}: ${roomTitle}`,
        category: role.toLowerCase(),
        stockingRole: role,
        notes: `${roomTitle} (${role}). Air feels damp and drafts tug toward the far masonry.`,
        gmNotes: nearSecret
          ? `Three-Clue Rule: (1) Scraped boot prints end at bare stone; (2) Draft bends torchlight along the seam; (3) Loose sconce releases secret latch.`
          : `Moldvay Stocking (${role}): Track 10-minute exploration turn & wandering encounter check.`,
        entityIds: [e.id],
      });
    }
  }
  const cisAreas = preFeatures.filter((e) => e.type === 'area');
  const cisPaths = preFeatures.filter((e) => e.type === 'path');
  const cisExtraPropsAndLights = preFeatures.filter((e) => e.type === 'prop' || e.type === 'light');
  const cisPortals = preFeatures.filter((e) => e.type === 'portal');
  return [...layout, ...cisAreas, ...cisPaths, ...dressed, ...cisExtraPropsAndLights, ...cisPortals, ...places, ...labels];
}
registerGenerator({type:'dungeon',title:'Dungeon / interior',params:DungeonParamsSchema,generate:generateDungeon,dress:dressDungeon});
