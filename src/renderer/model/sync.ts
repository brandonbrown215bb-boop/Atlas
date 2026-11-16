import { MapDocSchema, type Entity, type MapDoc } from './schema';
import { rotateEntityPatch, scaleEntityPatch, translateEntityPatch } from '../geom/transform';

export type SyncChoices=Record<string,'mine'|'theirs'>;
export interface SyncConflict {id:string;name:string;mine:Entity|null;theirs:Entity|null;reason:'both changed'|'changed versus deleted'}
function convertLinkedEntity(entity:Entity, transform:NonNullable<MapDoc['link']>['transform']):Entity {
  const e=structuredClone(entity);
  if(!transform)return e;
  Object.assign(e,scaleEntityPatch(e,{x:0,y:0},transform.scale,transform.scale));
  Object.assign(e,rotateEntityPatch(e,{x:0,y:0},transform.rotation));
  Object.assign(e,translateEntityPatch(e,transform.x,transform.y));
  if((e.type==='area'||e.type==='path'||e.type==='wall')&&e.texture)e.texture.metersPerPixel*=transform.scale;
  return e;
}
const content=(e:Entity|undefined)=>e?JSON.stringify({...e,rev:0}):'deleted';
export function planSync(mine:MapDoc,theirs:MapDoc,choices:SyncChoices={}) {
  mine=MapDocSchema.parse(mine);theirs=MapDocSchema.parse(theirs);
  if(!mine.link || mine.link.mapId!==theirs.id)throw new Error('This map is not linked to that map');
  const link=mine.link;
  const map=structuredClone(mine),conflicts:SyncConflict[]=[],taken:string[]=[];
  const ids=new Set([...Object.keys(mine.entities),...Object.keys(mine.deleted),...Object.keys(theirs.entities),...Object.keys(theirs.deleted)]);
  const revision=mine.revision+1;
  for(const id of ids) {
    const local=mine.entities[id],other=theirs.entities[id];
    const myRev=local?.rev??mine.deleted[id]??0, theirRev=other?.rev??theirs.deleted[id]??0;
    const myChanged=myRev>link.syncedMyRev,theirChanged=theirRev>link.syncedTheirRev;
    if(!theirChanged)continue;
    const remote=other?convertLinkedEntity(other,link.transform):undefined;
    const equal=content(local)===content(remote);
    if(myChanged&&!equal) {
      conflicts.push({id,name:local?.name??remote?.name??id,mine:local??null,theirs:remote??null,reason:!local||!remote?'changed versus deleted':'both changed'});
      if(choices[id]!=='theirs')continue;
    }
    if(equal)continue;
    if(remote) {
      const layer=theirs.layers.find(l=>l.id===remote.layerId);
      if(!map.layers.some(l=>l.id===remote.layerId)) {
        if(!layer)throw new Error(`Linked entity has no layer: ${id}`);
        map.layers.push(structuredClone(layer));
      }
      map.entities[id]={...remote,rev:revision};delete map.deleted[id];
    } else {delete map.entities[id];map.deleted[id]=revision;}
    taken.push(id);
  }
  for(const e of Object.values(map.entities))if(e.type==='place'&&e.entityIds.some(id=>!map.entities[id])) {
    // A deleted linked object may also be referenced by an otherwise unchanged place.
    e.entityIds=e.entityIds.filter(id=>map.entities[id]);e.rev=revision;
  }
  const changed=taken.length>0 || contentMapPlaces(mine)!==contentMapPlaces(map);
  const localPoint=(p:{x:number;y:number})=>{
    const t=link.transform;if(!t)return {...p};
    return{x:t.x+t.scale*(p.x*Math.cos(t.rotation)-p.y*Math.sin(t.rotation)),y:t.y+t.scale*(p.x*Math.sin(t.rotation)+p.y*Math.cos(t.rotation))};
  };
  const rings=(r:NonNullable<MapDoc['groups']>[string]['boundary'])=>r?.map(ring=>ring.map(localPoint));
  const rect=(b:MapDoc['bounds'])=>{const points=[b,{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}].map(localPoint),x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return{x,y,w:Math.max(...points.map(p=>p.x))-x,h:Math.max(...points.map(p=>p.y))-y};};
  for(const id of taken){const e=map.entities[id];if(!e)continue;
    if(e.groupId&&theirs.groups?.[e.groupId]){map.groups??={};const g=theirs.groups[e.groupId]!;map.groups[e.groupId]={...structuredClone(g),boundary:rings(g.boundary)};}
    if(e.genId&&theirs.generators[e.genId]){const r=theirs.generators[e.genId]!;map.generators[e.genId]={...structuredClone(r),boundary:rings(r.boundary)};
      const model=theirs.terrain?.[e.genId];if(model){map.terrain??={};map.terrain[e.genId]={...structuredClone(model),bounds:rect(model.bounds),cells:model.cells.map(c=>({...c,...localPoint(c)}))};}
    }
  }
  // Keep junction positions consistent with the chosen entity revisions, including local edits.
  if(changed)map.revision=revision;
  map.link!.syncedMyRev=map.revision;map.link!.syncedTheirRev=theirs.revision;
  const updated=JSON.stringify(map)!==JSON.stringify(mine);
  return {map:updated?map:mine,conflicts,taken,updated};
}
function contentMapPlaces(map:MapDoc){return JSON.stringify(Object.values(map.entities).filter(e=>e.type==='place'));}
