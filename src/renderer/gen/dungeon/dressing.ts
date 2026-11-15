import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import type { Entity, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { DungeonParams } from './layout';

export const ROOM_PURPOSES = ['random','storage','bedroom','tavern','shrine','guardroom'] as const;
type Purpose = Exclude<typeof ROOM_PURPOSES[number], 'random'>;
const furniture: Record<Purpose, { role: string; wall: boolean; count: number }[]> = {
  storage: [{role:'barrel',wall:true,count:4},{role:'crate',wall:true,count:4}],
  bedroom: [{role:'bed',wall:true,count:2},{role:'rug',wall:false,count:1},{role:'table',wall:true,count:1},{role:'chair',wall:false,count:1}],
  tavern: [{role:'hearth',wall:true,count:1},{role:'bar',wall:true,count:1},{role:'table',wall:false,count:3},{role:'chair',wall:false,count:4},{role:'barrel',wall:true,count:2}],
  shrine: [{role:'altar',wall:true,count:1},{role:'rug',wall:false,count:1},{role:'pillar',wall:false,count:2},{role:'chair',wall:false,count:2}],
  guardroom: [{role:'table',wall:false,count:1},{role:'chair',wall:false,count:2},{role:'crate',wall:true,count:2},{role:'barrel',wall:true,count:1}],
};

const itemDimensions = (role: string, g: number): { w: number; h: number } => {
  if (role === 'bar') return { w: g * 1.9, h: g * 0.72 };
  if (role === 'hearth') return { w: g * 1.35, h: g * 0.85 };
  if (role === 'rug') return { w: g * 1.65, h: g * 1.15 };
  if (role === 'pillar') return { w: g * 0.72, h: g * 0.72 };
  if (role === 'table') return { w: g * 1.12, h: g * 0.76 };
  if (role === 'bed') return { w: g * 1.15, h: g * 0.84 };
  if (role === 'altar') return { w: g * 1.2, h: g * 0.7 };
  if (role === 'chair') return { w: g * 0.56, h: g * 0.56 };
  return { w: g * 0.68, h: g * 0.68 };
};

/** Small props occupy a square; the circumscribed circle is used for conservative clearance. */
export function dressDungeon(input: GeneratorInput<DungeonParams>, layout: Entity[]): Entity[] {
  const {grid:g,params,region}=input;
  const random=mulberry32(input.seed ^ 0x4b1d2f37), baseRadius=g*0.35*Math.SQRT2;
  const floors=layout.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='floor'&&e.name!=='Corridor');
  const all=[...layout,...input.constraints];
  const walls=all.filter((e):e is Extract<Entity,{type:'wall'}>=>e.type==='wall');
  const wallSegments=walls.flatMap(w=>w.points.slice(1).map((b,i)=>({
    a:{x:w.points[i]!.x,y:w.points[i]!.y},b:{x:b.x,y:b.y},
  })));
  const doors=all.filter((e):e is Extract<Entity,{type:'door'}>=>e.type==='door');
  const obstacles=all.filter(e=>e.type==='prop'||e.type==='image'||(e.type==='area'&&(e.role==='water'||e.role==='building')));
  const placed: Entity[]=[];
  const wallDistances=new Map<Point,number>();
  const wallDistance=(p:Point)=>{
    const cached=wallDistances.get(p);
    if(cached!==undefined)return cached;
    const distance=Math.min(Infinity,...wallSegments.map(s=>distanceToSegment(p,s.a,s.b)));
    wallDistances.set(p,distance);
    return distance;
  };
  const purposeBag=ROOM_PURPOSES.slice(1) as Purpose[];
  for(let i=purposeBag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[purposeBag[i],purposeBag[j]]=[purposeBag[j]!,purposeBag[i]!];}
  const floorArea = (f: Extract<Entity, { type: 'area' }>) => {
    const b = getEntityBounds(f);
    return b ? (b.maxX - b.minX) * (b.maxY - b.minY) : 0;
  };
  const largestIdx = floors.reduce((best, f, idx) => (floorArea(f) > floorArea(floors[best]!) ? idx : best), 0);
  const tavernWingCycle: Purpose[] = ['storage', 'bedroom', 'guardroom', 'bedroom'];
  let tavernWingIdx = 0;
  for(const [roomIndex,floor] of floors.entries()) {
    const chosen=params.roomPurposes[floor.name ?? ''] ?? (params.purpose==='random'?floor.roomPurpose??'random':params.purpose);
    const purpose: Purpose = chosen !== 'random'
      ? (params.purpose === 'tavern' && !params.roomPurposes[floor.name ?? ''] && floors.length > 1 && params.mode === 'building'
        ? (roomIndex === largestIdx ? 'tavern' : tavernWingCycle[tavernWingIdx++ % tavernWingCycle.length]!)
        : chosen as Purpose)
      : purposeBag[roomIndex%purposeBag.length]!;
    if(floor.origin==='generated')floor.roomPurpose=purpose;
    if(!params.density)continue;
    const box=getEntityBounds(floor)!;
    const roomDoors=doors.filter(d=>floor.rings.some(r=>r.some((a,i)=>distanceToSegment({x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2},a,r[(i+1)%r.length]!)<g*0.1)));
    const routes: [Point,Point][]=[];
    for(let i=0;i<roomDoors.length;i++) for(let j=i+1;j<roomDoors.length;j++) {
      const a=roomDoors[i]!,b=roomDoors[j]!;
      routes.push([{x:(a.a.x+a.b.x)/2,y:(a.a.y+a.b.y)/2},{x:(b.a.x+b.b.x)/2,y:(b.a.y+b.b.y)/2}]);
    }
    const candidates: Point[]=[];
    for(let y=box.minY+g/2;y<box.maxY;y+=g) for(let x=box.minX+g/2;x<box.maxX;x+=g) {
      const p={x,y};
      const corners=[{x:x-g*.35,y:y-g*.35},{x:x+g*.35,y:y-g*.35},{x:x+g*.35,y:y+g*.35},{x:x-g*.35,y:y+g*.35}];
      if(!corners.every(c=>pointInPolygon(c,floor.rings)&&pointInPolygon(c,region))) continue;
      if(wallDistance(p)<baseRadius+g*.05) continue;
      if(doors.some(d=>distanceToSegment(p,d.a,d.b)<g+baseRadius)) continue;
      if(routes.some(([a,b])=>distanceToSegment(p,a,b)<baseRadius+g*.5)) continue;
      if(obstacles.some(e=>{
        const b=getEntityBounds(e);return b&&p.x+baseRadius>b.minX&&p.x-baseRadius<b.maxX&&p.y+baseRadius>b.minY&&p.y-baseRadius<b.maxY;
      })) continue;
      candidates.push(p);
    }
    const fitsItem = (p: Point, itemRadius: number) =>
      wallDistance(p) >= itemRadius + g * 0.02
      && doors.every(d => distanceToSegment(p, d.a, d.b) >= g + itemRadius)
      && routes.every(([a, b]) => distanceToSegment(p, a, b) >= itemRadius + g * 0.5)
      && obstacles.every(e => {
        const b = getEntityBounds(e);
        return !b || p.x + itemRadius <= b.minX || p.x - itemRadius >= b.maxX || p.y + itemRadius <= b.minY || p.y - itemRadius >= b.maxY;
      });

    // Random ties keep long walls from collecting every prop at the same end.
    const jitter=new Map(candidates.map(p=>[p,random()*g*.3]));
    const areaScale = Math.min(2.2, Math.max(1, candidates.length / 26));
    const roomTables: Point[] = [];
    const supplyAnchors: Point[] = [];
    let placedAltar: Point | null = null;
    for(const item of furniture[purpose]) {
      const dims = itemDimensions(item.role, g);
      const itemRadius = Math.hypot(dims.w, dims.h) / 2;
      const isTable = item.role === 'table';
      const isUnique = item.role === 'hearth' || item.role === 'bar' || item.role === 'rug' || item.role === 'altar';
      const baseCount = isUnique
        ? (params.density > 0 ? item.count : 0)
        : isTable
          ? Math.min(4, Math.round(item.count * params.density * Math.min(1.4, areaScale)))
          : Math.round(item.count * params.density * areaScale);
      const count = item.role === 'chair' && roomTables.length > 0 && !item.wall
        ? Math.max(baseCount, roomTables.length * 3)
        : (item.role === 'chair' && purpose === 'bedroom' && roomTables.length === 0 ? 0 : baseCount);
      let sorted=[...candidates].sort((a,b)=>(wallDistance(a)-wallDistance(b))*(item.wall?1:-1)+jitter.get(a)!-jitter.get(b)!);
      if (item.role === 'chair' && roomTables.length > 0 && !item.wall) {
        // Interleave chairs round-robin around placed tables so no table is left chairless.
        const perTable = roomTables.map(t =>
          [...candidates]
            .filter(p => Math.hypot(p.x - t.x, p.y - t.y) <= g * 1.25)
            .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))
        );
        const interleaved: Point[] = [];
        const seen = new Set<Point>();
        const maxLen = Math.max(0, ...perTable.map(list => list.length));
        for (let i = 0; i < maxLen; i++) {
          for (const list of perTable) {
            const pt = list[i];
            if (pt && !seen.has(pt)) {
              seen.add(pt);
              interleaved.push(pt);
            }
          }
        }
        const rest = sorted.filter(p => !seen.has(p));
        sorted = [...interleaved, ...rest];
      } else if (purpose === 'shrine' && item.role === 'chair' && placedAltar) {
        const altar = placedAltar;
        sorted = [...candidates].sort((a, b) => {
          const da = Math.abs(Math.hypot(a.x - altar.x, a.y - altar.y) - g * 2.2);
          const db = Math.abs(Math.hypot(b.x - altar.x, b.y - altar.y) - g * 2.2);
          return da - db + jitter.get(a)! - jitter.get(b)!;
        });
      }
      const isClusteredSupply = item.wall && (item.role === 'barrel' || item.role === 'crate');
      const remaining = [...sorted];
      let added=0;
      while (added < count && remaining.length > 0) {
        if (isClusteredSupply && supplyAnchors.length > 0) {
          remaining.sort((a, b) => {
            const da = Math.min(...supplyAnchors.map(s => Math.hypot(a.x - s.x, a.y - s.y))) + wallDistance(a) * 0.6;
            const db = Math.min(...supplyAnchors.map(s => Math.hypot(b.x - s.x, b.y - s.y))) + wallDistance(b) * 0.6;
            return da - db;
          });
        }
        const p = remaining.shift()!;
        if(!fitsItem(p, itemRadius)) continue;
        const minSpacing = isTable ? g * 2.4 : itemRadius * 1.85 + g * 0.1;
        if(placed.some(e=>e.type==='prop' && (e.name?.endsWith(': table') || isTable ? Math.hypot(p.x-e.x,p.y-e.y) < minSpacing : Math.hypot(p.x-e.x,p.y-e.y) < itemRadius + Math.hypot(e.w ?? g * 0.7, e.h ?? g * 0.7) / 2 + g * 0.08))) continue;
        const assets=themeAssets(input.theme,item.role), asset=assets[Math.floor(random()*assets.length)]!;
        const nearest=[...wallSegments]
          .sort((a,b)=>distanceToSegment(p,a.a,a.b)-distanceToSegment(p,b.a,b.b))[0];
        let rot = item.wall && nearest ? Math.atan2(nearest.b.y - nearest.a.y, nearest.b.x - nearest.a.x) : 0;
        if (item.role === 'chair' && roomTables.length > 0) {
          const table = [...roomTables].sort((a, b) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(p.x - b.x, p.y - b.y))[0]!;
          if (Math.hypot(p.x - table.x, p.y - table.y) <= g * 1.35) {
            rot = Math.atan2(table.y - p.y, table.x - p.x) + Math.PI / 2;
          }
        } else if (purpose === 'shrine' && item.role === 'chair' && placedAltar) {
          rot = Math.atan2(placedAltar.y - p.y, placedAltar.x - p.x) + Math.PI / 2;
        }
        if (isTable) roomTables.push(p);
        if (item.role === 'altar') placedAltar = p;
        if (isClusteredSupply) supplyAnchors.push(p);
        placed.push({id:`dressing-${roomIndex}-${placed.length}`,type:'prop',origin:'generated',layerId:'generated',rev:0,
          name:`${purpose}: ${item.role}`, x:p.x,y:p.y,w:dims.w,h:dims.h,scale:1,flipX:false,
          rotation:rot,
          ...(asset.startsWith('builtin:')?{builtin:asset.slice(8)}:{assetId:asset})});
        added++;
      }
    }
  }
  return placed;
}
