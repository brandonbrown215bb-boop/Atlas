import { MapDocSchema, type Entity, type MapDoc } from './schema';
import { rotateEntityPatch, scaleEntityPatch, translateEntityPatch } from '../geom/transform';

export type SyncChoices=Record<string,'mine'|'theirs'>;
export interface SyncConflict {id:string;name:string;mine:Entity|null;theirs:Entity|null;reason:'both changed'|'changed versus deleted'}
export function convertLinkedEntity(entity:Entity, transform:NonNullable<MapDoc['link']>['transform']):Entity {
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
    const remote=other?convertLinkedEntity(other,link.transform):undefined;
    const myRev=local?.rev??mine.deleted[id]??0, theirRev=other?.rev??theirs.deleted[id]??0;
    const myChanged=myRev>link.syncedMyRev,theirChanged=theirRev>link.syncedTheirRev;
    if(!theirChanged)continue;
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
  if(changed)map.revision=revision;
  map.link!.syncedMyRev=map.revision;map.link!.syncedTheirRev=theirs.revision;
  const updated=JSON.stringify(map)!==JSON.stringify(mine);
  return {map:updated?map:mine,conflicts,taken,updated};
}
function contentMapPlaces(map:MapDoc){return JSON.stringify(Object.values(map.entities).filter(e=>e.type==='place'));}
