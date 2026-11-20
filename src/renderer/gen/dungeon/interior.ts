import { distanceToSegment, getEntityBounds, pointInPolygon } from '../../geom/hitTest';
import { MapDocSchema, type AssetsIndex, type Entity, type MapDoc, type Point, type Theme } from '../../model/schema';
import { runGenerator } from '../framework';
import { DungeonParamsSchema } from './layout';

/** A disposable preview. Accept calls this same pure function inside one world command. */
export function previewInterior(parent: MapDoc, options: {
  buildingId: string; childMapId: string; name: string; seed: number;
  params: Record<string,unknown>; theme: Theme; assets?: AssetsIndex; themeName?: string;
}): MapDoc {
  if(parent.kind!=='settlement') throw new Error('Choose a building on a settlement map.');
  const building=parent.entities[options.buildingId];
  if(building?.type!=='area'||building.role!=='building') throw new Error('Choose a building footprint.');
  const bounds=getEntityBounds(building)!;
  const local=(p:Point)=>({x:p.x-bounds.minX,y:p.y-bounds.minY});
  const footprint:Entity={...building,id:'interior-footprint',layerId:'layer-base',origin:'inherited',rev:0,
    rings:building.rings.map(r=>r.map(local)),inheritedFrom:{entityId:building.id,parentRev:building.rev}};
  delete footprint.genId;
  delete footprint.groupId;
  const entities:Record<string,Entity>={[footprint.id]:footprint};
  for(const e of Object.values(parent.entities)) if(e.type==='door') {
    const mid={x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2};
    const onBoundary=building.rings.some(r=>r.some((a,i)=>distanceToSegment(mid,a,r[(i+1)%r.length]!)<0.05));
    if(!onBoundary&&!pointInPolygon(mid,building.rings)) continue;
    const id=`inherited-door:${e.id}`;
    entities[id]={...e,id,genId:undefined,groupId:undefined,layerId:'layer-base',origin:'inherited',rev:0,a:local(e.a),b:local(e.b),inheritedFrom:{entityId:e.id,parentRev:e.rev}};
  }
  const map=MapDocSchema.parse({id:options.childMapId,name:options.name,kind:'interior',
    parent:{mapId:parent.id,x:bounds.minX,y:bounds.minY,rotation:0,footprintEntityId:building.id},
    bounds:{x:0,y:0,w:bounds.maxX-bounds.minX,h:bounds.maxY-bounds.minY},grid:{size:1.524,visible:true},
    layers:[{id:'layer-base',name:'Interior',visible:true,locked:false,gmOnly:false}],
    entities,generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]}});
  const linkedPlace = Object.values(parent.entities).find(e => e.type === 'place' && e.entityIds.includes(building.id));
  const identityText = `${building.name ?? ''} ${linkedPlace?.type === 'place' ? `${linkedPlace.name} ${linkedPlace.category}` : ''}`;
  const inferredPurpose =
    /temple|shrine|abbey|chapel|sanctuary|cathedral/i.test(identityText) ? 'shrine' :
    /keep|watch|tower|barracks|guard|fort|castle/i.test(identityText) ? 'guardroom' :
    /tavern|inn|pub|alehouse/i.test(identityText) ? 'tavern' :
    /store|shop|market|smithy|bakery|apothecary|carpenter|tailor|warehouse|barn|dairy|mill/i.test(identityText) ? 'storage' :
    /cottage|house|manor|villa|hut|residence|croft/i.test(identityText) ? 'bedroom' :
    undefined;
  const parsedParams = DungeonParamsSchema.parse(options.params);
  const effectiveParams = parsedParams.purpose === 'random' && inferredPurpose
    ? { ...parsedParams, purpose: inferredPurpose }
    : parsedParams;
  runGenerator(map,{genId:'interior-generator',type:'dungeon',seed:options.seed,params:effectiveParams,
    regionEntityId:footprint.id,layerId:'layer-base',theme:options.theme,assets:options.assets,themeName:options.themeName});
  return MapDocSchema.parse(map);
}
