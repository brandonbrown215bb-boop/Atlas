import { clipOutside } from '../geom/clipOutside';
import { z } from 'zod';
import clipping from '../geom/polygonClipping';
import { MapDocSchema, WorldMetaSchema, type Entity, type MapDoc, type Point } from './schema';
import type { WorldDocument } from './commands';
import { fromPolygons, toPolygons, rectRing } from '../geom/fog';
import { rotateEntityPatch, scaleEntityPatch, translateEntityPatch } from '../geom/transform';
import { reclimateMap } from '../gen/world/reclimate';

export const WorldDocumentSchema=z.object({meta:WorldMetaSchema,maps:z.record(z.string(),MapDocSchema)});
export const PlacementSchema=z.object({parentMapId:z.string().min(1),x:z.number().finite(),y:z.number().finite(),rotation:z.number().finite().default(0),scale:z.number().positive().finite().default(1),underneath:z.enum(['replace','merge']).default('replace'),seamMargin:z.number().nonnegative().finite().default(0),reClimate:z.boolean().optional()});
export type Placement=z.infer<typeof PlacementSchema>;
export const TransferInputSchema=z.object({mapId:z.string().min(1),mode:z.enum(['copy','move','linked']).default('copy'),placement:PlacementSchema.optional()});
export type TransferInput=z.infer<typeof TransferInputSchema>;

export function validateWorld(input: WorldDocument): WorldDocument {
  const w=WorldDocumentSchema.parse(input);
  if(new Set(w.meta.maps.map(m=>m.id)).size!==w.meta.maps.length) throw new Error('Duplicate map ids');
  for(const summary of w.meta.maps) {
    const m=w.maps[summary.id];
    if(!m || m.id!==summary.id || m.parent?.mapId!==summary.parentId) throw new Error(`Invalid map summary: ${summary.id}`);
  }
  for(const [id,m] of Object.entries(w.maps)) {
    if(id!==m.id || !w.meta.maps.some(s=>s.id===id)) throw new Error(`Unlisted map: ${id}`);
    if(m.parent && (!w.maps[m.parent.mapId] || (m.parent.footprintEntityId && !w.maps[m.parent.mapId]!.entities[m.parent.footprintEntityId]))) throw new Error(`Missing parent/footprint: ${id}`);
    const ancestors=new Set([id]); let parent=m.parent;
    while(parent) {if(ancestors.has(parent.mapId)) throw new Error('Cyclic map parents');ancestors.add(parent.mapId);parent=w.maps[parent.mapId]?.parent;}
    for(const [eid,e] of Object.entries(m.entities)) {
      if(eid!==e.id || !m.layers.some(l=>l.id===e.layerId)) throw new Error(`Missing entity layer: ${eid}`);
      if(e.type==='place' && (e.entityIds.some(id=>!m.entities[id]) || (e.childMapId && !w.maps[e.childMapId]))) throw new Error(`Dangling place: ${eid}`);
      if(e.type==='portal' && (!w.maps[e.targetMapId] || (e.targetPortalId && w.maps[e.targetMapId]!.entities[e.targetPortalId]?.type!=='portal'))) throw new Error(`Dangling portal: ${eid}`);
    }
  }
  return w;
}
export function mapTree(world: WorldDocument, rootId: string): string[] {
  if(!world.maps[rootId]) throw new Error('Source map not found');
  const ids=[rootId];
  for(let i=0;i<ids.length;i++) for(const m of Object.values(world.maps)) if(m.parent?.mapId===ids[i] && !ids.includes(m.id)) ids.push(m.id);
  return ids;
}
export function forkWorld(source: WorldDocument,name: string,id: string=crypto.randomUUID()): WorldDocument {
  const w=validateWorld(source); w.meta.forkedFrom={worldId:w.meta.id,worldName:w.meta.name};w.meta.id=id;w.meta.name=name.trim()||`${w.meta.name} Fork`;return w;
}
export function usedAssets(world: WorldDocument, ids: string[]): string[] {
  const result=new Set<string>();
  for(const id of ids) for(const e of Object.values(world.maps[id]!.entities)) {
    if((e.type==='image'||e.type==='prop') && e.assetId) result.add(e.assetId);
    if((e.type==='area'||e.type==='path'||e.type==='wall') && e.texture) result.add(e.texture.assetId);
  }
  return [...result];
}
const movePoint=(p:Point,scale:number,angle:number):Point=>({x:(p.x*Math.cos(angle)-p.y*Math.sin(angle))*scale,y:(p.x*Math.sin(angle)+p.y*Math.cos(angle))*scale});

/** Bake placement into local geometry so existing map views and continuous zoom need no rotated-camera mode. */
function placeTree(maps: Record<string,MapDoc>, ids:string[], placement: Placement) {
  const originals=structuredClone(maps);
  const transforms=new Map<string,{scale:number;angle:number;offset:Point}>();
  for(const id of ids) {
    const m=maps[id]!, original=originals[id]!;
    const interior=m.kind==='interior' || (m.parent && transforms.get(m.parent.mapId)?.scale===1 && transforms.get(m.parent.mapId)?.angle===0 && originals[m.parent.mapId]?.kind==='interior');
    const scale=interior?1:placement.scale, angle=interior?0:placement.rotation;
    const corners=rectRing(original.bounds).map(p=>movePoint(p,scale,angle));
    const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
    const offset={x:-minX,y:-minY};
    transforms.set(id,{scale,angle,offset});
    for(const e of Object.values(m.entities)) {
      Object.assign(e,scaleEntityPatch(e,{x:0,y:0},scale,scale));
      Object.assign(e,rotateEntityPatch(e,{x:0,y:0},angle));
      Object.assign(e,translateEntityPatch(e,offset.x,offset.y));
      if((e.type==='area'||e.type==='path'||e.type==='wall') && e.texture) e.texture.metersPerPixel*=scale;
    }
    const localPoint=(p:Point)=>{const q=movePoint(p,scale,angle);return{x:q.x+offset.x,y:q.y+offset.y};};
    for(const r of Object.values(m.generators))if(r.boundary)r.boundary=r.boundary.map(ring=>ring.map(localPoint));
    for(const g of Object.values(m.groups??{}))if(g.boundary)g.boundary=g.boundary.map(ring=>ring.map(localPoint));
    for(const [key,p]of Object.entries(m.riverNodes??{}))m.riverNodes![key]=localPoint(p);
    for(const model of Object.values(m.terrain??{})){model.cells=model.cells.map(c=>({...c,...localPoint(c)}));const bounds=rectRing(model.bounds).map(localPoint),x=Math.min(...bounds.map(p=>p.x)),y=Math.min(...bounds.map(p=>p.y));model.bounds={x,y,w:Math.max(...bounds.map(p=>p.x))-x,h:Math.max(...bounds.map(p=>p.y))-y};}
    m.fog.revealed=m.fog.revealed.map(poly=>poly.map(r=>r.map(p=>{const q=movePoint(p,scale,angle);return {x:q.x+offset.x,y:q.y+offset.y};})));
    m.bounds={x:0,y:0,w:Math.max(...corners.map(p=>p.x))-minX,h:Math.max(...corners.map(p=>p.y))-minY};
    m.grid.size*=scale;
    if(m.parent && transforms.has(m.parent.mapId)) {
      const t=transforms.get(m.parent.mapId)!;
      const anchor=movePoint(original.parent!,t.scale,t.angle);
      m.parent.x=anchor.x+t.offset.x-offset.x;
      m.parent.y=anchor.y+t.offset.y-offset.y;
      m.parent.rotation=0;
    }
  }
  const root=maps[ids[0]!]!;
  root.parent={mapId:placement.parentMapId,x:placement.x,y:placement.y,rotation:0};
  const original=originals[ids[0]!]!, t=transforms.get(root.id)!;
  return {transforms,footprint:rectRing(original.bounds).map(p=>{const q=movePoint(p,t.scale,t.angle);return {x:q.x+t.offset.x+placement.x,y:q.y+t.offset.y+placement.y};})};
}

function applyGeography(parent: MapDoc, incoming: MapDoc, footprint:Point[], placement:Placement,createId:()=>string,protectedIds:Set<string>) {
  parent.revision++;
  const revision=parent.revision;
  const land=Object.values(incoming.entities).filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='land'&&!e.gmOnly&&incoming.layers.some(l=>l.id===e.layerId&&!l.gmOnly&&l.visible));
  const incomingLand=land.flatMap(e=>toPolygons([e.rings.map(r=>r.map(p=>({x:p.x+placement.x,y:p.y+placement.y})))]));
  const layerId=parent.layers[0]?.id;
  if(!layerId) throw new Error('Target parent needs a layer');
  const replaceArea=(e:Extract<Entity,{type:'area'}>,polys:Point[][][])=>{
    if(!polys.length){delete parent.entities[e.id];parent.deleted[e.id]=revision;return;}
    e.rings=polys[0]!; e.rev=revision;e.origin='manual';
    for(const rings of polys.slice(1)){const id=createId();parent.entities[id]={...structuredClone(e),id,rings};}
  };
  if(placement.underneath==='replace') {
    for(const e of Object.values(parent.entities)) {
      if(protectedIds.has(e.id))continue;
      if(e.type==='area') replaceArea(e,fromPolygons(clipping.difference(toPolygons([e.rings]),toPolygons([[footprint]]))));
      else if(e.type==='path'||e.type==='wall'||e.type==='door') {
        const points=e.type==='door'?[e.a,e.b]:e.points;
        const pieces=clipOutside(points,e.type==='path'&&e.closed,footprint);
        const original=e.type==='path'&&e.closed?[...points,points[0]!]:points;
        if(pieces.length===1&&JSON.stringify(pieces[0])===JSON.stringify(original))continue;
        if(!pieces.length){delete parent.entities[e.id];parent.deleted[e.id]=revision;continue;}
        const apply=(entity:typeof e,points:Point[])=>{
          if(entity.type==='door'){entity.a=points[0]!;entity.b=points[points.length-1]!;}
          else {entity.points=points;if(entity.type==='path')entity.closed=false;}
          entity.rev=revision;entity.origin='manual';
        };
        for(const piece of pieces.slice(1)){const id=createId(),copy=structuredClone(e);copy.id=id;apply(copy,piece);parent.entities[id]=copy;}
        apply(e,pieces[0]!);
      }
    }
  } else if(incomingLand.length) {
    const existing=Object.values(parent.entities).filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='land'&&!e.gmOnly&&parent.layers.some(l=>l.id===e.layerId&&!l.gmOnly&&l.visible));
    const merged=fromPolygons(clipping.union(incomingLand,...existing.map(e=>toPolygons([e.rings]))));
    // Smooth only seam vertices close to the incoming boundary, then re-union to validate rings.
    const near=(p:Point)=>footprint.some((a,i)=>{const b=footprint[(i+1)%footprint.length]!,dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=placement.seamMargin;});
    const smoothed=placement.seamMargin?merged.map(poly=>poly.map(r=>r.map((p,i)=>near(p)?{x:(r[(i+r.length-1)%r.length]!.x+2*p.x+r[(i+1)%r.length]!.x)/4,y:(r[(i+r.length-1)%r.length]!.y+2*p.y+r[(i+1)%r.length]!.y)/4}:p))):merged;
    for(const e of existing){delete parent.entities[e.id];parent.deleted[e.id]=revision;}
    for(const rings of fromPolygons(clipping.union(toPolygons(smoothed)))) {const id=createId();parent.entities[id]={id,type:'area',role:'land',rings,layerId,origin:'manual',rev:revision};}
  }
  if(placement.underneath==='replace') for(const e of land){const id=createId();parent.entities[id]={...structuredClone(e),id,layerId,rev:revision,origin:'manual',rings:e.rings.map(r=>r.map(p=>({x:p.x+placement.x,y:p.y+placement.y})))};}
  for(const e of Object.values(parent.entities)) if(e.type==='place') e.entityIds=e.entityIds.filter(id=>parent.entities[id]);
}

export function transferMap(sourceInput:WorldDocument,targetInput:WorldDocument,raw:TransferInput,createId:()=>string=()=>crypto.randomUUID()) {
  const input=TransferInputSchema.parse(raw),source=validateWorld(sourceInput),target=validateWorld(targetInput);
  if(source.meta.id===target.meta.id) throw new Error('Choose a different world');
  const ids=mapTree(source,input.mapId),linked=input.mode==='linked';
  const mapIds=new Map(ids.map(id=>[id,linked?id:createId()]));
  if([...mapIds.values()].some(id=>target.maps[id])) throw new Error('Map ids already exist in the target');
  const entityIds=new Map(ids.map(id=>[id,new Map(Object.keys(source.maps[id]!.entities).map(eid=>[eid,linked?eid:createId()]))]));
  const incoming:Record<string,MapDoc>={};
  for(const id of ids) {
    const m=structuredClone(source.maps[id]!);m.id=mapIds.get(id)!;delete m.link;
    const layers=new Map(m.layers.map(l=>[l.id,linked?l.id:createId()]));
    m.layers=m.layers.map(l=>({...l,id:layers.get(l.id)!}));
    const gens=new Map(Object.keys(m.generators).map(g=>[g,linked?g:createId()]));
    const groups=new Map(Object.keys(m.groups??{}).map(g=>[g,linked?g:createId()]));
    const riverNodes=new Map(Object.keys(m.riverNodes??{}).map(g=>[g,linked?g:createId()]));
    m.groups=Object.fromEntries(Object.entries(m.groups??{}).map(([g,value])=>[groups.get(g)!,{...value,genId:value.genId?gens.get(value.genId):undefined}]));
    m.riverNodes=Object.fromEntries(Object.entries(m.riverNodes??{}).map(([g,value])=>[riverNodes.get(g)!,value]));
    m.terrain=Object.fromEntries(Object.entries(m.terrain??{}).map(([g,value])=>[gens.get(g)??g,value]));
    m.generators=Object.fromEntries(Object.entries(m.generators).map(([g,value])=>[gens.get(g)!,{...value,groupId:value.groupId?groups.get(value.groupId):undefined,regionEntityId:entityIds.get(id)!.get(value.regionEntityId)??value.regionEntityId,layerId:value.layerId?layers.get(value.layerId):undefined}]));
    const oldParent=m.parent?.mapId;
    if(m.parent && mapIds.has(m.parent.mapId)) m.parent={...m.parent,mapId:mapIds.get(m.parent.mapId)!,footprintEntityId:m.parent.footprintEntityId?entityIds.get(m.parent.mapId)!.get(m.parent.footprintEntityId):undefined};
    else delete m.parent;
    m.entities=Object.fromEntries(Object.values(m.entities).flatMap(e=>{
      e.id=entityIds.get(id)!.get(e.id)!;e.layerId=layers.get(e.layerId)!;
      if(e.genId)e.genId=gens.get(e.genId);
      if(e.groupId)e.groupId=groups.get(e.groupId);
      if(e.type==='path'){if(e.startNodeId)e.startNodeId=riverNodes.get(e.startNodeId);if(e.endNodeId)e.endNodeId=riverNodes.get(e.endNodeId);}
      if(e.inheritedFrom) {
        const inherited=oldParent?entityIds.get(oldParent)?.get(e.inheritedFrom.entityId):undefined;
        if(inherited)e.inheritedFrom.entityId=inherited;else {delete e.inheritedFrom;if(e.origin==='inherited')e.origin='manual';}
      }
      if(e.type==='place'){e.entityIds=e.entityIds.flatMap(eid=>entityIds.get(id)!.get(eid)??[]);e.childMapId=e.childMapId?mapIds.get(e.childMapId):undefined;}
      if(e.type==='portal') {
        const oldTarget=e.targetMapId,targetId=mapIds.get(oldTarget);
        if(!targetId)return [];
        e.targetMapId=targetId;e.targetPortalId=e.targetPortalId?entityIds.get(oldTarget)?.get(e.targetPortalId):undefined;
      }
      return [[e.id,e]];
    }));
    m.deleted=linked?m.deleted:{};
    incoming[m.id]=m;
  }
  const incomingIds=ids.map(id=>mapIds.get(id)!);
  let placedTransforms: Map<string,{scale:number;angle:number;offset:Point}> | undefined;
  if(input.placement) {
    const parent=target.maps[input.placement.parentMapId];if(!parent)throw new Error('Target parent map not found');
    const placed=placeTree(incoming,incomingIds,input.placement);
    const footprint=placed.footprint;placedTransforms=placed.transforms;
    const root=incoming[incomingIds[0]!]!;
    const protectedIds=new Set(Object.values(target.maps).flatMap(m=>m.parent?.mapId===parent.id&&m.parent.footprintEntityId?[m.parent.footprintEntityId]:[]));
    applyGeography(parent,root,footprint,input.placement,createId,protectedIds);
    const eid=createId();parent.entities[eid]={id:eid,type:'area',role:'district',rings:[footprint],layerId:parent.layers[0]!.id,origin:'manual',rev:parent.revision,name:root.name};
    root.parent!.footprintEntityId=eid;
  }
  Object.assign(target.maps,incoming);
  target.meta.maps.push(...incomingIds.map(id=>{const m=incoming[id]!;return {id,name:m.name,kind:m.kind,parentId:m.parent?.mapId};}));
  if(input.placement?.reClimate) for(const id of incomingIds) reclimateMap(target,target.maps[id]!,createId);
  if(linked) for(const id of ids) {
    const mine=source.maps[id]!,theirs=target.maps[mapIds.get(id)!]!;
    if(mine.link) throw new Error('This map already has a linked copy. Fork or copy it independently first.');
    mine.link={worldId:target.meta.id,mapId:theirs.id,syncedTheirRev:theirs.revision,syncedMyRev:mine.revision};
    theirs.link={worldId:source.meta.id,mapId:mine.id,syncedTheirRev:mine.revision,syncedMyRev:theirs.revision};
    const t=placedTransforms?.get(theirs.id);
    if(t) {
      theirs.link.transform={x:t.offset.x,y:t.offset.y,scale:t.scale,rotation:t.angle};
      const inverse=movePoint({x:-t.offset.x,y:-t.offset.y},1/t.scale,-t.angle);
      mine.link.transform={...inverse,scale:1/t.scale,rotation:-t.angle};
    }
  }
  if(input.mode==='move') {
    for(const id of ids) delete source.maps[id];
    source.meta.maps=source.meta.maps.filter(s=>!ids.includes(s.id));
    for(const m of Object.values(source.maps)) {
      for(const e of Object.values(m.entities)) {
        if(e.type==='portal'&&ids.includes(e.targetMapId)){delete m.entities[e.id];m.deleted[e.id]=++m.revision;}
        if(e.type==='place'&&e.childMapId&&ids.includes(e.childMapId)){delete e.childMapId;e.rev=++m.revision;}
      }
      const footprint=sourceInput.maps[input.mapId]?.parent;
      if(footprint?.mapId===m.id && footprint.footprintEntityId){delete m.entities[footprint.footprintEntityId];m.deleted[footprint.footprintEntityId]=++m.revision;}
      for(const e of Object.values(m.entities)) if(e.type==='place')e.entityIds=e.entityIds.filter(id=>m.entities[id]);
    }
  }
  return {source:validateWorld(source),target:validateWorld(target),mapId:incomingIds[0]!,assetIds:usedAssets(sourceInput,ids)};
}
