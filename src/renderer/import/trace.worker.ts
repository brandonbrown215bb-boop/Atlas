import { traceGeography, type TraceOptions } from './trace';
const scope=globalThis as unknown as {onmessage:(event:{data:TraceOptions})=>void;postMessage:(message:unknown)=>void};
scope.onmessage=({data})=>{try{scope.postMessage({result:traceGeography(data)});}catch(error){scope.postMessage({error:error instanceof Error?error.message:String(error)});}};
