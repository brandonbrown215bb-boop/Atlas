import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { resolveWorldAssetUrl } from './textures';
import { traceEntities, type TraceResult } from '../import/trace';
import { resolveTargetLayerId } from '../tools/types';

/** Read-only MCP/UI adapter: analysis never commits geography. */
export async function prepareBackdropTrace(input:{mapId:string;imageEntityId:string;sensitivity?:number;waterColor?:number[]}) {
  const source=worldStore.getState(),map=source.world?.maps[input.mapId],image=map?.entities[input.imageEntityId];
  if(!map||image?.type!=='image')throw new Error('Select a backdrop image.');
  const layerId=resolveTargetLayerId(map,viewStore.getState().activeLayerId);if(!layerId)throw new Error('Unlock a layer for the reviewed trace.');
  const url=resolveWorldAssetUrl(source.worldPath,viewStore.getState().assetsIndex,image.assetId);if(!url)throw new Error('Backdrop asset is unavailable.');
  const img=document.createElement('img');img.crossOrigin='anonymous';
  await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Could not read backdrop pixels.'));img.src=url;});
  const ratio=Math.min(1,1200/img.naturalWidth,1200/img.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(2,Math.round(img.naturalHeight*ratio));
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const worker=new Worker(new URL('../import/trace.worker.ts',import.meta.url),{type:'module'});
  try{
    const result=await new Promise<TraceResult>((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);worker.onerror=e=>reject(new Error(e.message));worker.postMessage({width:canvas.width,height:canvas.height,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data,sensitivity:input.sensitivity??70,waterColor:input.waterColor});});
    return {mapId:map.id,sourceImageId:image.id,sourceRevision:map.revision,layerId,entities:traceEntities(result,image,layerId),summary:{land:result.land.length,lakes:result.lakes.length,rivers:result.rivers.length,waterFraction:result.waterFraction}};
  }finally{worker.terminate();}
}
