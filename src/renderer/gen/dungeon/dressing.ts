import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import type { Entity, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { DungeonParams } from './layout';

export const ROOM_PURPOSES = ['random','storage','bedroom','tavern','shrine','guardroom'] as const;
type Purpose = Exclude<typeof ROOM_PURPOSES[number], 'random'>;
const furniture: Record<Purpose, { role: string; wall: boolean; count: number }[]> = {
  storage: [{role:'barrel',wall:true,count:3},{role:'crate',wall:true,count:3}],
  bedroom: [{role:'bed',wall:true,count:2},{role:'table',wall:true,count:1},{role:'chair',wall:false,count:1}],
  tavern: [{role:'table',wall:false,count:3},{role:'chair',wall:false,count:4},{role:'barrel',wall:true,count:2}],
  shrine: [{role:'table',wall:true,count:1},{role:'rock',wall:false,count:2}],
  guardroom: [{role:'table',wall:false,count:1},{role:'chair',wall:false,count:2},{role:'crate',wall:true,count:2}],
};

/** Small props occupy a square; the circumscribed circle is used for conservative clearance. */
export function dressDungeon(input: GeneratorInput<DungeonParams>, layout: Entity[]): Entity[] {
  const {grid:g,params,region}=input;
  if(!params.density) return [];
  const random=mulberry32(input.seed ^ 0x4b1d2f37), radius=g*0.35*Math.SQRT2;
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
  for(const [roomIndex,floor] of floors.entries()) {
    const chosen=params.roomPurposes[floor.name ?? ''] ?? params.purpose;
    const purpose: Purpose=chosen==='random'?ROOM_PURPOSES[1+Math.floor(random()*(ROOM_PURPOSES.length-1))]! as Purpose:chosen;
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
      if(wallDistance(p)<radius+g*.05) continue;
      if(doors.some(d=>distanceToSegment(p,d.a,d.b)<g+radius)) continue;
      if(routes.some(([a,b])=>distanceToSegment(p,a,b)<radius+g*.5)) continue;
      if(obstacles.some(e=>{
        const b=getEntityBounds(e);return b&&p.x+radius>b.minX&&p.x-radius<b.maxX&&p.y+radius>b.minY&&p.y-radius<b.maxY;
      })) continue;
      candidates.push(p);
    }
    // Random ties keep long walls from collecting every prop at the same end.
    const jitter=new Map(candidates.map(p=>[p,random()*g*.3]));
    for(const item of furniture[purpose]) {
      const count=Math.round(item.count*params.density);
      const sorted=[...candidates].sort((a,b)=>(wallDistance(a)-wallDistance(b))*(item.wall?1:-1)+jitter.get(a)!-jitter.get(b)!);
      let added=0;
      for(const p of sorted) {
        if(added>=count) break;
        if(placed.some(e=>e.type==='prop'&&Math.hypot(p.x-e.x,p.y-e.y)<radius*2+g*.15)) continue;
        const assets=themeAssets(input.theme,item.role), asset=assets[Math.floor(random()*assets.length)]!;
        const nearest=[...wallSegments]
          .sort((a,b)=>distanceToSegment(p,a.a,a.b)-distanceToSegment(p,b.a,b.b))[0];
        placed.push({id:`dressing-${roomIndex}-${placed.length}`,type:'prop',origin:'generated',layerId:'generated',rev:0,
          name:`${purpose}: ${item.role}`, x:p.x,y:p.y,w:g*.7,h:g*.7,scale:1,flipX:false,
          rotation:item.wall&&nearest?Math.atan2(nearest.b.y-nearest.a.y,nearest.b.x-nearest.a.x):0,
          ...(asset.startsWith('builtin:')?{builtin:asset.slice(8)}:{assetId:asset})});
        added++;
      }
    }
  }
  return placed;
}
