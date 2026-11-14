import { describe, expect, it } from 'vitest';
import { MapDocSchema, type Entity } from '../../model/schema';
import { createWorldStore } from '../../model/store';
import { validateWorld } from '../../model/transfer';
import { previewInterior } from './interior';

const parent=MapDocSchema.parse({id:'town',name:'Town',kind:'settlement',bounds:{x:0,y:0,w:1000,h:1000},grid:{size:10,visible:false},
  layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],entities:{
    building:{id:'building',type:'area',role:'building',name:'The Anchor',layerId:'base',origin:'generated',genId:'city',rev:1,
      rings:[[{x:100,y:200},{x:130,y:200},{x:130,y:224},{x:100,y:224}]]},
    entrance:{id:'entrance',type:'door',layerId:'base',origin:'manual',rev:1,a:{x:114,y:200},b:{x:115.524,y:200},kind:'door',open:false},
    place:{id:'place',type:'place',layerId:'base',origin:'manual',rev:1,name:'The Anchor',category:'Inn',notes:'Known innkeeper',gmNotes:'Hidden cellar',entityIds:['building']},
  },generators:{},revision:1,deleted:{},fog:{enabled:false,revealed:[]}});
const options={buildingId:'building',childMapId:'inside',name:'The Anchor Interior',seed:5,params:{purpose:'tavern'},theme:{}};

describe('open-interior generator flow',()=>{
  it('previews deterministically without changing the parent and retains real dimensions and entrance positions',()=>{
    const snapshot=structuredClone(parent);
    const preview=previewInterior(parent,options);
    expect(preview).toEqual(previewInterior(parent,options));expect(parent).toEqual(snapshot);
    expect(preview.bounds).toEqual({x:0,y:0,w:30,h:24});
    expect(preview.parent).toEqual({mapId:'town',x:100,y:200,rotation:0,footprintEntityId:'building'});
    const door=preview.entities['inherited-door:entrance'];
    expect(door).toMatchObject({type:'door',origin:'inherited',a:{x:14,y:0}});
    expect(door?.type==='door'&&door.b.x).toBeCloseTo(15.524);
    // An off-grid entrance cuts its exact width out of the generated exterior wall.
    const walls=Object.values(preview.entities).filter((e):e is Extract<Entity,{type:'wall'}>=>e.type==='wall');
    for(const wall of walls) if(wall.points.every(p=>p.y===0)) {
      const a=wall.points[0]!.x,b=wall.points[1]!.x;
      expect(Math.min(a,b)>=15.524-1e-7||Math.max(a,b)<=14+1e-7).toBe(true);
    }
  });
  it('accepts as one command, keeps the place notes, and undoes the whole map and link',()=>{
    const store=createWorldStore();
    store.getState().loadWorld({id:'w',formatVersion:1,name:'World',maps:[{id:'town',name:'Town',kind:'settlement'}],themes:{default:{}}},{town:parent});
    const before=store.getState().world;
    store.getState().execute('map.generateInterior',{parentMapId:'town',...options,theme:undefined,expectedParentRevision:1});
    const after=store.getState().world!;
    expect(validateWorld(after)).toEqual(after);
    expect(after.maps.town!.entities.place).toMatchObject({childMapId:'inside',notes:'Known innkeeper',gmNotes:'Hidden cellar'});
    expect(after.maps.town!.entities.building!.origin).toBe('manual');
    expect(after.maps.inside).toEqual(previewInterior(parent,options));
    const unchanged=store.getState().world;
    expect(()=>store.getState().execute('map.generateInterior',{parentMapId:'town',...options})).toThrow('already has an interior');
    expect(store.getState().world).toBe(unchanged);
    store.getState().undo();expect(store.getState().world).toEqual(before);
    store.getState().redo();expect(store.getState().world).toEqual(after);
  });
  it('creates a place when needed and rejects a stale preview without creating a map',()=>{
    const noPlace=structuredClone(parent);delete noPlace.entities.place;
    const store=createWorldStore();
    store.getState().loadWorld({id:'w',formatVersion:1,name:'World',maps:[{id:'town',name:'Town',kind:'settlement'}],themes:{}},{town:noPlace});
    const input={parentMapId:'town',...options};
    expect(()=>store.getState().execute('map.generateInterior',{...input,expectedParentRevision:0})).toThrow('Preview the interior again');
    expect(Object.keys(store.getState().world!.maps)).toEqual(['town']);
    store.getState().execute('map.generateInterior',input);
    expect(Object.values(store.getState().world!.maps.town!.entities).find(e=>e.type==='place')).toMatchObject({name:'The Anchor',childMapId:'inside',entityIds:['building']});
  });
});
