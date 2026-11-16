import type { MultiPolygon } from 'polygon-clipping';
import clipping from '../../geom/polygonClipping';
import type { MapDoc } from '../../model/schema';
import { geographicEntities,isWorldSymbol,polygonArea } from '../../geom/geography';
import { rectRing,toPolygons,fromPolygons } from '../../geom/fog';
import { getEntityBounds } from '../../geom/hitTest';
import { bufferLine } from './city';

export interface SettlementServiceStatus {
  key: 'tavern' | 'smithy' | 'market' | 'temple' | 'watch';
  label: string;
  present: boolean;
  count: number;
}

export interface SettlementAuditResult {
  services: SettlementServiceStatus[];
  presentCount: number;
  complete: boolean;
  missing: string[];
}

const SERVICE_RULES: Array<{ key: SettlementServiceStatus['key']; label: string; pattern: RegExp }> = [
  { key: 'tavern', label: 'Tavern / Inn', pattern: /tavern|inn|alehouse|taproom|lodge/i },
  { key: 'smithy', label: 'Smithy / Gear', pattern: /smith|armour|armor|forge|weapon|outfitter|carpenter/i },
  { key: 'market', label: 'Market / Supplies', pattern: /market|store|bakery|grocer|bazaar|guild|merchant|shop/i },
  { key: 'temple', label: 'Temple / Healer', pattern: /temple|shrine|chapel|abbey|church|healer|apothecary|infirmary/i },
  { key: 'watch', label: 'Watch / Keep', pattern: /watch|guard|keep|barracks|citadel|fort|gatehouse/i },
];

/** Audit a settlement map against the 5 essential OSE town services (tavern, smithy, market, temple, watch). */
export function settlementServiceAudit(map: MapDoc): SettlementAuditResult {
  const names: string[] = [];
  for (const e of Object.values(map.entities)) {
    if (e.name) names.push(e.name);
    if (e.type === 'place') {
      if (e.category) names.push(e.category);
      if (e.notes) names.push(e.notes);
    } else if (e.type === 'label') {
      names.push(e.text);
    }
  }
  const services: SettlementServiceStatus[] = SERVICE_RULES.map((rule) => {
    const count = names.filter((n) => rule.pattern.test(n)).length;
    return { key: rule.key, label: rule.label, present: count > 0, count };
  });
  const missing = services.filter((s) => !s.present).map((s) => s.label);
  const presentCount = services.length - missing.length;
  return {
    services,
    presentCount,
    complete: missing.length === 0,
    missing,
  };
}

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
