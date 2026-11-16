import { expect, it } from 'vitest';
import { MapDocSchema } from '../model/schema';
import { paintFog, intersectsRevealed, intersectsExplored, rectRing } from './fog';
import { playerRenderList } from '../model/player';
import { createWorldStore } from '../model/store';

const mapFixture = () => MapDocSchema.parse({id:'m',name:'Room',kind:'interior',bounds:{x:0,y:0,w:20,h:20},grid:{size:1.524,visible:true},layers:[{id:'l',name:'Art',visible:true,locked:false,gmOnly:false}],entities:{},generators:{},revision:0,deleted:{},fog:{enabled:true,revealed:[]}});
it('reveal then hide, including strokes crossing a hole and distant points', () => {
  const map=mapFixture();
  map.fog.revealed=paintFog([], [{x:3,y:3},{x:15,y:3}],2,false);
  expect(intersectsRevealed(map,{x:9,y:2,w:1,h:1})).toBe(true);
  map.fog.revealed=paintFog(map.fog.revealed,[{x:9,y:3}],3,true);
  expect(intersectsRevealed(map,{x:8.5,y:2.5,w:1,h:1})).toBe(false);
  expect(intersectsRevealed(map,{x:3,y:3,w:1,h:1})).toBe(true);
});
it('player render list omits entities wholly outside reveal, including holes', () => {
  const map=mapFixture(); map.fog.revealed=[[rectRing({x:0,y:0,w:10,h:10}),rectRing({x:4,y:4,w:3,h:3})]];
  for(const [id,x,y] of [['inside',1,1],['outside',15,15],['hole',5,5]] as const) map.entities[id]={id,type:'prop',layerId:'l',origin:'manual',rev:0,builtin:'rock',x,y,rotation:0,scale:0.1,flipX:false};
  expect(playerRenderList(map).map(e=>e.id)).toEqual(['inside']);
});
it('fog stroke is saved and undone as one command', () => {
  const store=createWorldStore(), map=mapFixture();
  store.getState().loadWorld({formatVersion:1,id:'w',name:'W',maps:[{id:'m',name:'Room',kind:'interior'}],themes:{}},{m:map});
  store.getState().execute('fog.paint',{mapId:'m',mode:'reveal',points:[{x:2,y:2},{x:12,y:2}],radius:2});
  expect(store.getState().world!.maps.m!.fog.revealed.length).toBeGreaterThan(0);
  expect(store.getState().history.past).toHaveLength(1);
  store.getState().undo(); expect(store.getState().world!.maps.m!.fog.revealed).toEqual([]);
});
it('two-tier fog dimActive keeps explored silhouette after active sight leaves', () => {
  const store = createWorldStore(), map = mapFixture();
  store.getState().loadWorld({ formatVersion: 1, id: 'w', name: 'W', maps: [{ id: 'm', name: 'Room', kind: 'interior' }], themes: {} }, { m: map });
  store.getState().execute('fog.paint', { mapId: 'm', mode: 'reveal', points: [{ x: 2, y: 2 }, { x: 12, y: 2 }], radius: 2 });
  store.getState().execute('fog.paint', { mapId: 'm', mode: 'dimActive', points: [{ x: 6, y: 2 }], radius: 4 });
  const updated = store.getState().world!.maps.m!;
  expect(intersectsRevealed(updated, { x: 5.5, y: 1.5, w: 1, h: 1 })).toBe(false);
  expect(intersectsExplored(updated, { x: 5.5, y: 1.5, w: 1, h: 1 })).toBe(true);
});
it('los torch fog blocks vision behind opaque walls and pushes old sight into memory', () => {
  const store = createWorldStore(), map = mapFixture();
  map.entities.wall1 = { id: 'wall1', type: 'wall', layerId: 'l', origin: 'manual', rev: 0, points: [{ x: 10, y: 0 }, { x: 10, y: 20 }], blocksMove: true, blocksSight: true };
  store.getState().loadWorld({ formatVersion: 1, id: 'w', name: 'W', maps: [{ id: 'm', name: 'Room', kind: 'interior' }], themes: {} }, { m: map });
  store.getState().execute('fog.paint', { mapId: 'm', mode: 'los', points: [{ x: 4, y: 10 }], radius: 5 });
  let updated = store.getState().world!.maps.m!;
  expect(intersectsRevealed(updated, { x: 5, y: 9.5, w: 1, h: 1 })).toBe(true);
  store.getState().execute('fog.paint', { mapId: 'm', mode: 'los', points: [{ x: 7, y: 10 }], radius: 6 });
  updated = store.getState().world!.maps.m!;
  // Wall at x=10 blocks active sight at x=11.5 while earlier revealed spot at x=1.5 stays in explored memory.
  expect(intersectsRevealed(updated, { x: 11.5, y: 9.5, w: 1, h: 1 })).toBe(false);
  expect(intersectsExplored(updated, { x: 1.5, y: 9.5, w: 1, h: 1 })).toBe(true);
});
