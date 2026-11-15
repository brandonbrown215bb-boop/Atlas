import { worldStore } from '../model/store';
import type { WorldDocument } from '../model/commands';
export async function prepareGeneration(commands: Array<{ name: string; input: unknown }>, signal?:AbortSignal) {
  const source = worldStore.getState().world;
  if(!source)throw new Error('Open a world first.');
  const worker = new Worker(new URL('../gen/generation.worker.ts', import.meta.url), { type: 'module' });
  let onAbort: (() => void) | undefined;
  try {
    const result = await new Promise<{world:WorldDocument;results:unknown[]}>((resolve,reject)=>{
      if(signal?.aborted){reject(new Error('Generation cancelled.'));return;}
      onAbort=()=>{worker.terminate();reject(new Error('Generation cancelled.'));};
      signal?.addEventListener('abort',onAbort,{once:true});
      worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = event => reject(new Error(event.message || 'Generation failed.'));
      worker.postMessage({ world: structuredClone(source), commands });
    });
    return { source, after: result.world, results: result.results };
  } finally { if(onAbort)signal?.removeEventListener('abort',onAbort);worker.terminate(); }
}
export function applyGenerationPreview(preview:Awaited<ReturnType<typeof prepareGeneration>>) {
  worldStore.getState().execute('world.applyGenerated',{source:preview.source,after:preview.after});
  return preview.results;
}
export async function executeGeneration(commands:Array<{name:string;input:unknown}>, signal?:AbortSignal) {
  const preview=await prepareGeneration(commands,signal);
  if(signal?.aborted)throw new Error('Generation cancelled.');
  return applyGenerationPreview(preview);
}
