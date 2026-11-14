import type { Point } from '../model/schema';
import { pointInPolygon } from './hitTest';

/** Keep line pieces outside a replacement footprint, including lines with both ends outside. */
export function clipOutside(points:Point[],closed:boolean,footprint:Point[]):Point[][] {
  const result:Point[][]=[];
  const pairs=points.slice(1).map((b,i)=>[points[i]!,b] as const);
  if(closed && points.length>2)pairs.push([points[points.length-1]!,points[0]!] as const);
  for(const [a,b] of pairs) {
    const dx=b.x-a.x,dy=b.y-a.y;
    const cuts=[0,1];
    for(let i=0;i<footprint.length;i++) {
      const c=footprint[i]!,d=footprint[(i+1)%footprint.length]!,ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;
      if(Math.abs(den)<1e-12)continue;
      const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;
      if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
    }
    cuts.sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++) {
      const lo=cuts[i-1]!,hi=cuts[i]!;if(hi-lo<1e-10)continue;
      const midpoint={x:a.x+dx*(lo+hi)/2,y:a.y+dy*(lo+hi)/2};
      if(pointInPolygon(midpoint,[footprint]))continue;
      const start={x:a.x+dx*lo,y:a.y+dy*lo},end={x:a.x+dx*hi,y:a.y+dy*hi};
      const last=result[result.length-1],tail=last?.[last.length-1];
      if(tail&&Math.hypot(tail.x-start.x,tail.y-start.y)<1e-8)last!.push(end);else result.push([start,end]);
    }
  }
  return result;
}
