import { afterEach,expect,it,vi } from 'vitest';
import { worldStore } from './store';
import { flushDirtyWorld } from './persistence';

afterEach(()=>{vi.unstubAllGlobals();worldStore.getState().closeWorld();});
function load() {
  worldStore.getState().loadWorld({id:'w',name:'World',formatVersion:1,maps:[],themes:{}},{},'C:/fixture');
  worldStore.getState().execute('map.create',{id:'m',name:'Map',kind:'site'});
}
it('an edit during an in-flight save remains dirty until its own write completes',async()=>{
  load();let finish!:()=>void;
  const write=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;})).mockResolvedValue({ok:true});
  vi.stubGlobal('window',{atlasApi:{saveDirtyWorld:write}});
  const first=flushDirtyWorld();
  worldStore.getState().execute('entity.add',{mapId:'m',entity:{id:'e',type:'label',text:'New',x:1,y:1,size:12,layerId:'layer-base',origin:'manual',rev:0}});
  finish();await first;
  expect(worldStore.getState().dirtyMapIds.m).toBe(true);
  await flushDirtyWorld();expect(worldStore.getState().dirtyMapIds).toEqual({});expect(write.mock.calls[1]![1].maps.m.entities.e.text).toBe('New');
});
it('a transfer flush waits for an already-running save instead of returning early',async()=>{
  load();let finish!:()=>void;
  vi.stubGlobal('window',{atlasApi:{saveDirtyWorld:()=>new Promise<void>(resolve=>{finish=resolve;})}});
  const first=flushDirtyWorld();let done=false;
  const next=flushDirtyWorld().then(()=>{done=true;});
  await Promise.resolve();expect(done).toBe(false);
  finish();await first;await next;expect(done).toBe(true);
});
