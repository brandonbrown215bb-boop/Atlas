import { expect,it } from 'vitest';
import { clipOutside } from './clipOutside';
const rect=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
it('cuts crossing roads into outside pieces and removes wholly covered walls',()=>{
  expect(clipOutside([{x:-5,y:5},{x:15,y:5}],false,rect)).toEqual([[{x:-5,y:5},{x:0,y:5}],[{x:10,y:5},{x:15,y:5}]]);
  expect(clipOutside([{x:2,y:2},{x:8,y:8}],false,rect)).toEqual([]);
});
it('retains connected outside bends',()=>{
  expect(clipOutside([{x:-5,y:-5},{x:-1,y:-5},{x:-1,y:5}],false,rect)).toEqual([[{x:-5,y:-5},{x:-1,y:-5},{x:-1,y:5}]]);
});
