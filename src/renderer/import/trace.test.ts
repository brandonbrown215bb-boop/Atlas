import { expect,it } from 'vitest';
import { traceGeography,traceEntities } from './trace';
import { pointInPolygon } from '../geom/hitTest';

it('automatically traces an island, inland lake and river, then preserves calibrated rotation',()=>{
  const w=100,h=80,pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const land=x>=15&&x<=85&&y>=10&&y<=70,lake=x>=35&&x<=49&&y>=30&&y<=44,river=x===65&&y>=10&&y<=45;
    const color=land&&!lake&&!river?[155,175,120]:[30,95,150],i=(y*w+x)*4;pixels.set([...color,255],i);
  }
  const result=traceGeography({width:w,height:h,pixels,sensitivity:65});
  expect(result.land.some(r=>pointInPolygon({x:25,y:25},r))).toBe(true);
  expect(result.land.some(r=>pointInPolygon({x:40,y:35},r))).toBe(false);
  expect(result.lakes.length).toBeGreaterThan(0);expect(result.rivers.length).toBeGreaterThan(0);
  const entities=traceEntities(result,{id:'image',type:'image',layerId:'base',origin:'manual',rev:0,assetId:'a',x:100,y:200,w:1000,h:800,rotation:Math.PI/2},'base');
  expect(entities.every(e=>e.type==='area'||e.type==='path')).toBe(true);
  const first=entities.find(e=>e.type==='area')!;if(first.type==='area')expect(first.rings[0]!.every(p=>p.x<=100&&p.y>=200)).toBe(true);
});

it('review corrections are authoritative and thin islands/holes remain editable',()=>{
  const w=40,h=40,pixels=new Uint8ClampedArray(w*h*4).fill(255),mask=new Uint8Array(w*h).fill(1);
  for(let y=8;y<32;y++)for(let x=8;x<32;x++)mask[y*w+x]=0;
  const result=traceGeography({width:w,height:h,pixels,sensitivity:30,mask});
  expect(result.land).toHaveLength(1);expect(result.mask).toEqual(mask);
});
