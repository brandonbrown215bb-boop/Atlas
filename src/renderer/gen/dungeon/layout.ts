import clipping from 'polygon-clipping';
import { z } from 'zod';
import { distanceToSegment, pointInPolygon } from '../../geom/hitTest';
import { fromPolygons, toPolygons } from '../../geom/fog';
import type { Entity, Point } from '../../model/schema';
import { scaleEntityPatch } from '../../geom/transform';
import { registerGenerator, type GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { dressDungeon, ROOM_PURPOSES } from './dressing';

export const DungeonParamsSchema = z.object({
  mode: z.enum(['building', 'dungeon', 'chamber']).default('building'),
  rooms: z.number().int().min(1).max(20).default(6),
  mirror: z.boolean().default(false),
  purpose: z.enum(ROOM_PURPOSES).default('random'),
  roomPurposes: z.record(z.string(),z.enum(ROOM_PURPOSES)).default({}),
  density: z.number().min(0).max(3).default(1),
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
  const cells = new Map<string, Cell>();
  for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) {
    const center = {x:x0+(x+0.5)*g,y:y0+(y+0.5)*g};
    if (pointInPolygon(center,region)) cells.set(key(x,y), {x,y,center,key:key(x,y)});
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
    for (let attempt=0;attempt<params.rooms*80 && centers.length<params.rooms;attempt++) {
      const c=ordered[Math.floor(random()*ordered.length)]!;
      const w=3+Math.floor(random()*4), h=3+Math.floor(random()*4);
      const room: Cell[]=[];
      for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) {
        const n=cells.get(key(c.x+(params.mirror?-dx:dx),c.y+dy)); if(n) room.push(n);
      }
      if(room.length!==w*h || room.some(n => directions.some(([dx,dy])=>labels.has(key(n.x+dx,n.y+dy))) || labels.has(n.key))) continue;
      centers.push(room[Math.floor(room.length/2)]!);
      for (const n of room) labels.set(n.key,centers.length);
    }
    if(!centers.length) throw new Error('No room fits. Use a larger footprint or Chamber mode.');
    for(let i=1;i<centers.length;i++) for(const c of path(centers[i-1]!,centers[i]!)) if(!labels.has(c.key)) labels.set(c.key,0);
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
  const entrances = exteriorDoors.length ? exteriorDoors.map(d => {
    const p={x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2};
    return [...all].sort((a,b)=>Math.hypot(a.center.x-p.x,a.center.y-p.y)-Math.hypot(b.center.x-p.x,b.center.y-p.y))[0]!;
  }) : [boundary[Math.floor(boundary.length/2)]!];
  const start = cells.get(labels.keys().next().value!)!;
  for(const entrance of entrances) for(const c of path(start,entrance)) if(!labels.has(c.key)) labels.set(c.key,0);

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
    for(const [i,rings] of fromPolygons(floors).entries()) output.push({...base,id:`floor-${label}-${i}`,type:'area',role:'floor',name:roomNames.get(label),rings,fill:label%2?'#665948':'#73634e'});
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
  const connected=new Set<number>([labels.get(entrances[0]!.key)!]);
  const doors=new Set<Edge>();
  const shuffled=[...edges];
  for(let i=shuffled.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j]!,shuffled[i]!];}
  let changed=true;
  while(changed) {changed=false;for(const edge of shuffled) if(edge.right!==undefined && connected.has(edge.left)!==connected.has(edge.right)) {
    doors.add(edge);connected.add(edge.left);connected.add(edge.right);changed=true;
  }}
  if(connected.size!==new Set(labels.values()).size) throw new Error('Could not connect rooms around the manual walls.');
  for(const entrance of entrances) {
    const candidates=edges.filter(e=>e.right===undefined && e.left===labels.get(entrance.key) && outerDistance({x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2})<g*0.01);
    candidates.sort((a,b)=>Math.hypot((a.a.x+a.b.x)/2-entrance.center.x,(a.a.y+a.b.y)/2-entrance.center.y)-Math.hypot((b.a.x+b.b.x)/2-entrance.center.x,(b.a.y+b.b.y)/2-entrance.center.y));
    const edge=candidates.find(e=>e.manual||!wallAt({x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2}));
    if(edge) doors.add(edge);
    else throw new Error('No clear entrance fits. Add an entrance door to the footprint.');
  }
  for(const [i,e] of edges.entries()) {
    const mid={x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2};
    if(wallAt(mid)) continue;
    // Clipping keeps boundary wall pieces inside concave footprints and holes.
    if(!pointInPolygon({x:mid.x+g*0.001,y:mid.y+g*0.001},region) && !pointInPolygon({x:mid.x-g*0.001,y:mid.y-g*0.001},region)) continue;
    if(doors.has(e)&&!e.manual) output.push({...base,id:`door-${i}`,type:'door',a:e.a,b:e.b,kind:'door',open:false});
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
      for(const [j,[lo,hi]] of pieces.entries()) if(hi-lo>1e-8) output.push({...base,id:`wall-${i}-${j}`,type:'wall',
        points:[{x:e.a.x+lo*dx,y:e.a.y+lo*dy},{x:e.a.x+hi*dx,y:e.a.y+hi*dy}],blocksMove:true,blocksSight:true});
    }
  }
  return output;
}

export function generateDungeon(input: GeneratorInput<DungeonParams>): Entity[] {
  const layout=dungeonLayout(input);
  return [...layout,...dressDungeon(input,layout)];
}
registerGenerator({type:'dungeon',title:'Dungeon / interior',params:DungeonParamsSchema,generate:generateDungeon,dress:dressDungeon});
