import { describe, expect, it } from 'vitest';
import { distanceToSegment, pointInPolygon } from '../../geom/hitTest';
import { MapDocSchema, type Entity, type Point } from '../../model/schema';
import { createWorldStore } from '../../model/store';
import { transferMap } from '../../model/transfer';
import { dressDungeon } from './dressing';
import { DungeonParamsSchema, generateDungeon } from './layout';

const region=[[{x:0,y:0},{x:30,y:0},{x:30,y:24},{x:0,y:24}]];
const input={seed:6,params:DungeonParamsSchema.parse({purpose:'tavern'}),region,constraints:[],theme:{table:['table-asset']},grid:1.524};
// Trap plates are deliberately in the walking line; only furniture must keep doorways clear.
const props=(entities:Entity[])=>entities.filter((e):e is Extract<Entity,{type:'prop'}>=>e.type==='prop'&&e.tacticalTag!=='hazard');

describe('dungeon dressing',()=>{
  it('is deterministic, uses theme roles and placeholders, and leaves doorways and door-to-door routes clear',()=>{
    for(const mode of ['building','dungeon','chamber'] as const) for(let seed=1;seed<=5;seed++) {
      const options={...input,seed,params:{...input.params,mode}};
      const result=generateDungeon(options);
      expect(result).toEqual(generateDungeon(options));
      const placed=props(result), doors=result.filter((e):e is Extract<Entity,{type:'door'}>=>e.type==='door');
      expect(placed.length).toBeGreaterThan(0);
      for(const prop of placed) {
        const radius=Math.hypot(prop.w!,prop.h!)/2;
        expect(pointInPolygon(prop,region)).toBe(true);
        expect(doors.every(d=>distanceToSegment(prop,d.a,d.b)>=input.grid+radius)).toBe(true);
        for(const floor of result.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&pointInPolygon(prop,e.rings))) {
          const roomDoors=doors.filter(d=>floor.rings.some(r=>r.some((a,i)=>distanceToSegment({x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2},a,r[(i+1)%r.length]!)<input.grid*.1)));
          for(let i=0;i<roomDoors.length;i++) for(let j=i+1;j<roomDoors.length;j++) {
            const a=roomDoors[i]!,b=roomDoors[j]!;
            expect(distanceToSegment(prop,{x:(a.a.x+a.b.x)/2,y:(a.a.y+a.b.y)/2},{x:(b.a.x+b.b.x)/2,y:(b.a.y+b.b.y)/2})).toBeGreaterThanOrEqual(radius+input.grid*.5);
          }
        }
      }
    }
    const placed=props(generateDungeon(input));
    expect(placed.some(p=>p.assetId==='table-asset')).toBe(true);
    expect(placed.some(p=>!!p.builtin)).toBe(true);
  });
  it('honors room purposes and existing props as constraints',()=>{
    const floor:Entity={id:'floor',type:'area',role:'floor',name:'Main',rings:region,layerId:'base',origin:'generated',rev:0};
    const fixed:Entity={id:'fixed',type:'prop',layerId:'base',origin:'manual',rev:1,builtin:'rock',x:5,y:5,w:5,h:5,rotation:0,scale:1,flipX:false};
    const output=dressDungeon({...input,params:{...input.params,roomPurposes:{Main:'bedroom'}},constraints:[fixed]},[floor]);
    expect(output.some(e=>e.name==='bedroom: bed')).toBe(true);
    expect(props(output).every(e=>Math.abs(e.x-5)>3||Math.abs(e.y-5)>3)).toBe(true);
  });
  it('keeps a generated landmark and its room-key link when furniture is rearranged or thinned', () => {
    const store = createWorldStore();
    const footprint = [[{ x: 0, y: 0 }, { x: 152.4, y: 0 }, { x: 152.4, y: 152.4 }, { x: 0, y: 152.4 }]];
    const map = MapDocSchema.parse({
      id: 'm', name: 'Saltworks', kind: 'site', bounds: { x: 0, y: 0, w: 152.4, h: 152.4 },
      grid: { size: 1.524, visible: true }, layers: [{ id: 'base', name: 'Base', visible: true, locked: false, gmOnly: false }],
      entities: { region: { id: 'region', type: 'area', role: 'land', rings: footprint, origin: 'manual', layerId: 'base', rev: 0 } },
      generators: {}, revision: 0, deleted: {}, fog: { enabled: false, revealed: [] },
    });
    const state = () => store.getState();
    state().loadWorld({ id: 'w', formatVersion: 1, name: 'World', maps: [{ id: 'm', name: 'Saltworks', kind: 'site' }],
      themes: { default: { pumpWheel: ['pump-art'], bridge: ['builtin:bridge'] } } }, { m: map });
    state().execute('generator.run', { mapId: 'm', genId: 'g', type: 'dungeon', seed: 7, params: { mode: 'dungeon' }, regionEntityId: 'region', layerId: 'base' });
    const entities = () => state().world!.maps.m!.entities;
    const pump = Object.values(entities()).find(e => e.name === 'Bronze Pump')!;
    expect(pump).toMatchObject({ type: 'prop', assetId: 'pump-art', builtin: 'pumpWheel', tacticalTag: 'feature' });
    expect(Object.values(entities()).find(e => e.name === 'Plank Walk')).toMatchObject({ type: 'prop', builtin: 'bridge' });
    const key = Object.values(entities()).find(e => e.type === 'place' && e.entityIds.includes(pump.id))!;
    state().execute('generator.reroll', { mapId: 'm', genId: 'g', seed: 8, dressingOnly: true });
    expect(entities()[pump.id]).toEqual(pump);
    expect(entities()[key.id]).toEqual(key);
    state().execute('generator.dressArea', { mapId: 'm', genId: 'g', areaEntityId: 'region', action: 'thin' });
    expect(entities()[pump.id]).toEqual(pump);
    expect(entities()[key.id]).toEqual(key);
  });
  it('rerolls only dressing, preserves edits exactly, and scopes thin/add/reroll with one-step undo',()=>{
    const map=MapDocSchema.parse({id:'m',name:'Interior',kind:'interior',bounds:{x:0,y:0,w:30,h:24},grid:{size:1.524,visible:true},
      layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],
      entities:{region:{id:'region',type:'area',role:'building',rings:region,origin:'manual',layerId:'base',rev:0}},
      generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]}});
    const store=createWorldStore();
    store.getState().loadWorld({id:'w',formatVersion:1,name:'World',maps:[{id:'m',name:'Interior',kind:'interior'}],themes:{default:{}}},{m:map});
    const s=()=>store.getState(), current=()=>s().world!.maps.m!;
    s().execute('generator.run',{mapId:'m',genId:'g',type:'dungeon',seed:6,params:{purpose:'tavern'},regionEntityId:'region',layerId:'base'});
    const editedId=props(Object.values(current().entities))[0]!.id;
    s().execute('entity.update',{mapId:'m',entityId:editedId,patch:{name:'Keep my table'}});
    const manual=current().entities[editedId];
    const layout=Object.values(current().entities).filter(e=>e.type!=='prop');
    s().execute('generator.reroll',{mapId:'m',genId:'g',seed:42,dressingOnly:true});
    expect(current().entities[editedId]).toEqual(manual);
    expect(Object.values(current().entities).filter(e=>e.type!=='prop')).toEqual(layout);
    for(const action of ['thin','more','reroll']) {
      const before=s().world;
      s().execute('generator.dressArea',{mapId:'m',genId:'g',areaEntityId:'region',action,seed:7});
      expect(current().entities[editedId]).toEqual(manual);
      expect(Object.values(current().entities).filter(e=>e.type!=='prop')).toEqual(layout);
      expect(s().world).not.toEqual(before);
      s().undo();expect(s().world).toEqual(before);
    }
    const room=Object.values(current().entities).find((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='floor')!;
    const outside=props(Object.values(current().entities)).filter(e=>!pointInPolygon(e,room.rings));
    s().execute('generator.dressArea',{mapId:'m',genId:'g',areaEntityId:room.id,action:'thin'});
    for(const e of outside) expect(current().entities[e.id]).toEqual(e);
    s().undo();
    const editedFloor=Object.values(current().entities).find(e=>e.type==='area'&&e.id!=='region')!;
    s().execute('entity.update',{mapId:'m',entityId:editedFloor.id,patch:{name:'My room'}});
    const floorSnapshot=current().entities[editedFloor.id];
    s().execute('generator.reroll',{mapId:'m',genId:'g',seed:9});
    expect(current().entities[editedId]).toEqual(manual);
    expect(current().entities[editedFloor.id]).toEqual(floorSnapshot);
    const source=s().world!;
    const copied=transferMap(source,{meta:{...source.meta,id:'other',maps:[]},maps:{}},{mapId:'m',mode:'copy'});
    const copyStore=createWorldStore();copyStore.getState().loadWorld(copied.target.meta,copied.target.maps);
    const genId=Object.keys(copied.target.maps[copied.mapId]!.generators)[0]!;
    expect(()=>copyStore.getState().execute('generator.reroll',{mapId:copied.mapId,genId,seed:10,dressingOnly:true})).not.toThrow();
  });

  it('tags tactical cover props with coverHeight and coverFacing and injects freestanding pillars in large dungeon rooms', () => {
    const out = generateDungeon({
      seed: 17,
      params: DungeonParamsSchema.parse({ mode: 'dungeon', rooms: 8, purpose: 'crypt', density: 1 }),
      region: [[{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 38 }, { x: 0, y: 38 }]],
      constraints: [],
      theme: {},
      grid: 1.524,
    });
    const coverProps = props(out).filter((p) => p.tacticalTag === 'cover');
    expect(coverProps.length).toBeGreaterThan(0);
    expect(coverProps.every((p) => p.coverHeight === 'low' || p.coverHeight === 'tall')).toBe(true);
    expect(coverProps.every((p) => p.coverFacing === 'directional' || p.coverFacing === 'freestanding')).toBe(true);
    expect(coverProps.some((p) => p.coverHeight === 'tall' && p.coverFacing === 'freestanding')).toBe(true);
  });
});
