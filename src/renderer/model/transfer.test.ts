import { expect,it } from 'vitest';
import { MapDocSchema,type MapDoc } from './schema';
import { forkWorld,transferMap,validateWorld,WorldDocumentSchema } from './transfer';
import { createWorldStore } from './store';
import type { WorldDocument } from './commands';

function map(id:string,parent?:string):MapDoc {return MapDocSchema.parse({id,name:id,kind:'region',parent:parent?{mapId:parent,x:2,y:3,rotation:0}:undefined,bounds:{x:0,y:0,w:10,h:10},grid:{size:1,visible:true},layers:[{id:'l',name:'Art',visible:true,locked:false,gmOnly:false}],entities:{land:{id:'land',layerId:'l',type:'area',role:'land',rings:[[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]],origin:'manual',rev:1}},generators:{},revision:1,deleted:{},fog:{enabled:false,revealed:[]}});}
function world(id:string,maps:MapDoc[]):WorldDocument {return {meta:{id,name:id,formatVersion:1,themes:{default:{tree:['builtin:tree'] }},maps:maps.map(m=>({id:m.id,name:m.name,kind:m.kind,parentId:m.parent?.mapId}))},maps:Object.fromEntries(maps.map(m=>[m.id,m]))};}
function fixture() {
  const root=map('root'),child=map('child','root');child.kind='interior';
  root.entities.place={id:'place',type:'place',layerId:'l',origin:'manual',rev:1,name:'Shop',category:'shop',notes:'public',gmNotes:'private',entityIds:['land'],childMapId:'child'};
  root.entities.portal={id:'portal',type:'portal',layerId:'l',origin:'manual',rev:1,x:1,y:1,targetMapId:'child'};
  return {source:world('source',[root,child]),target:world('target',[map('target-map')])};
}
it('fork changes only world identity, name and provenance',()=>{
  const {source}=fixture(),fork=forkWorld(source,'Fork','new-id');
  expect(fork.maps).toEqual(source.maps);expect(fork.meta).toMatchObject({id:'new-id',name:'Fork',forkedFrom:{worldId:'source',worldName:'source'}});
  expect(source.meta.id).toBe('source');
});
it('copy remaps the entire tree without dangling places, portals, or shared mutable data',()=>{
  const {source,target}=fixture();const result=transferMap(source,target,{mapId:'root',mode:'copy'});
  const copied=result.target.maps[result.mapId]!;
  expect(copied.id).not.toBe('root');expect(Object.keys(result.target.maps)).toHaveLength(3);
  const place=Object.values(copied.entities).find(e=>e.type==='place')!;
  expect(place).toMatchObject({notes:'public',gmNotes:'private'});
  if(place.type!=='place')throw new Error();
  expect(result.target.maps[place.childMapId!]!.parent?.mapId).toBe(copied.id);
  expect(copied.entities[place.entityIds[0]!]).toBeDefined();
  expect(()=>validateWorld(result.target)).not.toThrow();expect(result.source).toEqual(source);
});
it('move removes source tree and incoming references, and is independently undoable via snapshot command',()=>{
  const {source,target}=fixture();const result=transferMap(source,target,{mapId:'root',mode:'move'});
  expect(result.source.meta.maps).toEqual([]);expect(result.source.maps).toEqual({});expect(source.maps.root).toBeDefined();
});
for(const underneath of ['replace','merge'] as const)it(`${underneath} placement produces valid land with rotation, scale and fixed interiors`,()=>{
  const {source,target}=fixture();const result=transferMap(source,target,{mapId:'root',mode:'copy',placement:{parentMapId:'target-map',x:5,y:5,rotation:Math.PI/2,scale:2,underneath,seamMargin:underneath==='merge'?0.1:0}});
  const incoming=result.target.maps[result.mapId]!;
  expect(incoming.bounds.w).toBeCloseTo(20);expect(incoming.bounds.h).toBeCloseTo(20);
  const interior=Object.values(result.target.maps).find(m=>m.kind==='interior')!;
  expect(interior.bounds).toEqual({x:0,y:0,w:10,h:10});expect(interior.grid.size).toBe(1);
  const parent=result.target.maps['target-map']!;
  const land=Object.values(parent.entities).filter(e=>e.type==='area'&&e.role==='land');
  expect(land.length).toBeGreaterThan(0);
  expect(()=>validateWorld(result.target)).not.toThrow();
  expect(incoming.parent?.footprintEntityId).toBeDefined();
});

it('replacement cuts crossing roads while preserving existing child footprints',()=>{
  const {source,target}=fixture();const parent=target.maps['target-map']!;
  parent.entities.road={id:'road',type:'path',points:[{x:-5,y:5},{x:15,y:5}],role:'road',width:1,closed:false,layerId:'l',origin:'manual',rev:1};
  parent.entities.footprint={id:'footprint',type:'area',role:'building',rings:[[{x:1,y:1},{x:2,y:1},{x:2,y:2},{x:1,y:2}]],layerId:'l',origin:'manual',rev:1};
  const child=map('existing-child','target-map');child.parent!.footprintEntityId='footprint';target.maps[child.id]=child;target.meta.maps.push({id:child.id,name:child.name,kind:child.kind,parentId:'target-map'});
  const result=transferMap(source,target,{mapId:'root',mode:'copy',placement:{parentMapId:'target-map',x:0,y:0,rotation:0,scale:1,underneath:'replace',seamMargin:0}});
  const placed=result.target.maps['target-map']!;
  expect(placed.entities.footprint).toEqual(parent.entities.footprint);
  expect(Object.values(placed.entities).filter(e=>e.type==='path').map(e=>e.type==='path'?e.points:[])).toEqual([[{x:-5,y:5},{x:0,y:5}],[{x:10,y:5},{x:15,y:5}]]);
  expect(()=>validateWorld(result.target)).not.toThrow();
});
it('undoing an applied transfer marks the restored maps unsaved',()=>{
  const {source,target}=fixture(),store=createWorldStore();
  store.getState().loadWorld(source.meta,source.maps,'C:/fixture');
  const before=WorldDocumentSchema.parse(store.getState().world),result=transferMap(before,target,{mapId:'root',mode:'move'});
  store.getState().execute('world.applyTransfer',{before,after:result.source});
  store.getState().markClean({world:true,mapIds:Object.keys(store.getState().dirtyMapIds)});
  store.getState().undo();
  expect(store.getState().world!.maps.root).toBeDefined();
  expect(store.getState().dirtyMapIds).toMatchObject({root:true,child:true});
});
it('replace placement leaves areas away from the footprint untouched and moves explored fog with revealed fog',()=>{
  const {source,target}=fixture();
  target.maps['target-map']!.entities.far={id:'far',type:'area',role:'biome:forest',layerId:'l',origin:'generated',rev:1,rings:[[{x:500,y:500},{x:510,y:500},{x:510,y:510},{x:500,y:510}]]};
  const seen=[[[{x:1,y:1},{x:3,y:1},{x:3,y:2}]]];
  source.maps.root!.fog.revealed=structuredClone(seen);source.maps.root!.fog.explored=structuredClone(seen);
  const result=transferMap(source,target,{mapId:'root',mode:'copy',placement:{parentMapId:'target-map',x:5,y:5,rotation:Math.PI/2,scale:2,underneath:'replace',seamMargin:0}});
  expect(result.target.maps['target-map']!.entities.far).toMatchObject({origin:'generated',rev:1});
  const fog=result.target.maps[result.mapId]!.fog;
  expect(fog.revealed).not.toEqual(seen);expect(fog.explored).toEqual(fog.revealed);
});
