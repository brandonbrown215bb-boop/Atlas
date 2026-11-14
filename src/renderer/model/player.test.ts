import { expect, it } from 'vitest';
import { MapDocSchema } from './schema';
import { playerRenderList } from './player';

export function fixture() {
  return MapDocSchema.parse({ id:'map', name:'Room', kind:'interior', bounds:{x:0,y:0,w:20,h:20}, grid:{size:1.524,visible:true},
    layers:[{id:'public',name:'Public',visible:true,locked:false,gmOnly:false},{id:'gm',name:'GM',visible:true,locked:false,gmOnly:true}],
    entities:{}, generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]} });
}
it('excludes private layers, entities, notes, portals, secret markers, and optionally labels', () => {
  const map = fixture();
  const base = {origin:'manual' as const,rev:0,layerId:'public'};
  map.entities = {
    label:{...base,id:'label',type:'label',x:1,y:1,text:'Town',size:12},
    gm:{...base,id:'gm',type:'label',x:2,y:2,text:'Secret',size:12,gmOnly:true},
    layer:{...base,id:'layer',layerId:'gm',type:'label',x:2,y:2,text:'Private',size:12},
    place:{...base,id:'place',type:'place',name:'Shop',notes:'note',gmNotes:'secret',category:'',entityIds:[]},
    secret:{...base,id:'secret',type:'door',a:{x:0,y:0},b:{x:1,y:0},kind:'secret',open:false},
  };
  expect(playerRenderList(map).map(e=>e.id)).toEqual(['label']);
  expect(playerRenderList(map,false)).toEqual([]);
});
