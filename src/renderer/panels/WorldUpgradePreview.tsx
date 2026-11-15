import type { MapDoc } from '../model/schema';
import { geographicEntities } from '../geom/geography';
export function WorldUpgradePreview({map}:{map:MapDoc}){
  const entities=geographicEntities(map),b=map.bounds,stroke=Math.max(b.w,b.h)/700;
  const path=(rings:{x:number;y:number}[][])=>rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ')+'Z').join(' ');
  return <svg data-testid="terrain-upgrade-preview" role="img" aria-label="Proposed tectonic terrain" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} style={{width:'100%',height:260,background:'#17212a'}}>
    {entities.map(e=>e.type==='area'?<path key={e.id} d={path(e.rings)} fill={e.fill??(e.role==='water'?'#244c67':e.role==='land'?'#9ba67b':'#78916f')} fillRule="evenodd"/>:
      e.type==='path'?<polyline key={e.id} points={e.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={e.role==='river'?'#3189c8':'#8f7962'} strokeWidth={stroke}/>:
      e.type==='prop'&&e.symbolKind==='settlement'?<circle key={e.id} cx={e.x} cy={e.y} r={stroke*2} fill="#d9a544"/>:null)}
  </svg>;
}
