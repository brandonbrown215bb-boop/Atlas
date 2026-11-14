import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MapDocSchema, WorldMetaSchema } from '../model/schema';
import { createWorldStore } from '../model/store';
import { registerGenerator, regionConstraints } from './framework';
import { mulberry32 } from './rng';

registerGenerator({ type: 'test-generator', title: 'Test', params: z.object({}), generate: input => [{
  id: 'prop', type: 'prop', origin: 'generated', layerId: 'base', rev: 0,
  builtin: 'table', x: mulberry32(input.seed)() * 10, y: 5, rotation: 0, scale: 1, flipX: false,
}] });

export function fixtureStore() {
  const map = MapDocSchema.parse({ id: 'map', name: 'Interior', kind: 'interior', bounds: {x:0,y:0,w:30,h:24},
    grid: {size:1.524,visible:true}, layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],
    entities: { footprint: {id:'footprint',type:'area',role:'building',origin:'manual',rev:0,layerId:'base',
      rings:[[{x:0,y:0},{x:30,y:0},{x:30,y:24},{x:0,y:24}]]} },
    generators:{}, revision:0, deleted:{}, fog:{enabled:false,revealed:[]} });
  const meta = WorldMetaSchema.parse({formatVersion:1,id:'world',name:'World',maps:[{id:'map',name:'Interior',kind:'interior'}],themes:{default:{}}});
  const store = createWorldStore(); store.getState().loadWorld(meta, {map}); return store;
}

describe('generator framework', () => {
  it('has a reproducible mulberry32 stream with unsigned seeds', () => {
    const a = mulberry32(1), b = mulberry32(1);
    const values = Array.from({length:50}, () => a());
    expect(values).toEqual(Array.from({length:50}, () => b()));
    expect(values[0]).toBe(0.6270739405881613);
    expect(values.every(n => n >= 0 && n < 1)).toBe(true);
  });
  it('rerolls in one undo step, keeps edited entities exactly, and accepts undoably', () => {
    const store = fixtureStore(), s = () => store.getState();
    const input = {mapId:'map',genId:'g',type:'test-generator',seed:4,params:{},regionEntityId:'footprint',layerId:'base'};
    const before = s().world;
    s().execute('generator.run', input);
    const id = Object.values(s().world!.maps.map!.entities).find(e => e.type === 'prop')!.id;
    s().execute('entity.update', {mapId:'map',entityId:id,patch:{x:10}});
    const edited = s().world!.maps.map!.entities[id];
    const preReroll = s().world;
    s().execute('generator.reroll', {mapId:'map',genId:'g',seed:5});
    expect(s().world!.maps.map!.entities[id]).toEqual(edited);
    s().undo(); expect(s().world).toEqual(preReroll);
    s().redo(); const preAccept = s().world;
    s().execute('generator.accept', {mapId:'map',genId:'g'});
    expect(Object.values(s().world!.maps.map!.entities).every(e => e.origin === 'manual')).toBe(true);
    expect(s().world!.maps.map!.generators).toEqual({});
    s().undo(); expect(s().world).toEqual(preAccept);
    while (s().undo()) { /* restore */ }
    expect(s().world).toEqual(before);
  });
  it('collects manual/inherited constraints and rejects bad input without changing anything', () => {
    const store = fixtureStore(), map = store.getState().world!.maps.map!;
    expect(regionConstraints(map, map.entities.footprint!.type === 'area' ? map.entities.footprint!.rings : [], 'footprint')).toEqual([]);
    const before = store.getState().world;
    expect(() => store.getState().execute('generator.run', {mapId:'map',type:'missing',seed:1,regionEntityId:'footprint',layerId:'base'})).toThrow('Unknown generator');
    expect(store.getState().world).toBe(before);
  });
});
