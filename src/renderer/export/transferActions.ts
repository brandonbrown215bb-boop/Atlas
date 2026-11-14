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
