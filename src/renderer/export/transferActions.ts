import { planSync, type SyncChoices } from '../model/sync';
import { viewStore } from '../model/viewStore';
import { worldStore } from '../model/store';
import { flushDirtyWorld } from '../model/persistence';
import type { TransferInput } from '../model/transfer';

export async function copyMapToWorld(targetDir:string,input:TransferInput) {
  if(worldStore.getState().operationInProgress) throw new Error('A world transfer is already running.');
  worldStore.setState({operationInProgress:true});
  try {
  await flushDirtyWorld();
  const state=worldStore.getState();
  if(!state.world || !state.worldPath)throw new Error('No world is open');
  const before=state.world;
  const result=await window.atlasApi.transferMap(targetDir,input,before);
  if(JSON.stringify(result.before)!==JSON.stringify(result.after)) {
    worldStore.getState().execute('world.applyTransfer',{before:result.before,after:result.after});
    const active=worldStore.getState().activeMapId;
    if(active&&!result.after.maps[active])worldStore.getState().setActiveMap(result.after.meta.maps[0]?.id??null);
    await flushDirtyWorld();
  }
  return result;
  } finally {worldStore.setState({operationInProgress:false});}
}
export async function forkOpenWorld(targetDir:string,name:string) {
  await flushDirtyWorld();
  return window.atlasApi.forkWorld(targetDir,name);
}

export async function previewLinkedSync(mapId:string,path?:string) {
  const state=worldStore.getState(),mine=state.world?.maps[mapId];
  if(!mine?.link)throw new Error('This map is not linked.');
  const otherPath=path??await window.atlasApi.linkedWorldPath(mine.link.worldId);
  if(!otherPath)throw new Error('Choose the linked world folder on this computer.');
  const {world}=await window.atlasApi.readTransferWorld(otherPath);
  if(world.meta.id!==mine.link.worldId)throw new Error('That is not the linked world.');
  const theirs=world.maps[mine.link.mapId];
  if(!theirs || theirs.link?.worldId!==state.world!.meta.id || theirs.link.mapId!==mapId)throw new Error('The reciprocal linked map is missing.');
  return {...planSync(mine,theirs),path:otherPath,mapId,mine:JSON.stringify(mine),theirs:JSON.stringify(theirs)};
}
export async function syncLinkedMap(mapId:string,path:string,choices:SyncChoices={},expected?:{mine:string;theirs:string}) {
  if(worldStore.getState().operationInProgress)throw new Error('A world operation is already running.');
  worldStore.setState({operationInProgress:true});
  try {
    await flushDirtyWorld();
    const preview=await previewLinkedSync(mapId,path);
    if(expected && (preview.mine!==expected.mine || preview.theirs!==expected.theirs))throw new Error('A map changed since the sync preview. Preview again.');
    const remote=await window.atlasApi.prepareLinkedSync(mapId,path,preview.mine,preview.theirs);
    viewStore.getState().setAssetsIndex(remote.assets);
    const result=worldStore.getState().execute('map.syncLinked',{mapId,otherWorldId:remote.otherWorldId,otherMap:remote.otherMap,choices});
    await flushDirtyWorld();
    return result;
  } finally {worldStore.setState({operationInProgress:false});}
}
