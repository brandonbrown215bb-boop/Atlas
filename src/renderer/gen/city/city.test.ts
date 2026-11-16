import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { rectRing, toPolygons } from '../../geom/fog';
import { distanceToSegment, pointInPolygon } from '../../geom/hitTest';
import { EntitySchema, MapDocSchema, type Entity } from '../../model/schema';
import { createWorldStore } from '../../model/store';
import { bufferLine, CityParamsSchema, generateCity, ringArea } from './city';

const base={origin:'manual' as const,rev:0,layerId:'l'};
const district=(id:string,x:number,w:number):Entity=>({...base,id,type:'area',role:'district',rings:[rectRing({x,y:0,w,h:240})]});
const source=()=>({seed:9,params:CityParamsSchema.parse({}),region:[rectRing({x:0,y:0,w:320,h:240})],grid:10,theme:{},constraints:[] as Entity[]});

it('generates deterministic rectangular street-facing buildings and reachable blocks',()=>{
  const input=source(), result=generateCity(input);
  expect(result).toEqual(generateCity(input));
  expect(result.every(e=>EntitySchema.safeParse(e).success)).toBe(true);
  const buildings=result.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='building');
  expect(buildings.length).toBeGreaterThan(20);
  const roads=result.filter((e):e is Extract<Entity,{type:'path'}>=>e.type==='path');
  const roadMask=clipping.union(...roads.map(r=>bufferLine(r.points,r.width/2)) as [ReturnType<typeof bufferLine>,...ReturnType<typeof bufferLine>[]]);
  for (const [i,b] of buildings.entries()) {
    expect(b.rings[0]).toHaveLength(4);
    expect(ringArea(b.rings[0]!)).toBeGreaterThan(25);
    expect(clipping.difference(toPolygons([b.rings]),toPolygons([input.region]))).toEqual([]);
    expect(clipping.intersection(toPolygons([b.rings]),roadMask)).toEqual([]);
    for (const other of buildings.slice(i+1)) expect(clipping.intersection(toPolygons([b.rings]),toPolygons([other.rings]))).toEqual([]);
  }
  for(const block of result) if(block.type==='area'&&block.role==='district') {
    expect(block.rings[0]!.some((p,i)=>{const q=block.rings[0]![(i+1)%block.rings[0]!.length]!;const mid={x:(p.x+q.x)/2,y:(p.y+q.y)/2};
      return roads.some(r=>r.points.slice(1).some((b,j)=>distanceToSegment(mid,r.points[j]!,b)<=r.width/2+.6));})).toBe(true);
  }
});

it('preserves constraints, holes, water, walls, existing buildings and plateau edges',()=>{
  const input=source();
  input.region.push(rectRing({x:50,y:50,w:25,h:25}));
  input.constraints=[
    {...base,id:'water',type:'area',role:'water',rings:[rectRing({x:250,y:0,w:70,h:240})]},
    {...base,id:'inn',type:'area',role:'building',rings:[rectRing({x:80,y:90,w:25,h:30})]},
    {...base,id:'wall',type:'path',role:'cityWall',points:[{x:180,y:0},{x:180,y:240}],width:3,closed:false},
    {...base,id:'gate',type:'door',a:{x:180,y:115},b:{x:180,y:125},kind:'door',open:false},
    {...base,id:'road',type:'path',role:'road',points:[{x:0,y:120},{x:250,y:120}],width:7,closed:false},
    {...base,id:'plateau',type:'area',role:'plateau',elevation:20,rings:[rectRing({x:0,y:0,w:100,h:90})]},
  ];
  const before=structuredClone(input.constraints),result=generateCity(input);
  expect(input.constraints).toEqual(before);
  const buildings=result.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='building');
  expect(buildings.length).toBeGreaterThan(5);
  for(const building of buildings) {
    const shape=toPolygons([building.rings]);
    expect(clipping.difference(shape,toPolygons([input.region]))).toEqual([]);
    for(const obstacle of input.constraints) {
      if(obstacle.type==='area'&&['water','building'].includes(obstacle.role)) expect(clipping.intersection(shape,toPolygons([obstacle.rings]))).toEqual([]);
      if(obstacle.type==='path') expect(clipping.intersection(shape,bufferLine(obstacle.points,obstacle.width/2))).toEqual([]);
    }
    if(pointInPolygon(building.rings[0]![0]!,[rectRing({x:0,y:0,w:100,h:90})])) expect(building.elevation).toBe(20);
  }
});

it('uses independent district settings and garden/outskirts choices without stranding buildings inside garden blocks',()=>{
  const input=source();
  const garden=district('gardens',0,150);
  if(garden.type==='area') garden.district={density:0,wealth:.9,activity:.2,access:'gated'};
  input.constraints=[garden];
  const result=generateCity(input);
  expect(result.some(e=>e.type==='area'&&e.role==='district'&&e.name==='Garden courtyard')).toBe(true);
  expect(result.some(e=>e.type==='area'&&e.role==='building')).toBe(true);
  for(const e of result) if(e.type==='area'&&e.role==='building'&&garden.type==='area') expect(clipping.intersection(toPolygons([e.rings]),toPolygons([garden.rings]))).toEqual([]);
  // A dedicated district footprint honors its profile through the command framework.
  const store=createWorldStore(),s=()=>store.getState();
  const map=MapDocSchema.parse({id:'m',name:'City',kind:'settlement',bounds:{x:0,y:0,w:640,h:240},grid:{size:10,visible:false},
    layers:[{id:'l',name:'Base',visible:true,locked:false,gmOnly:false}],entities:{left:district('left',0,320),right:district('right',320,320)},generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]}});
  s().loadWorld({id:'w',name:'World',formatVersion:1,maps:[{id:'m',name:'City',kind:'settlement'}],themes:{}},{m:map});
  for(const id of ['left','right']) s().execute('generator.run',{mapId:'m',type:'city',genId:id,seed:9,regionEntityId:id,layerId:'l'});
  const before=s().world, building=Object.values(before!.maps.m!.entities).find(e=>e.genId==='left'&&e.type==='area'&&e.role==='building')!;
  s().execute('place.create',{mapId:'m',id:'shop',name:'Permanent shop',entityIds:[building.id],notes:'Keep this'});
  const named=s().world;
  s().execute('generator.reroll',{mapId:'m',genId:'left',seed:10});
  expect(s().world!.maps.m!.entities[building.id]).toEqual(named!.maps.m!.entities[building.id]);
  for(const e of Object.values(before!.maps.m!.entities).filter(e=>e.genId==='right')) expect(s().world!.maps.m!.entities[e.id]).toEqual(e);
  expect(s().world!.maps.m!.entities.shop).toMatchObject({entityIds:[building.id],notes:'Keep this'});
  s().undo();expect(s().world).toEqual(named);s().redo();
  expect(MapDocSchema.parse(JSON.parse(JSON.stringify(s().world!.maps.m!)))).toEqual(s().world!.maps.m);
});

it('connects a standalone street through an ordinary gate in a thick wall, but keeps secret passages out of public access',()=>{
  const input=source();
  input.constraints=[
    {...base,id:'wall',type:'path',role:'cityWall',points:[{x:160,y:0},{x:160,y:240}],width:4,closed:false},
    {...base,id:'gate',type:'door',a:{x:160,y:112},b:{x:160,y:128},kind:'door',open:false},
  ];
  const crosses=(entities:Entity[])=>entities.some(e=>e.type==='path'&&Math.min(...e.points.map(p=>p.x))<158&&Math.max(...e.points.map(p=>p.x))>162);
  expect(crosses(generateCity(input))).toBe(true);
  const gate=input.constraints[1]!;if(gate.type==='door') gate.kind='secret';
  expect(crosses(generateCity(input))).toBe(false);
});

it('subdivides blocks along oriented bounding boxes aligned with angled arterial roads instead of only 0/90 axes',()=>{
  const input=source();
  input.constraints=[
    {...base,id:'diag-road',type:'path',role:'road',points:[{x:0,y:30},{x:320,y:210}],width:8,closed:false},
  ];
  const result=generateCity(input);
  const generatedStreets=result.filter((e):e is Extract<Entity,{type:'path'}>=>e.type==='path');
  expect(generatedStreets.length).toBeGreaterThan(3);
  const nonAxisAligned=generatedStreets.filter(s=>{
    const a=s.points[0]!,b=s.points[s.points.length-1]!;
    const dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y),len=Math.hypot(dx,dy);
    return len>10 && dx/len>0.15 && dy/len>0.15;
  });
  expect(nonAxisAligned.length).toBeGreaterThan(2);
});

it('concentrates extra-mural outskirts into ribbon development along gate arteries and leaves distant outer blocks as market gardens',()=>{
  const input=source();
  const wallRing=rectRing({x:90,y:40,w:140,h:160});
  input.constraints=[
    {...base,id:'city-wall',type:'path',role:'cityWall',points:wallRing,width:4,closed:true},
    {...base,id:'east-gate',type:'door',a:{x:230,y:112},b:{x:230,y:128},kind:'door',open:false},
  ];
  const result=generateCity(input);
  const buildings=result.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='building');
  const innerBuildings=buildings.filter(b=>pointInPolygon(b.rings[0]![0]!,[wallRing]));
  const outerBuildings=buildings.filter(b=>!pointInPolygon(b.rings[0]![0]!,[wallRing]));
  expect(innerBuildings.length).toBeGreaterThan(5);
  expect(outerBuildings.length).toBeGreaterThan(0);
  // Every extra-mural building must cluster along the east-gate arterial corridor rather than on un-gated sides of the wall.
  for(const b of outerBuildings) {
    const p=b.rings[0]![0]!;
    expect(p.x).toBeGreaterThan(220);
    expect(Math.abs(p.y-120)).toBeLessThan(65);
  }
  expect(result.some(e=>e.type==='area'&&e.role==='district'&&e.name==='Market gardens')).toBe(true);
});

it('supports hamlet scale without walls, explicit walled cities, and everyday building identities', () => {
  const hamletInput = source();
  hamletInput.params = CityParamsSchema.parse({ scale: 'hamlet' });
  const hamlet = generateCity(hamletInput);
  const hamletBuildings = hamlet.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role === 'building');
  expect(hamletBuildings.length).toBeGreaterThanOrEqual(4);
  expect(hamletBuildings.length).toBeLessThanOrEqual(8);
  expect(hamlet.some(e => e.type === 'path' && e.role === 'cityWall')).toBe(false);

  const walledInput = source();
  walledInput.params = CityParamsSchema.parse({ walls: 'walled' });
  const walled = generateCity(walledInput);
  expect(walled.some(e => e.type === 'path' && e.role === 'cityWall')).toBe(true);
  const townBuildings = walled.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role === 'building');
  expect(townBuildings.some(b => !/^Building \d+$/.test(b.name ?? ''))).toBe(true);
});
