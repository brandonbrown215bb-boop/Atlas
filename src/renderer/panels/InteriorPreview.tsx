import type { MapDoc } from '../model/schema';

export function InteriorPreview({map}:{map:MapDoc}) {
  const entities=Object.values(map.entities);
  const path=(rings:{x:number;y:number}[][])=>rings.map(r=>r.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')+' Z').join(' ');
  return <svg data-testid="interior-preview" aria-label="Interior layout preview" role="img"
    viewBox={`-1 -1 ${map.bounds.w+2} ${map.bounds.h+2}`} style={{width:'100%',height:240,background:'#22272d',border:'1px solid var(--atlas-border)'}}>
    {entities.map(e=>e.type==='area'?<path key={e.id} d={path(e.rings)} fill={e.role==='floor'?(e.fill??'#73634e'):'#333'} fillRule="evenodd"/>:null)}
    {entities.map(e=>e.type==='wall'?<polyline key={e.id} points={e.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#e5e7eb" strokeWidth={.16}/>
      :e.type==='door'?<line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={e.kind==='secret'?'#c084fc':'#d97706'} strokeWidth={.24}/>
      :e.type==='prop'?<rect key={e.id} x={e.x-(e.w??1)/2} y={e.y-(e.h??1)/2} width={e.w??1} height={e.h??1} fill="#c39b70" transform={`rotate(${e.rotation*180/Math.PI} ${e.x} ${e.y})`}><title>{e.name}</title></rect>:null)}
  </svg>;
}
