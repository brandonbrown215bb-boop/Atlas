import { describe, expect, it } from 'vitest';
import { createWorldStore, worldStore } from './store';
import { MapDocSchema, WorldMetaSchema, type Entity } from './schema';
import { rectRing } from '../geom/fog';
import { pointInPolygon } from '../geom/hitTest';
import { resolveGeography, geographicEntities, polygonArea } from '../geom/geography';
import { navigateToMap, activateMapPanel } from './navigation';
import { viewStore } from './viewStore';
import { fitBoundsCamera, mapToScreen } from '../render/camera';
import { buildEntityDisplay } from '../render/drawEntity';
import { parentToChildCamera, childToParentCamera, shouldZoomOutToParent } from '../geom/childMaps';
import { migrateMapData } from './migrate';
import { validateWorld } from './transfer';
import '../gen/world/world';
import '../gen/city/city';

function fixture(kind='world') {
  const store=createWorldStore();
  const map=MapDocSchema.parse({id:'map',name:'Map',kind,bounds:{x:0,y:0,w:1000,h:1000},grid:{size:1.524,visible:true},layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],entities:{},generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]}});
  store.getState().loadWorld(WorldMetaSchema.parse({formatVersion:2,id:'world',name:'World',maps:[{id:'map',name:'Map',kind}],themes:{}}),{map});
  return store;
}
const area=(id:string,role:string,bounds={x:100,y:100,w:800,h:800}):Entity=>({id,type:'area',role:role as 'land',rings:[rectRing(bounds)],layerId:'base',origin:'manual',rev:0});

describe('walkthrough regressions',()=>{
  it('whole-map generation and reroll ignore a selected tiny island and preserve authored geography',()=>{
    const s=fixture(),map=structuredClone(s.getState().world!.maps.map!);
    map.bounds={x:0,y:0,w:1000000,h:800000};
    map.entities={tip:area('tip','land',{x:10000,y:200000,w:30000,h:30000}),
      west:area('west','land',{x:100000,y:100000,w:300000,h:600000}),
      east:area('east','land',{x:550000,y:100000,w:350000,h:600000})};
    const authored=structuredClone(map.entities),meta=s.getState().world!.meta;
    s.getState().loadWorld(meta,{map});
    const params={mode:'populate',cells:1000,density:0,rivers:false,settlements:12};
    s.getState().execute('generator.run',{mapId:'map',genId:'whole',type:'world',seed:1,layerId:'base',regionEntityId:'tip',entireMap:true,useBoundaryAsExtent:true,params});
    expect(s.getState().world!.maps.map!.bounds).toEqual(map.bounds);
    expect(s.getState().world!.maps.map!.generators.whole!.boundary).toEqual([rectRing(map.bounds)]);
    for(const [id,e]of Object.entries(authored))expect(s.getState().world!.maps.map!.entities[id]).toEqual(e);

    // Reproduce the old run, whose saved boundary was just the first traced island.
    s.getState().loadWorld(meta,{map:structuredClone(map)});
    s.getState().execute('generator.run',{mapId:'map',genId:'small',type:'world',seed:1,layerId:'base',regionEntityId:'tip',params});
    const before=s.getState().world!,small=Object.values(before.maps.map!.entities).filter(e=>e.type==='prop'&&e.suggestedSettlement);
    expect(small).toHaveLength(12);
    expect(small.every(e=>e.type==='prop'&&pointInPolygon(e,(authored.tip as Extract<Entity,{type:'area'}>).rings))).toBe(true);
    s.getState().execute('generator.reroll',{mapId:'map',genId:'small',seed:2,entireMap:true,params});
    const after=s.getState().world!.maps.map!,suggestions=Object.values(after.entities).filter((e):e is Extract<Entity,{type:'prop'}>=>e.type==='prop'&&!!e.suggestedSettlement);
    expect(suggestions).toHaveLength(12);expect(small.every(e=>!after.entities[e.id])).toBe(true);
    for(const id of ['west','east'])expect(suggestions.some(e=>pointInPolygon(e,(authored[id] as Extract<Entity,{type:'area'}>).rings))).toBe(true);
    expect(after.generators.small!.boundary).toEqual([rectRing(map.bounds)]);
    for(const [id,e]of Object.entries(authored))expect(after.entities[id]).toEqual(e);
    s.getState().undo();expect(s.getState().world).toEqual(before);
  });
  it('recovers deleted-layer contents on reopen or repair, then commits population as one undo step',()=>{
    const s=fixture(),raw=structuredClone(s.getState().world!.maps.map!);
    raw.layers[0]!.locked=true;
    raw.layers.push({id:'geography',name:'Geography',visible:true,locked:false,gmOnly:false});
    raw.entities.land={...area('land','land'),layerId:'geography'};
    raw.entities.ocean={...area('ocean','water',{x:0,y:0,w:1000,h:1000}),layerId:'deleted-layer',waterKind:'ocean'} as Entity;
    const original=structuredClone(raw);
    const reopened=migrateMapData(raw);
    expect(reopened.layers.find(l=>l.id==='deleted-layer')).toMatchObject({name:'Recovered contents'});
    expect(reopened.entities).toEqual(original.entities);expect(raw).toEqual(original);
    expect(migrateMapData(reopened).layers).toEqual(reopened.layers);

    s.getState().loadWorld(s.getState().world!.meta,{map:raw});
    const beforeRepair=s.getState().world;
    s.getState().execute('map.repair',{mapId:'map'});
    expect(s.getState().world!.maps.map!.entities).toEqual(original.entities);
    expect(()=>validateWorld(s.getState().world!)).not.toThrow();
    s.getState().undo();expect(s.getState().world).toEqual(beforeRepair);s.getState().redo();
    const source=structuredClone(s.getState().world!),worker=createWorldStore();
    worker.getState().loadWorld(source.meta,structuredClone(source.maps));
    worker.getState().execute('generator.run',{mapId:'map',type:'world',seed:3,layerId:'geography',entireMap:true,params:{mode:'populate',cells:200,density:0,settlements:0}});
    s.getState().execute('world.applyGenerated',{source,after:worker.getState().world});
    const generated=s.getState().world!;
    expect(generated.maps.map!.entities.land).toEqual(source.maps.map!.entities.land);
    expect(Object.values(generated.maps.map!.entities).filter(e=>e.origin==='generated').every(e=>e.layerId==='geography')).toBe(true);
    expect(()=>validateWorld(generated)).not.toThrow();
    s.getState().undo();expect(s.getState().world).toEqual(source);
  });
  it('rejects deleting a populated layer without changing the world or stranding contents',()=>{
    const s=fixture();s.getState().execute('layer.add',{mapId:'map',layer:{id:'second',name:'Second',visible:true,locked:false,gmOnly:false}});
    s.getState().execute('entity.add',{mapId:'map',entity:area('land','land')});
    const before=s.getState().world;
    expect(()=>s.getState().execute('layer.delete',{mapId:'map',layerId:'base'})).toThrow('contents');
    expect(s.getState().world).toBe(before);expect(()=>validateWorld(s.getState().world!)).not.toThrow();
    s.getState().execute('layer.delete',{mapId:'map',layerId:'second'});
    expect(s.getState().world!.maps.map!.layers).toHaveLength(1);
    s.getState().undo();expect(s.getState().world).toEqual(before);
  });
  it('map-list navigation replaces a zoom-pinned panel while keeping other editors independent',()=>{
    const map=fixture().getState().world!.maps.map!;
    worldStore.getState().loadWorld(WorldMetaSchema.parse({formatVersion:2,id:'w',name:'World',maps:[{id:'map',name:'Map',kind:'world'},{id:'dungeon',name:'Dungeon',kind:'interior'}],themes:{}}),{map,dungeon:{...map,id:'dungeon',kind:'interior'}});
    viewStore.setState({panels:{a:{mapId:'map',camera:null},b:{mapId:'map',camera:null}},activeMapPanelId:'a'});
    navigateToMap('dungeon');
    expect(viewStore.getState().panels.a?.mapId).toBe('dungeon');expect(viewStore.getState().panels.b?.mapId).toBe('map');
    activateMapPanel('b','map');expect(worldStore.getState().activeMapId).toBe('map');
  });
  it('fits huge children and preserves screen position through zoom handoff',()=>{
    const bounds={x:0,y:0,w:113692,h:68750},cam=fitBoundsCamera(bounds,1200,800,'settlement');
    expect(bounds.w*cam.zoom).toBeLessThan(1200);expect(bounds.h*cam.zoom).toBeLessThan(800);
    const parent={x:120,y:-40,zoom:.0001},offset={x:-300000,y:200000};
    const child=parentToChildCamera(parent,offset,'interior');const a=mapToScreen(child,100,200),b=mapToScreen(parent,offset.x+100,offset.y+200);expect(a.x).toBeCloseTo(b.x,9);expect(a.y).toBeCloseTo(b.y,9);
    expect(childToParentCamera(child,offset,'world')).toEqual(parent);
    const map={...fixture('settlement').getState().world!.maps.map!,bounds,parent:{mapId:'parent',...offset,rotation:0}};
    expect(shouldZoomOutToParent(cam,map,1200,800)).toBe(false);
    expect(shouldZoomOutToParent({...cam,zoom:cam.zoom*.4},map,1200,800)).toBe(true);
  });
  it('resolves ocean below land independently of layer/order and excludes real lakes',()=>{
    const store=fixture();for(const e of [{...area('ocean','water',{x:0,y:0,w:1000,h:1000}),name:'Ocean',origin:'generated' as const,genId:'old'},area('land','land'),area('lake','water',{x:400,y:400,w:100,h:100})])store.getState().execute('entity.add',{mapId:'map',entity:e});
    const map=store.getState().world!.maps.map!,g=resolveGeography(map);
    expect(g.land.reduce((n,r)=>n+polygonArea(r),0)).toBe(630000);
    expect(g.ocean.reduce((n,r)=>n+polygonArea(r),0)).toBe(370000);
    expect(geographicEntities(map).filter(e=>e.type==='area'&&e.role==='water').every(e=>e.type==='area'&&polygonArea(e.rings)<1000000)).toBe(true);
  });
  it('builds a city on inherited land after removing the ocean-under-land obstacle',()=>{
    const s=fixture('settlement');
    for(const e of [{...area('ocean','water',{x:0,y:0,w:1000,h:1000}),waterKind:'ocean',name:'Ocean',origin:'inherited'}, {...area('land','land',{x:0,y:0,w:1000,h:1000}),origin:'inherited'},area('district','district',{x:100,y:100,w:300,h:300})])s.getState().execute('entity.add',{mapId:'map',entity:e});
    s.getState().execute('generator.run',{mapId:'map',type:'city',seed:2,regionEntityId:'district',layerId:'base'});
    expect(Object.values(s.getState().world!.maps.map!.entities).some(e=>e.type==='area'&&e.role==='building')).toBe(true);
  });
  it('paints clipped custom biomes with stroke undo, no lake coverage and no world-history pollution on rejection',()=>{
    const s=fixture();s.getState().execute('entity.add',{mapId:'map',entity:area('land','land')});s.getState().execute('entity.add',{mapId:'map',entity:area('lake','water',{x:400,y:400,w:100,h:100})});
    const before=s.getState().world;
    s.getState().execute('map.paintBiome',{mapId:'map',biome:'haunted',points:[{x:450,y:450}],radius:200,layerId:'base'});
    const painted=s.getState().world!;const biomes=Object.values(painted.maps.map!.entities).filter(e=>e.type==='area'&&e.role==='biome:haunted');
    expect(biomes.length).toBeGreaterThan(0);expect(biomes.every(e=>e.type==='area'&&e.rings.length>1)).toBe(true);
    s.getState().undo();expect(s.getState().world).toEqual(before);s.getState().redo();expect(s.getState().world).toEqual(painted);
  });
  it('whole-world generation needs no input floor and group resizing preserves replaceability',()=>{
    const s=fixture();const result=s.getState().execute('generator.run',{mapId:'map',type:'world',seed:9,layerId:'base',params:{cells:200,density:0,settlements:0}}) as {genId:string};
    const map=s.getState().world!.maps.map!,members=Object.values(map.entities).filter(e=>e.groupId===result.genId);
    const changes=members.map(e=>({entityId:e.id,patch:e.type==='area'?{rings:e.rings.map(r=>r.map(p=>({x:p.x*2,y:p.y*2})))}:{}}));
    s.getState().execute('group.applyTransform',{mapId:'map',groupId:result.genId,changes});
    expect(s.getState().world!.maps.map!.bounds.w).toBe(2000);
    expect(Object.values(s.getState().world!.maps.map!.entities).filter(e=>e.genId).every(e=>e.origin==='generated')).toBe(true);
    s.getState().execute('generator.reroll',{mapId:'map',genId:result.genId,seed:10});
    expect(Object.values(s.getState().world!.maps.map!.entities).filter(e=>e.genId&&e.rev<3)).toHaveLength(0);
  });
  it('river tributaries share a real junction and moving it updates all incident segments',()=>{
    const s=fixture();const river={id:'main',type:'path',role:'river',layerId:'base',origin:'manual',rev:0,points:[{x:0,y:100},{x:200,y:100}],width:5,closed:false};
    s.getState().execute('river.add',{mapId:'map',entity:river,snapDistance:2});
    s.getState().execute('river.add',{mapId:'map',entity:{...river,id:'branch',points:[{x:100,y:0},{x:100,y:100}]},snapDistance:2});
    const branch=s.getState().world!.maps.map!.entities.branch!;expect(branch.type).toBe('path');if(branch.type!=='path')return;
    s.getState().execute('entity.update',{mapId:'map',entityId:'branch',patch:{points:[{x:100,y:0},{x:110,y:120}]}});
    const linked=Object.values(s.getState().world!.maps.map!.entities).filter(e=>e.type==='path'&&(e.startNodeId===branch.endNodeId||e.endNodeId===branch.endNodeId));
    expect(linked).toHaveLength(3);for(const e of linked)if(e.type==='path')expect(e.startNodeId===branch.endNodeId?e.points[0]:e.points[e.points.length-1]).toEqual({x:110,y:120});
  });
  it('migrates ownership and keeps orphaned records without fabricating missing geometry',()=>{
    const map=structuredClone(fixture().getState().world!.maps.map!);map.formatVersion=1;map.generators.orphan={type:'world',seed:1,params:{},regionEntityId:'missing'};
    const upgraded=migrateMapData(map);expect(upgraded.generators.orphan).toBeDefined();expect(upgraded.entities.missing).toBeUndefined();expect(upgraded.groups?.orphan).toBeDefined();
  });
  it('rejects a stale worker result and keeps the intervening edit',()=>{
    const s=fixture(),source=structuredClone(s.getState().world!);
    s.getState().execute('entity.add',{mapId:'map',entity:area('edit','land')});
    const current=s.getState().world;
    expect(()=>s.getState().execute('world.applyGenerated',{source,after:source})).toThrow('world changed');
    expect(s.getState().world).toBe(current);
  });
  it('moves linked children recursively but preserves interior dimensions and unrelated children',()=>{
    const s=fixture();s.getState().execute('entity.add',{mapId:'map',entity:{...area('a','land'),groupId:'g'}});
    // Trace/manual groups have no generator record and still move as a complete result.
    const root=structuredClone(s.getState().world!.maps.map!);root.groups={g:{name:'Group',boundary:[rectRing({x:100,y:100,w:800,h:800})]}};
    const child=MapDocSchema.parse({...root,id:'child',kind:'settlement',parent:{mapId:'map',x:200,y:200,rotation:0},bounds:{x:0,y:0,w:100,h:100},entities:{}});
    const interior=MapDocSchema.parse({...child,id:'room',kind:'interior',parent:{mapId:'child',x:10,y:20,rotation:0},bounds:{x:0,y:0,w:12,h:8}});
    const unrelated=MapDocSchema.parse({...child,id:'other',parent:{mapId:'map',x:950,y:950,rotation:0}});
    const meta={...s.getState().world!.meta,maps:[{id:'map',name:'Map',kind:'world' as const},{id:'child',name:'Child',kind:'settlement' as const,parentId:'map'},{id:'room',name:'Room',kind:'interior' as const,parentId:'child'},{id:'other',name:'Other',kind:'settlement' as const,parentId:'map'}]};
    s.getState().loadWorld(meta,{map:root,child,room:interior,other:unrelated});
    const e=root.entities.a!;if(e.type!=='area')throw Error();
    s.getState().execute('group.applyTransform',{mapId:'map',groupId:'g',changes:[{entityId:'a',patch:{rings:e.rings.map(r=>r.map(p=>({x:p.x*2,y:p.y*2})))}}]});
    const maps=s.getState().world!.maps;
    expect(maps.child!.bounds.w).toBe(200);expect(maps.child!.parent).toMatchObject({x:400,y:400});
    expect(maps.room!.bounds).toEqual(interior.bounds);expect(maps.room!.parent).toMatchObject({x:20,y:40});
    expect(maps.other).toEqual(unrelated);
    s.getState().undo();expect(s.getState().world!.maps.child).toEqual(child);
  });
  it('populate mode preserves traced coastlines on Generate Entire Map and rejects contradicted manual rivers without moving them',()=>{
    const s=fixture();
    const island=area('island','land',{x:200,y:200,w:500,h:500});
    const badRiver:Entity={id:'bad-river',type:'path',role:'river',layerId:'base',origin:'manual',rev:0,points:[{x:250,y:250},{x:350,y:250},{x:350,y:350},{x:250,y:250}],width:6,closed:false};
    s.getState().execute('entity.add',{mapId:'map',entity:island});
    s.getState().execute('entity.add',{mapId:'map',entity:badRiver});
    const before=s.getState().world;
    expect(()=>s.getState().execute('generator.run',{mapId:'map',type:'world',seed:4,layerId:'base',entireMap:true,params:{mode:'populate',cells:250}})).toThrow('closed loop');
    expect(s.getState().world).toBe(before);
    s.getState().execute('entity.delete',{mapId:'map',entityId:'bad-river'});
    s.getState().execute('generator.run',{mapId:'map',type:'world',seed:4,layerId:'base',entireMap:true,params:{mode:'populate',cells:250}});
    const after=s.getState().world!.maps.map!;
    expect(after.entities.island).toMatchObject({rings:(island as Extract<Entity,{type:'area'}>).rings});
    const generatedLand=Object.values(after.entities).filter(e=>e.origin==='generated'&&e.type==='area'&&e.role==='land');
    expect(generatedLand).toHaveLength(0);
    const model=Object.values(after.terrain ?? {})[0]!;
    expect(model.cells.some(c=>!c.land)).toBe(true);
  });
  it('bounds selection outline stroke width on scaled built-in glyphs in screen space',()=>{
    const prop:Entity={id:'p',type:'prop',layerId:'base',origin:'manual',rev:0,builtin:'mountain',x:100,y:100,w:10,h:10,scale:40,rotation:0,flipX:false};
    const display=buildEntityDisplay(prop,{selected:true,zoom:0.05});
    expect(display.scale.x).toBe(40);
    expect(display.children.length).toBeGreaterThanOrEqual(2);
  });
});
