import type { MultiPolygon } from 'polygon-clipping';
import clipping from '../../geom/polygonClipping';
import type { MapDoc } from '../../model/schema';
import { geographicEntities,isWorldSymbol,polygonArea } from '../../geom/geography';
import { rectRing,toPolygons,fromPolygons } from '../../geom/fog';
import { getEntityBounds } from '../../geom/hitTest';
import { bufferLine } from './city';

export function cityDiagnostics(map:MapDoc,areaId:string){
  const area=map.entities[areaId];if(area?.type!=='area')return null;
  const footprint=toPolygons([area.rings]),parts:MultiPolygon[]=[],water:MultiPolygon[]=[],blockerIds:string[]=[];
  for(const e of geographicEntities(map)){
    if(e.id===areaId||e.groupId&&e.groupId===area.groupId||isWorldSymbol(e))continue;
    let shape:MultiPolygon|undefined;
    if(e.type==='area'&&['water','building','floor'].includes(e.role))shape=toPolygons([e.rings]);
    else if(e.type==='path'&&['river','cliff','cityWall'].includes(e.role))shape=bufferLine(e.points,e.width/2,e.closed);
    else if(e.type==='wall')shape=bufferLine(e.points,.5);
    else if(e.type==='prop'){const b=getEntityBounds(e)!;shape=toPolygons([[rectRing({x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY})]]);}
    if(shape){const overlap=clipping.intersection(footprint,shape);if(overlap.length){parts.push(overlap);blockerIds.push(e.id);if(e.type==='area'&&e.role==='water')water.push(overlap);}}
  }
  const total=(p:MultiPolygon)=>fromPolygons(p).reduce((sum,r)=>sum+polygonArea(r),0);
  const blocked=parts.length?clipping.union(...parts as [MultiPolygon,...MultiPolygon[]]):[];
  return {footprintArea:polygonArea(area.rings),buildableArea:total(clipping.difference(footprint,blocked)),waterArea:water.length?total(clipping.union(...water as [MultiPolygon,...MultiPolygon[]])):0,blockerIds};
}
