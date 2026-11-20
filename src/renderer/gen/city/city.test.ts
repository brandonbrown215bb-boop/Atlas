import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { rectRing, toPolygons } from '../../geom/fog';
import { distanceToSegment, pointInPolygon } from '../../geom/hitTest';
import { EntitySchema, MapDocSchema, type Entity, type MapDoc } from '../../model/schema';
import { createWorldStore } from '../../model/store';
import { bufferLine, CityParamsSchema, generateCity, ringArea } from './city';
import { settlementServiceAudit } from './diagnostics';

const base={origin:'manual' as const,rev:0,layerId:'l'};
const district=(id:string,x:number,w:number):Entity=>({...base,id,type:'area',role:'district',rings:[rectRing({x,y:0,w,h:240})]});
const source=()=>({seed:9,params:CityParamsSchema.parse({}),region:[rectRing({x:0,y:0,w:320,h:240})],grid:10,theme:{},constraints:[] as Entity[]});

it('rerolling after the footprint was deleted does not bring the footprint back',()=>{
  const store=createWorldStore(),s=()=>store.getState();
  const map=MapDocSchema.parse({id:'m',name:'City',kind:'settlement',bounds:{x:0,y:0,w:320,h:240},grid:{size:10,visible:false},
    layers:[{id:'l',name:'Base',visible:true,locked:false,gmOnly:false}],entities:{left:district('left',0,320)},generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]}});
  s().loadWorld({id:'w',name:'World',formatVersion:1,maps:[{id:'m',name:'City',kind:'settlement'}],themes:{}},{m:map});
  s().execute('generator.run',{mapId:'m',type:'city',genId:'left',seed:9,regionEntityId:'left',layerId:'l'});
  s().execute('entity.delete',{mapId:'m',entityId:'left'});
  s().execute('generator.reroll',{mapId:'m',genId:'left',seed:10});
  expect(s().world!.maps.m!.entities.left).toBeUndefined();
  expect(Object.values(s().world!.maps.m!.entities).some(e=>e.genId==='left')).toBe(true);
});

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
  // Up to 12 cottages plus the inn, chapel and crypt.
  expect(hamletBuildings.length).toBeLessThanOrEqual(16);
  expect(hamlet.some(e => e.type === 'path' && e.role === 'cityWall')).toBe(false);

  const walledInput = source();
  walledInput.params = CityParamsSchema.parse({ walls: 'walled' });
  const walled = generateCity(walledInput);
  expect(walled.some(e => e.type === 'path' && e.role === 'cityWall')).toBe(true);
  const townBuildings = walled.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role === 'building');
  expect(townBuildings.some(b => !/^Building \d+$/.test(b.name ?? ''))).toBe(true);
});

const mile = (scale: string, constraints: Entity[] = []) => ({ seed: 9, params: CityParamsSchema.parse({ scale }), region: [rectRing({ x: 0, y: 0, w: 900, h: 900 })], grid: 10, theme: {}, constraints });
const areas = (entities: Entity[], role: string) => entities.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role === role);
const centre = (b: Extract<Entity, { type: 'area' }>) => ({ x: b.rings[0]!.reduce((s, p) => s + p.x, 0) / b.rings[0]!.length, y: b.rings[0]!.reduce((s, p) => s + p.y, 0) / b.rings[0]!.length });

it('sizes the built-up core by scale and leaves farmland around villages', () => {
  const [hamlet, village, town] = ['hamlet', 'village', 'town'].map(scale => generateCity(mile(scale)));
  const counts = [hamlet, village, town].map(r => areas(r!, 'building').length);
  expect(counts[0]).toBeLessThan(counts[1]!);
  expect(counts[1]).toBeLessThan(counts[2]!);
  // Village core is 110 m; houses straggle at most 150 m further along the lanes, farmsteads a little beyond.
  for (const b of areas(village!, 'building')) expect(Math.hypot(centre(b).x - 450, centre(b).y - 450)).toBeLessThan(110 * 1.3 + 150 + 120);
  expect(areas(village!, 'land').length).toBeGreaterThan(10);
  expect(village!.some(e => e.type === 'path' && e.role === 'cityWall')).toBe(false);
});

it('gives a town one square, wards, a graveyard crypt and distinct notables that each carry a hook', () => {
  const town = generateCity(mile('town'));
  const square = areas(town, 'district').filter(e => e.name === 'Market Square');
  expect(square.length).toBeGreaterThan(0);
  expect(town.filter(e => e.type === 'prop' && e.name === 'Market Cross')).toHaveLength(1);
  const buildings = areas(town, 'building');
  for (const b of buildings) for (const s of square) expect(clipping.intersection(toPolygons([b.rings]), toPolygons([s.rings]))).toEqual([]);
  const facing = buildings.filter(b => b.rings[0]!.some(p => square.some(s => s.rings[0]!.some((q, i) => distanceToSegment(p, q, s.rings[0]![(i + 1) % s.rings[0]!.length]!) < 4))));
  expect(facing.length).toBeGreaterThanOrEqual(3);
  expect(town.some(e => e.type === 'portal' && e.name === 'Crypt Stairs')).toBe(true);
  expect(town.filter(e => e.type === 'label' && e.size === 13).length).toBeGreaterThanOrEqual(2);
  const generic = new Set(['House', 'Cottage', 'Townhouse', 'Shop', 'Manor House', 'Workshop', 'Warehouse', 'Tenement', 'Barn', 'Crypt']);
  const named = buildings.map(b => b.name!).filter(n => !generic.has(n) && !n.endsWith(' Farm'));
  expect(new Set(named).size).toBe(named.length);
  const establishments = town.filter((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place' && e.category === 'establishment');
  expect(establishments.length).toBeGreaterThanOrEqual(8);
  for (const p of establishments) { expect(p.notes).toMatch(/Run by/); expect(p.gmNotes).toMatch(/Secret: .*Job: /); }
  const audit = settlementServiceAudit({ entities: Object.fromEntries(town.map(e => [e.id, e])) } as unknown as MapDoc);
  expect(audit.missing).toEqual([]);
  const themed = generateCity({ ...mile('town'), theme: { roof: ['shingles'], innRoof: ['inn'], marketStall: ['stall'] } });
  expect(themed.some(e => e.type === 'area' && e.texture?.assetId === 'shingles')).toBe(true);
  expect(themed.some(e => e.type === 'area' && e.texture?.assetId === 'inn' && e.texture.fitToArea)).toBe(true);
  const stalls = themed.filter(e => e.name === 'Market Stall');
  expect(stalls.length).toBeGreaterThan(0);
  expect(stalls.every(e => e.type === 'prop' && e.assetId === 'stall')).toBe(true);
  expect(themed.map(e => {
    if (e.type === 'area') { const { texture, ...area } = e; return area; }
    if (e.type === 'prop') { const { assetId, ...prop } = e; return prop; }
    return e;
  })).toEqual(town);
});

it('builds on the world town it was developed from: its scale, rumours, trouble and roads', () => {
  const base2 = { origin: 'inherited' as const, rev: 1, layerId: 'l' };
  const town = generateCity(mile('auto', [
    { ...base2, id: 'p', type: 'place', name: 'Fenmoor', category: 'Settlement', entityIds: [], gmNotes: '',
      notes: 'Village known for fine wool. Trouble: the reeve has gone missing. (Borderland (Patrolled Passes))', rumours: ['Wolves den at Blackgut Pit.'] },
    { ...base2, id: 'r1', type: 'path', role: 'trail', name: 'Fenmoor–Pellbury Road', points: [{ x: 430, y: 470 }, { x: 900, y: 470 }], width: 6, closed: false },
    { ...base2, id: 'r2', type: 'path', role: 'trail', name: 'Stanbury–Fenmoor Road', points: [{ x: 430, y: 470 }, { x: 430, y: 0 }], width: 6, closed: false },
  ]));
  expect(town.some(e => e.type === 'path' && e.role === 'cityWall')).toBe(false);
  expect(town.some(e => e.type === 'area' && e.name === 'Village Green')).toBe(true);
  expect(town.some(e => e.type === 'place' && e.category === 'Settlement')).toBe(false); // the adopted Place stays the one record
  const labels = town.filter((e): e is Extract<Entity, { type: 'label' }> => e.type === 'label').map(e => e.text);
  expect(labels).toEqual(expect.arrayContaining(['Fenmoor', 'to Pellbury', 'to Stanbury']));
  const places = town.filter((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place');
  expect(places.some(p => p.rumours?.some(r => r.includes('Blackgut Pit')))).toBe(true);
  expect(places.find(p => p.id === 'place-trouble')?.gmNotes).toMatch(/reeve has gone missing/);
});

it('wires competing urban factions across town landmarks and establishments', () => {
  const town = generateCity(mile('town'));
  const places = town.filter((e): e is Extract<Entity, { type: 'place' }> => e.type === 'place');
  const allLinks = places.flatMap((p) => p.factionLinks ?? []);
  expect(allLinks.some((l) => l.startsWith('Town Watch'))).toBe(true);
  expect(allLinks.some((l) => l.startsWith('Merchant Guild'))).toBe(true);
  expect(allLinks.some((l) => l.startsWith('Temple Chapter'))).toBe(true);
  expect(allLinks.some((l) => l.startsWith("Thieves' Guild"))).toBe(true);
  const townPlace = places.find((p) => p.id === 'place-town');
  expect(townPlace?.factionLinks?.length).toBeGreaterThanOrEqual(3);
  expect(townPlace?.gmNotes).toContain('Urban Factions:');
});

it('a blank standalone settlement shrinks its one-mile sheet to the village, and undo restores it',()=>{
  const store=createWorldStore(),s=()=>store.getState(), mile=1609.344;
  const map=MapDocSchema.parse({id:'m',name:'Village',kind:'settlement',bounds:{x:0,y:0,w:mile,h:mile},grid:{size:1.524,visible:false},
    layers:[{id:'l',name:'Base',visible:true,locked:false,gmOnly:false}],entities:{},generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]}});
  s().loadWorld({id:'w',name:'World',formatVersion:1,maps:[{id:'m',name:'Village',kind:'settlement'}],themes:{}},{m:map});
  s().execute('generator.run',{mapId:'m',type:'city',seed:9,entireMap:true,layerId:'l',params:{scale:'village'}});
  const b=s().world!.maps.m!.bounds;
  expect(b.w).toBe(640); expect(b.x+b.w/2).toBeCloseTo(mile/2);
  expect(Object.values(s().world!.maps.m!.entities).some(e=>e.type==='area'&&e.role==='building')).toBe(true);
  s().undo();
  expect(s().world!.maps.m!.bounds.w).toBeCloseTo(mile);
});
