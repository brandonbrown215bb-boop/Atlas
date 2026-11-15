import { expect, it } from 'vitest';
import type { MultiPolygon } from 'polygon-clipping';
import clipping from './polygonClipping';
import { geographicEntities, polygonArea, resolveGeography } from './geography';
import { fromPolygons } from './fog';
import { pointInPolygon } from './hitTest';
import { MapDocSchema } from '../model/schema';
import coast from './fixtures/trace-coast.json';
import ringUnion from './fixtures/ring-union.json';

// Nine vertices reduced from the saved trace that overflowed RingOut.isExteriorRing.
const ocean = coast.ocean as MultiPolygon;
const land = coast.land as MultiPolygon;
// Unlike library output, these source rings have no repeated closing vertex.
const points = (shape: MultiPolygon) => shape.map(poly => poly.map(ring => ring.map(([x,y]) => ({x,y}))));

it('resolves the saved trace overflow without changing the source or losing land/water', () => {
  const source = structuredClone({ocean,land});
  const result = fromPolygons(clipping.difference(ocean,land));
  expect(result.reduce((sum,poly)=>sum+polygonArea(poly),0)).toBeCloseTo(13579452.553,1);
  const wet = points(ocean), dry = points(land);
  for(let y=90013;y<101000;y+=347)for(let x=148017;x<176000;x+=391){
    const p={x,y};
    expect(result.some(poly=>pointInPolygon(p,poly))).toBe(wet.some(poly=>pointInPolygon(p,poly))&&!dry.some(poly=>pointInPolygon(p,poly)));
  }
  expect({ocean,land}).toEqual(source);

  const base={type:'area',layerId:'base',origin:'manual',rev:1};
  const map=MapDocSchema.parse({id:'map',name:'Trace regression',kind:'world',revision:1,
    bounds:{x:148000,y:90000,w:28000,h:11000},grid:{size:100,visible:true},
    layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],
    entities:{land:{...base,id:'land',role:'land',rings:dry[0]},ocean:{...base,id:'ocean',role:'water',waterKind:'ocean',rings:wet[0]}},
    generators:{},deleted:{},fog:{enabled:false,revealed:[]}});
  const before=structuredClone(map);
  const geography=resolveGeography(map);
  expect(geography.ocean.reduce((sum,poly)=>sum+polygonArea(poly),0)).toBeCloseTo(13579452.553,1);
  expect(geographicEntities(map).some(e=>e.type==='area'&&e.role==='water')).toBe(true);
  expect(map).toEqual(before);
});

it('keeps successful polygon operations exact and still rejects invalid input', () => {
  const precise:MultiPolygon=[[[[.123456789123,.123456789123],[1,.123456789123],[1,1],[.123456789123,1]]]];
  expect(clipping.difference(precise,[])[0]![0]![0]).toEqual(precise[0]![0]![0]);
  expect(()=>clipping.difference([[[[NaN,0],[1,0],[1,1]]]],[])).toThrow();
});

it('unions the saved near-coincident triangles without losing land, changing inputs, or leaving rings open',()=>{
  const shapes=ringUnion.shapes as MultiPolygon[],before=structuredClone(shapes);
  const result=clipping.union(shapes[0]!,shapes[1]!);
  const polygons=fromPolygons(result);
  expect(polygons.reduce((sum,poly)=>sum+polygonArea(poly),0)).toBeCloseTo(29507363.737,1);
  for(const poly of result)for(const ring of poly){
    expect(ring[0]).toEqual(ring[ring.length-1]);
    expect(ring.flat().every(Number.isFinite)).toBe(true);
  }
  for(let y=47023;y<68000;y+=293)for(let x=373017;x<383000;x+=157){
    const p={x,y};
    expect(polygons.some(poly=>pointInPolygon(p,poly))).toBe(shapes.some(s=>points(s).some(poly=>pointInPolygon(p,poly))));
  }
  // The same precision recovery also accepts Polygon operands, as editing tools do.
  expect(clipping.union(shapes[0]![0]!,shapes[1]![0]!)).toEqual(result);
  expect(shapes).toEqual(before);
  const map=MapDocSchema.parse({id:'map',name:'Ring union',kind:'world',revision:1,
    bounds:{x:370000,y:45000,w:15000,h:25000},grid:{size:100,visible:true},
    layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],
    entities:Object.fromEntries(shapes.map((shape,i)=>[String(i),{id:String(i),type:'area',role:'land',layerId:'base',origin:'manual',rev:1,rings:points(shape)[0]}])),
    generators:{},deleted:{},fog:{enabled:false,revealed:[]}});
  const source=structuredClone(map),resolved=resolveGeography(map);
  expect(resolved.land.reduce((sum,poly)=>sum+polygonArea(poly),0)).toBeCloseTo(29507363.737,1);
  expect(geographicEntities(map).length).toBeGreaterThan(2);expect(map).toEqual(source);
});
