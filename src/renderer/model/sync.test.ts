import { expect,it } from 'vitest';
import { MapDocSchema, type MapDoc, type Entity } from './schema';
import { planSync } from './sync';
import { transferMap, type Placement } from './transfer';
import { createWorldStore } from './store';

const label=(id:string,text:string,rev=1):Extract<Entity,{type:'label'}>=>({id,type:'label',text,x:1,y:1,size:12,layerId:'l',origin:'manual',rev});
function map(id='map'):MapDoc{return MapDocSchema.parse({id,name:'Room',kind:'region',bounds:{x:0,y:0,w:10,h:10},grid:{size:1,visible:true},layers:[{id:'l',name:'Art',visible:true,locked:false,gmOnly:false}],entities:{e:label('e','original')},generators:{},revision:1,deleted:{},fog:{enabled:false,revealed:[]}});}
function pair(){const mine=map(),theirs=map();mine.link={worldId:'b',mapId:'map',syncedMyRev:1,syncedTheirRev:1};theirs.link={worldId:'a',mapId:'map',syncedMyRev:1,syncedTheirRev:1};return {mine,theirs};}
const edit=(m:MapDoc,text:string)=>{m.revision++;m.entities.e=label('e',text,m.revision);};
const remove=(m:MapDoc)=>{m.revision++;delete m.entities.e;m.deleted.e=m.revision;};
it('takes theirs-only edits and deletions, and keeps mine-only edits',()=>{
  const a=pair();edit(a.theirs,'other');expect(planSync(a.mine,a.theirs).map.entities.e).toMatchObject({text:'other'});
  const b=pair();edit(b.mine,'local');expect(planSync(b.mine,b.theirs).map.entities.e).toMatchObject({text:'local'});
  const c=pair();remove(c.theirs);expect(planSync(c.mine,c.theirs).map.entities.e).toBeUndefined();expect(planSync(c.mine,c.theirs).map.deleted.e).toBe(2);
});
it('both-changed conflicts default to mine and accept theirs',()=>{
  const {mine,theirs}=pair();edit(mine,'local');edit(theirs,'other');
  const result=planSync(mine,theirs);expect(result.conflicts).toMatchObject([{id:'e',reason:'both changed'}]);expect(result.map.entities.e).toMatchObject({text:'local'});
  expect(planSync(mine,theirs,{e:'theirs'}).map.entities.e).toMatchObject({text:'other'});
});
for(const deleted of ['mine','theirs'] as const)it(`changed versus deleted conflicts (${deleted} deleted) offer both choices`,()=>{
  const {mine,theirs}=pair();if(deleted==='mine'){remove(mine);edit(theirs,'other');}else {edit(mine,'local');remove(theirs);}
  const kept=planSync(mine,theirs),taken=planSync(mine,theirs,{e:'theirs'});
  expect(kept.conflicts[0]?.reason).toBe('changed versus deleted');expect(Boolean(kept.map.entities.e)).toBe(deleted!=='mine');expect(Boolean(taken.map.entities.e)).toBe(deleted==='mine');
});
it('new remote entities bring their layers; deleted references are pruned from places',()=>{
  const {mine,theirs}=pair();mine.entities.place={id:'place',type:'place',name:'Place',category:'',notes:'',gmNotes:'',entityIds:['e'],layerId:'l',origin:'manual',rev:1};
  remove(theirs);theirs.layers.push({id:'new',name:'New',visible:true,locked:false,gmOnly:false});theirs.entities.new={...label('new','New',2),layerId:'new'};
  const result=planSync(mine,theirs);expect(result.map.layers.some(l=>l.id==='new')).toBe(true);expect(result.map.entities.place).toMatchObject({entityIds:[]});
});
it('a second sync with no changes is a no-op and one undo reverses the first sync',()=>{
  const {mine,theirs}=pair();edit(theirs,'other');const store=createWorldStore();
  const meta={id:'a',name:'A',formatVersion:1,maps:[{id:'map',name:'Room',kind:'region' as const}],themes:{}};
  store.getState().loadWorld(meta,{map:mine});
  store.getState().execute('map.syncLinked',{mapId:'map',otherWorldId:'b',otherMap:theirs});
  expect(store.getState().world!.maps.map!.entities.e).toMatchObject({text:'other'});
  expect(store.getState().history.past).toHaveLength(1);
  const first=store.getState().world;
  const second=store.getState().execute('map.syncLinked',{mapId:'map',otherWorldId:'b',otherMap:theirs});expect(second).toMatchObject({updated:false});
  expect(store.getState().world).toBe(first);expect(store.getState().history.past).toHaveLength(1);
  store.getState().undo();expect(store.getState().world!.maps.map).toEqual(mine);
});
it('linked copies retain ids, reject collisions, and record reversible coordinate conversions for placement',()=>{
  const original=map('incoming'),parent=map('parent');
  const source={meta:{id:'a',name:'A',formatVersion:1,maps:[{id:original.id,name:original.name,kind:original.kind}],themes:{}},maps:{incoming:original}};
  const target={meta:{id:'b',name:'B',formatVersion:1,maps:[{id:parent.id,name:parent.name,kind:parent.kind}],themes:{}},maps:{parent}};
  const placement:Placement={parentMapId:'parent',x:40,y:50,rotation:Math.PI/2,scale:2,underneath:'merge',seamMargin:0};
  const linked=transferMap(source,target,{mapId:'incoming',mode:'linked',placement});
  expect(linked.target.maps.incoming!.entities.e).toMatchObject({id:'e',x:18,y:2});
  expect(()=>transferMap(source,linked.target,{mapId:'incoming',mode:'linked'})).toThrow('already exist');
  const theirs=structuredClone(linked.source.maps.incoming!);theirs.revision++;theirs.entities.e={...label('e','Updated',2),x:3,y:4};
  const pulled=planSync(linked.target.maps.incoming!,theirs);
  expect(pulled.map.entities.e).toMatchObject({text:'Updated'});
  if(pulled.map.entities.e?.type!=='label')throw new Error();
  expect(pulled.map.entities.e.x).toBeCloseTo(12);expect(pulled.map.entities.e.y).toBeCloseTo(6);
  const back=planSync(linked.source.maps.incoming!,pulled.map);
  if(back.map.entities.e?.type!=='label')throw new Error();expect(back.map.entities.e.x).toBeCloseTo(3);expect(back.map.entities.e.y).toBeCloseTo(4);
});
