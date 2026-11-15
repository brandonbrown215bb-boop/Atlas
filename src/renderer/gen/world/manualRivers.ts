import type { Entity, Point } from '../../model/schema';

export function validateAuthoredRivers(entities:Entity[]){
  for(const e of entities)if(e.type==='path'&&e.role==='river'){
    const length=e.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-e.points[i]!.x,p.y-e.points[i]!.y),0);
    if(length<1e-7)throw new Error(`Authored river ${e.name??e.id} has no length. Edit or remove it before populating.`);
    const first=e.points[0]!,last=e.points[e.points.length-1]!;
    if(e.closed||Math.hypot(first.x-last.x,first.y-last.y)<1e-7)throw new Error(`Authored river ${e.name??e.id} forms a closed loop. Mark the enclosed water as a lake or open the river at its outlet.`);
  }
}

/** A tributary joins the first authored river it crosses; the authored line is untouched. */
export function joinAuthoredRivers(points:Point[],constraints:Entity[]):Point[]{
  const rivers=constraints.filter((e):e is Extract<Entity,{type:'path'}>=>e.type==='path'&&e.role==='river');
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!,dx=b.x-a.x,dy=b.y-a.y;let nearest:{t:number;p:Point}|undefined;
    for(const river of rivers)for(let j=1;j<river.points.length;j++){
      const c=river.points[j-1]!,d=river.points[j]!,ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;if(Math.abs(den)<1e-12)continue;
      const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;
      if(t>=0&&t<=1&&u>=0&&u<=1&&(!nearest||t<nearest.t))nearest={t,p:{x:a.x+t*dx,y:a.y+t*dy}};
    }
    if(nearest)return [...points.slice(0,i),nearest.p];
  }return points;
}
