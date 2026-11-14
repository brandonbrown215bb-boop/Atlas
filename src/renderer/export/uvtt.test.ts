import { expect,it } from 'vitest';
import { MapDocSchema } from '../model/schema';
import { exportUvtt,clipSegment } from './uvtt';
it('exports a fixture room, door, secret door and light in grid units without private content or fog',()=>{
  const base={origin:'manual',rev:1,layerId:'l'};
  const map=MapDocSchema.parse({id:'m',name:'Room',kind:'interior',bounds:{x:10,y:20,w:20,h:20},grid:{size:2,visible:true},layers:[{id:'l',name:'Art',visible:true,locked:false,gmOnly:false}],entities:{
    wall:{...base,id:'wall',type:'wall',points:[{x:10,y:20},{x:30,y:20},{x:30,y:40},{x:10,y:40},{x:10,y:20}],blocksSight:true,blocksMove:true},
    door:{...base,id:'door',type:'door',a:{x:12,y:20},b:{x:14,y:20},kind:'door',open:true},
    secret:{...base,id:'secret',type:'door',a:{x:20,y:20},b:{x:22,y:20},kind:'secret',open:true},
    private:{...base,id:'private',type:'light',x:15,y:25,radius:5,color:'#ff0000',gmOnly:true},
    light:{...base,id:'light',type:'light',x:20,y:30,radius:6,color:'#ff0000'},
  },generators:{},revision:1,deleted:{},fog:{enabled:true,revealed:[]}});
  const result=exportUvtt(map,'PNG',100), doc=result.document;
  expect(doc.resolution).toEqual({map_origin:{x:0,y:0},map_size:{x:10,y:10},pixels_per_grid:100});
  expect(doc.portals).toHaveLength(2);
  expect(doc.portals[0]).toMatchObject({bounds:[{x:1,y:0},{x:2,y:0}],closed:false});
  expect(doc.portals[1]).toMatchObject({closed:true,secret:true});
  expect(doc.line_of_sight.slice(0,3)).toEqual([[{x:0,y:0},{x:1,y:0}],[{x:2,y:0},{x:5,y:0}],[{x:6,y:0},{x:10,y:0}]]);
  expect(doc.lights).toEqual([{position:{x:5,y:5},range:3,intensity:1,color:'ffff0000',shadows:true}]);
  expect(result.secretDoors).toEqual(['secret']);
  expect(JSON.stringify(doc)).not.toContain('fog');
});
it('clips crossing and disjoint wall segments',()=>{
  expect(clipSegment({x:-5,y:5},{x:15,y:5},{x:0,y:0,w:10,h:10})).toEqual([{x:0,y:5},{x:10,y:5}]);
  expect(clipSegment({x:-5,y:-5},{x:-1,y:-1},{x:0,y:0,w:10,h:10})).toBeNull();
});
