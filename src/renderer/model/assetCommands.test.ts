import { describe, expect, it } from 'vitest';
import { createWorldStore } from './store';
import { MapDocSchema, WorldMetaSchema } from './schema';
import { getEntityBounds, hitTestEntity } from '../geom/hitTest';

const createDefaultWorldMeta = () => WorldMetaSchema.parse({ formatVersion: 1, id: 'w', name: 'Test', maps: [{ id:'m', name:'Test', kind:'site' }], themes: {} });
const createDefaultMapDoc = () => MapDocSchema.parse({ formatVersion:1,id:'m',name:'Test',kind:'site',bounds:{x:0,y:0,w:20,h:20},grid:{size:1.524,visible:true},
  layers:[{id:'base',name:'Base',visible:true,locked:false,gmOnly:false}],entities:{},generators:{},revision:0,deleted:{},fog:{enabled:false,revealed:[]} });

describe('asset commands', () => {
  it('stamps props with real dimensions; rotated selection matches; undo/redo restores exact data', () => {
    const s = createWorldStore();
    const map = createDefaultMapDoc();
    s.getState().loadWorld(createDefaultWorldMeta(), { [map.id]: map });
    s.getState().execute('prop.stamp', { mapId: map.id, layerId: map.layers[0]!.id, assetId: 'art', id: 'tree', x: 5, y: 5, w: 1.524, h: 3.048, rotation: Math.PI/2, scale: 2 });
    const e = s.getState().world!.maps[map.id]!.entities['tree']!;
    expect(getEntityBounds(e)).toMatchObject({ minX: 1.952, maxX: 8.048 });
    expect(hitTestEntity(e, { x: 7, y: 5 }, 0)).toBe(true);
    expect(hitTestEntity(e, { x: 5, y: 7 }, 0)).toBe(false);
    s.getState().undo(); expect(s.getState().world!.maps[map.id]!.entities['tree']).toBeUndefined();
    s.getState().redo(); expect(s.getState().world!.maps[map.id]!.entities['tree']).toEqual(e);
  });
  it('applies textures as one edit, preserves holes and refuses locked layers', () => {
    const s = createWorldStore(); const map = createDefaultMapDoc();
    s.getState().loadWorld(createDefaultWorldMeta(), { [map.id]: map });
    s.getState().execute('entity.add', { mapId: map.id, entity: { id: 'floor', layerId: map.layers[0]!.id, type: 'area', origin: 'generated', rev: 0,
      role: 'floor', rings: [[{ x:0,y:0 },{ x:10,y:0 },{ x:10,y:10 }],[{ x:2,y:2 },{ x:3,y:2 },{ x:3,y:3 }]] } });
    const before = s.getState().world;
    s.getState().execute('entity.setTexture', { mapId: map.id, entityIds: ['floor'], assetId: 'art', metersPerPixel: 1.524/200 });
    const e = s.getState().world!.maps[map.id]!.entities['floor']!;
    expect(e).toMatchObject({ origin: 'manual', texture: { assetId: 'art' } });
    s.getState().undo(); expect(s.getState().world).toEqual(before);
    s.getState().execute('layer.update', { mapId: map.id, layerId: map.layers[0]!.id, patch: { locked: true } });
    expect(() => s.getState().execute('entity.setTexture', { mapId: map.id, entityIds: ['floor'], clear: true })).toThrow(/unlocked/);
  });
  it('uses imported scale on generated floors and keeps existing theme assignments', () => {
    const entry = { originalName: 'Flagstone', packName: 'Art', pxPerSquare: 256, width: 512, height: 512, ext: 'png' };
    const s = createWorldStore(() => ({ flagstone: entry }));
    const map = createDefaultMapDoc();
    s.getState().loadWorld(createDefaultWorldMeta(), { [map.id]: map });
    s.getState().execute('theme.setRole', { role: 'floorTexture', assetIds: ['flagstone'] });
    s.getState().execute('theme.setRole', { role: 'floorTexture', assetIds: ['other'], onlyIfEmpty: true });
    s.getState().execute('generator.run', { mapId: map.id, genId: 'chamber', type: 'dungeon', entireMap: true,
      layerId: 'base', seed: 4, params: { mode: 'chamber' } });
    const floors = Object.values(s.getState().world!.maps[map.id]!.entities)
      .filter(e => e.type === 'area' && e.role === 'floor');
    expect(floors.length).toBeGreaterThan(0);
    for (const floor of floors) expect(floor).toMatchObject({ texture: { assetId: 'flagstone', metersPerPixel: 1.524 / 256 } });
  });
});
