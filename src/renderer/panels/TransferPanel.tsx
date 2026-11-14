import { useState } from 'react';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { copyMapToWorld,forkOpenWorld } from '../export/transferActions';
import type { WorldDocument } from '../model/commands';

export function TransferPanel() {
  const world=useStore(worldStore,s=>s.world),mapId=useStore(worldStore,s=>s.activeMapId);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[report,setReport]=useState('');
  const [target,setTarget]=useState(''),[targetWorld,setTargetWorld]=useState<WorldDocument|null>(null);
  const [mode,setMode]=useState<'copy'|'move'>('copy');
  const [parent,setParent]=useState(''),[x,setX]=useState(0),[y,setY]=useState(0),[rotation,setRotation]=useState(0),[scale,setScale]=useState(1),[margin,setMargin]=useState(0);
  const [underneath,setUnderneath]=useState<'replace'|'merge'>('replace');
  const pick=async()=>{
    try {const dir=await window.atlasApi.pickFolder('Choose target world');if(!dir)return;const result=await window.atlasApi.readTransferWorld(dir);setTarget(dir);setTargetWorld(result.world);setParent('');setReport('');}catch(e){setReport((e as Error).message);}
  };
  const transfer=async()=>{
    if(!mapId)return;setBusy(true);setReport('');
    try {const result=await copyMapToWorld(target,{mapId,mode,placement:parent?{parentMapId:parent,x,y,rotation:rotation*Math.PI/180,scale,underneath,seamMargin:margin}:undefined});setReport(`Map tree ${mode==='move'?'moved':'copied'} to ${targetWorld?.meta.name}. Map: ${result.mapId}`);}catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  const fork=async()=>{
    try {const dir=await window.atlasApi.pickFolder('Choose an empty folder for the world fork');if(!dir)return;setBusy(true);const result=await forkOpenWorld(dir,`${world?.meta.name} Fork`);setReport(`Fork saved to ${result.worldDir}`);}catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  return <div style={{padding:'4px 10px',fontSize:12}}>
    <button disabled={!world} onClick={()=>setOpen(!open)}>World transfers</button>
    {open&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <button disabled={busy} onClick={()=>void fork()}>Fork world</button>
      <select aria-label="Transfer mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="copy">Copy map tree</option><option value="move">Move map tree</option></select>
      <button disabled={busy} onClick={()=>void pick()}>Choose target world</button><span>{targetWorld?.meta.name}</span>
      <select aria-label="Target parent map" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Independent map</option>{targetWorld?.meta.maps.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {parent&&<>
        {([['X (m)',x,setX],['Y (m)',y,setY],['Rotation (degrees)',rotation,setRotation],['Scale',scale,setScale],['Seam margin (m)',margin,setMargin]] as const).map(([label,value,setter])=><label key={label}>{label}<input aria-label={label} type="number" style={{width:65}} value={value} onChange={e=>setter(Number(e.target.value))}/></label>)}
        <select aria-label="Underlying geography" value={underneath} onChange={e=>setUnderneath(e.target.value as typeof underneath)}><option value="replace">Replace underneath</option><option value="merge">Merge land</option></select>
        <span>Interior dimensions stay fixed.</span>
      </>}
      <button disabled={busy||!target||!mapId} onClick={()=>void transfer()}>Transfer map tree</button>
    </div>}
    {report&&<div role="status" aria-label="Transfer result">{report}</div>}
  </div>;
}
