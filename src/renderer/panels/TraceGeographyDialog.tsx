import { useEffect, useRef, useState } from 'react';
import type { Entity, Point } from '../model/schema';
import { traceEntities, type TraceOptions, type TraceResult } from '../import/trace';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { resolveWorldAssetUrl } from '../render/textures';
import { resolveTargetLayerId } from '../tools/types';
import { distanceToSegment } from '../geom/hitTest';

export function TraceGeographyDialog({image,onClose}:{image:Extract<Entity,{type:'image'}>;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),photo=useRef<HTMLImageElement|null>(null),job=useRef<Worker|null>(null);
  const [source,setSource]=useState<TraceOptions|null>(null),[result,setResult]=useState<TraceResult|null>(null);
  const [sensitivity,setSensitivity]=useState(70),[waterColor,setWaterColor]=useState<number[]|undefined>();
  const [mode,setMode]=useState('water'),[radius,setRadius]=useState(10),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [added,setAdded]=useState<Point[][]>([]),[draft,setDraft]=useState<Point[]>([]),[removed,setRemoved]=useState<number[]>([]);
  const [past,setPast]=useState<Uint8Array[]>([]),[future,setFuture]=useState<Uint8Array[]>([]);
  const stroke=useRef<Uint8Array|null>(null),lastPaint=useRef<Point|null>(null);
  // One reused tint buffer: making a fresh full-size canvas per brush move ran the renderer out of memory.
  const overlay=useRef<{canvas:HTMLCanvasElement;data:ImageData}|null>(null);
  const [tintOpacity,setTintOpacity]=useState(35),[zoom,setZoom]=useState(1);
  const initial=useRef({mapId:worldStore.getState().activeMapId,revision:0,worldId:worldStore.getState().world?.meta.id});
  useEffect(()=>{
    dialog.current?.showModal();
    const state=worldStore.getState(),id=initial.current.mapId,map=id?state.world?.maps[id]:undefined;
    initial.current.revision=map?.revision??0;
    const url=resolveWorldAssetUrl(state.worldPath,viewStore.getState().assetsIndex,image.assetId);
    if(!url){setError('Backdrop file is unavailable.');return;}
    const img=document.createElement('img');img.crossOrigin='anonymous';
    img.onload=()=>{
      photo.current=img;const ratio=Math.min(1,1200/img.naturalWidth,1200/img.naturalHeight),w=Math.max(2,Math.round(img.naturalWidth*ratio)),h=Math.max(2,Math.round(img.naturalHeight*ratio));
      const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(img,0,0,w,h);
      setSource({width:w,height:h,pixels:ctx.getImageData(0,0,w,h).data,sensitivity});
    };
    img.onerror=()=>setError('Could not read backdrop pixels.');img.src=url;
    return()=>{job.current?.terminate();img.onload=null;};
  },[]);
  const analyze=(mask?:Uint8Array)=>{
    if(!source)return;job.current?.terminate();setBusy(true);setError('');
    const worker=new Worker(new URL('../import/trace.worker.ts',import.meta.url),{type:'module'});job.current=worker;
    worker.onmessage=({data})=>{setBusy(false);if(data.error)setError(data.error);else setResult(data.result);worker.terminate();};
    worker.onerror=e=>{setBusy(false);setError(e.message);worker.terminate();};
    worker.postMessage({...source,sensitivity,waterColor,mask});
  };
  // Re-detecting from colour replaces the whole mask; keep the old one on the undo stack so a
  // bumped slider after careful hand-painting is one Undo correction away, not lost.
  const resultRef=useRef<TraceResult|null>(null);resultRef.current=result;
  useEffect(()=>{if(source){const prior=resultRef.current?.mask;setPast(prior?p=>[...p,prior]:[]);setFuture([]);setRemoved([]);analyze();}},[source,sensitivity,waterColor]);
  useEffect(()=>{
    const c=canvas.current;if(!c||!source||!photo.current)return;c.width=source.width;c.height=source.height;
    const ctx=c.getContext('2d')!;ctx.drawImage(photo.current,0,0,c.width,c.height);
    if(result){
      if(!overlay.current||overlay.current.canvas.width!==c.width||overlay.current.canvas.height!==c.height){const oc=document.createElement('canvas');oc.width=c.width;oc.height=c.height;overlay.current={canvas:oc,data:new ImageData(c.width,c.height)};}
      const {canvas:oc,data:tint}=overlay.current,alpha=Math.round(tintOpacity*2.55);
      for(let i=0;i<result.mask.length;i++){tint.data[i*4]=result.mask[i]?32:70;tint.data[i*4+1]=result.mask[i]?125:170;tint.data[i*4+2]=result.mask[i]?245:75;tint.data[i*4+3]=alpha;}
      oc.getContext('2d')!.putImageData(tint,0,0);ctx.drawImage(oc,0,0);
      const line=(points:Point[],color:string)=>{if(!points.length)return;ctx.beginPath();ctx.moveTo(points[0]!.x,points[0]!.y);points.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();};
      result.rivers.forEach((r,i)=>{if(!removed.includes(i))line(r.points,'#14ffff');});added.forEach(r=>line(r,'#14ffff'));line(draft,'#fbbf24');
    }
  },[source,result,added,draft,removed,tintOpacity]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const b=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-b.left)/b.width*e.currentTarget.width,y:(e.clientY-b.top)/b.height*e.currentTarget.height};};
  const paint=(p:Point)=>{
    if(!result)return;const next=new Uint8Array(stroke.current??result.mask),from=lastPaint.current??p;
    const steps=Math.max(1,Math.ceil(Math.hypot(p.x-from.x,p.y-from.y)/Math.max(1,radius/2)));
    for(let i=0;i<=steps;i++){const at={x:from.x+(p.x-from.x)*i/steps,y:from.y+(p.y-from.y)*i/steps};
      for(let y=Math.max(0,Math.floor(at.y-radius));y<Math.min(result.height,at.y+radius);y++)for(let x=Math.max(0,Math.floor(at.x-radius));x<Math.min(result.width,at.x+radius);x++)if(Math.hypot(x-at.x,y-at.y)<=radius)next[y*result.width+x]=mode==='water'?1:0;
    }
    lastPaint.current=p;
    setResult({...result,mask:next});stroke.current=next;
  };
  const undo=(redo=false)=>{
    if(!result)return;const stack=redo?future:past;if(!stack.length)return;
    const mask=stack[stack.length-1]!;
    if(redo){setFuture(stack.slice(0,-1));setPast([...past,result.mask]);}else{setPast(stack.slice(0,-1));setFuture([...future,result.mask]);}
    analyze(mask);
  };
  const finishRiver=()=>{if(draft.length>=2)setAdded([...added,draft]);setDraft([]);};
  const accept=()=>{
    if(!result)return;
    try{
      const state=worldStore.getState(),mapId=initial.current.mapId,map=mapId?state.world?.maps[mapId]:undefined;
      if(!map||state.world?.meta.id!==initial.current.worldId)throw new Error('The source world is no longer open.');
      const layerId=resolveTargetLayerId(map,viewStore.getState().activeLayerId);if(!layerId)throw new Error('Unlock a layer for the traced geography.');
      const reviewed={...result,rivers:[...result.rivers.filter((_,i)=>!removed.includes(i)),...added.map(points=>({points,width:2}))]};
      state.execute('map.applyTrace',{mapId,sourceImageId:image.id,sourceRevision:initial.current.revision,layerId,entities:traceEntities(reviewed,image,layerId)});onClose();
    }catch(e){setError(String(e));}
  };
  return <dialog ref={dialog} className="svg-import-dialog" style={{width:'min(1100px,94vw)',maxHeight:'94vh',overflow:'auto',background:'var(--atlas-bg)',color:'var(--atlas-text)'}} onCancel={onClose}
    onKeyDown={e=>{e.stopPropagation();if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();undo(e.key.toLowerCase()==='y'||e.shiftKey);}else if(e.key==='Enter'&&mode==='river'){e.preventDefault();finishRiver();}}}>
    <h2>Trace Geography</h2>
    <p>Review land (green), water (blue), and river paths (cyan). Labels and artwork can confuse detection. Sample water or paint corrections before accepting. River widths are estimates.</p>
    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
      <label>Tool <select aria-label="Trace correction tool" value={mode} onChange={e=>setMode(e.target.value)}><option value="water">Paint water</option><option value="land">Paint land</option><option value="sample">Sample water colour</option><option value="river">Add river points</option><option value="remove">Remove river</option></select></label>
      <label>Sensitivity <input aria-label="Trace sensitivity" type="range" min="15" max="180" value={sensitivity} onChange={e=>setSensitivity(Number(e.target.value))}/></label>
      <label>Brush size <input aria-label="Trace brush size" type="number" min="1" max="100" value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label>
      <button disabled={!past.length||busy} onClick={()=>undo()}>Undo correction</button><button disabled={!future.length||busy} onClick={()=>undo(true)}>Redo correction</button>
      <button disabled={draft.length<2} onClick={finishRiver}>Finish river</button>
      <label>Tint <input aria-label="Trace tint opacity" type="range" min="0" max="80" value={tintOpacity} onChange={e=>setTintOpacity(Number(e.target.value))}/></label>
      <label>Zoom <select aria-label="Trace preview zoom" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={1}>Fit</option><option value={2}>2×</option><option value={3}>3×</option><option value={4}>4×</option></select></label>
    </div>
    <div style={{maxHeight:'65vh',overflow:'auto',margin:'10px 0'}}>
    <canvas ref={canvas} data-testid="trace-preview" style={zoom===1?{display:'block',maxWidth:'100%',maxHeight:'65vh',margin:'0 auto',touchAction:'none',cursor:'crosshair'}:{display:'block',height:`${65*zoom}vh`,width:'auto',margin:'0 auto',touchAction:'none',cursor:'crosshair'}}
      onPointerDown={e=>{if(!result||busy)return;const p=point(e);if(mode==='sample'&&source){const i=(Math.min(source.height-1,Math.max(0,Math.floor(p.y)))*source.width+Math.min(source.width-1,Math.max(0,Math.floor(p.x))))*4;setWaterColor(Array.from(source.pixels.slice(i,i+3)));return;}if(mode==='river'){setDraft([...draft,p]);return;}if(mode==='remove'){let best=-1,d=15;result.rivers.forEach((r,i)=>r.points.slice(1).forEach((b,j)=>{const n=distanceToSegment(p,r.points[j]!,b);if(n<d){best=i;d=n;}}));if(best>=0)setRemoved([...removed,best]);return;}setPast([...past,result.mask]);setFuture([]);e.currentTarget.setPointerCapture(e.pointerId);paint(p);}}
      onPointerMove={e=>{if(e.buttons===1&&e.currentTarget.hasPointerCapture(e.pointerId))paint(point(e));}}
      onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){e.currentTarget.releasePointerCapture(e.pointerId);analyze(stroke.current??undefined);stroke.current=null;lastPaint.current=null;}}}/>
    </div>
    {result&&<p>{result.land.length} land regions · {result.lakes.length} lakes · {result.rivers.length-removed.length+added.length} river paths · {(result.waterFraction*100).toFixed(1)}% water</p>}
    {result?.warnings?.map(message=><p key={message} role="status">{message}</p>)}
    {busy&&<p role="status">Analyzing geography…</p>}{error&&<p role="alert">{error}</p>}
    <button data-testid="trace-accept" disabled={!result||busy||!!draft.length||!result.land.length} onClick={accept}>Accept Geography</button>{' '}
    <button onClick={onClose}>Cancel</button>
  </dialog>;
}
