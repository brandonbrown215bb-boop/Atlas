import type { Entity } from '../model/schema';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { copyMapToWorld,forkOpenWorld,previewLinkedSync,syncLinkedMap } from '../export/transferActions';
import type { WorldDocument } from '../model/commands';

function describe(entity:Entity|null) {
  if(!entity)return 'Deleted';
  if(entity.type==='label')return `Label: ${entity.text}`;
  if(entity.type==='place')return `${entity.name}: ${entity.notes} | GM: ${entity.gmNotes}`;
  if(entity.type==='door')return `${entity.kind}, ${entity.open?'open':'closed'} (${entity.a.x}, ${entity.a.y}) to (${entity.b.x}, ${entity.b.y})`;
  if('x' in entity)return `${entity.name??entity.type} at (${entity.x}, ${entity.y})`;
  if(entity.type==='area')return `${entity.name??entity.role}: ${entity.rings.flat().length} vertices`;
  return `${entity.name??entity.type}: ${entity.points.length} points`;
}
export function TransferPanel() {
  const world=useStore(worldStore,s=>s.world),mapId=useStore(worldStore,s=>s.activeMapId);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[report,setReport]=useState('');
  const [target,setTarget]=useState(''),[targetWorld,setTargetWorld]=useState<WorldDocument|null>(null);
  const [mode,setMode]=useState<'copy'|'move'|'linked'>('copy');
  const [parent,setParent]=useState(''),[x,setX]=useState(0),[y,setY]=useState(0),[rotation,setRotation]=useState(0),[scale,setScale]=useState(1),[margin,setMargin]=useState(0);
  const [preview,setPreview]=useState<Awaited<ReturnType<typeof previewLinkedSync>>|null>(null);
  const [choices,setChoices]=useState<Record<string,'mine'|'theirs'>>({});
  useEffect(()=>{setPreview(null);setChoices({});},[mapId,world?.meta.id]);
  const [underneath,setUnderneath]=useState<'replace'|'merge'>('replace');
  const pick=async()=>{
    try {const dir=await window.atlasApi.pickFolder('Choose target world');if(!dir)return;const result=await window.atlasApi.readTransferWorld(dir);setTarget(dir);setTargetWorld(result.world);setParent('');setReport('');}catch(e){setReport((e as Error).message);}
  };
  const transfer=async()=>{
    if(!mapId)return;setBusy(true);setReport('');
    try {const result=await copyMapToWorld(target,{mapId,mode,placement:parent?{parentMapId:parent,x,y,rotation:rotation*Math.PI/180,scale,underneath,seamMargin:margin}:undefined});setReport(`Map tree ${mode==='move'?'moved':mode==='linked'?'linked':'copied'} to ${targetWorld?.meta.name}. Map: ${result.mapId}`);}catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  const fork=async()=>{
    try {const dir=await window.atlasApi.pickFolder('Choose an empty folder for the world fork');if(!dir)return;setBusy(true);const result=await forkOpenWorld(dir,`${world?.meta.name} Fork`);setReport(`Fork saved to ${result.worldDir}`);}catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  const previewSync=async()=>{
    if(!mapId)return;setBusy(true);setReport('');
    try {
      const link=world?.maps[mapId]?.link;if(!link)throw new Error('This map is not linked.');
      const path=await window.atlasApi.linkedWorldPath(link.worldId)??await window.atlasApi.pickFolder('Locate the linked world on this computer');
      if(!path)return;
      setPreview(await previewLinkedSync(mapId,path));setChoices({});
    }catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  const applySync=async()=>{
    if(!preview)return;setBusy(true);setReport('');
    try {await syncLinkedMap(preview.mapId,preview.path,choices,preview);setReport('Linked map synced. One undo restores the previous version.');setPreview(null);}catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  return <div style={{padding:'4px 10px',fontSize:12}}>
    <button disabled={!world} onClick={()=>setOpen(!open)}>World transfers</button>
    {open&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <button disabled={busy} onClick={()=>void fork()}>Fork world</button>
      <select aria-label="Transfer mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="copy">Copy map tree</option><option value="move">Move map tree</option><option value="linked">Linked copy</option></select>
      <button disabled={busy} onClick={()=>void pick()}>Choose target world</button><span>{targetWorld?.meta.name}</span>
      <select aria-label="Target parent map" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Independent map</option>{targetWorld?.meta.maps.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {parent&&<>
        {([['X (m)',x,setX],['Y (m)',y,setY],['Rotation (degrees)',rotation,setRotation],['Scale',scale,setScale],['Seam margin (m)',margin,setMargin]] as const).map(([label,value,setter])=><label key={label}>{label}<input aria-label={label} type="number" style={{width:65}} value={value} onChange={e=>setter(Number(e.target.value))}/></label>)}
        <select aria-label="Underlying geography" value={underneath} onChange={e=>setUnderneath(e.target.value as typeof underneath)}><option value="replace">Replace underneath</option><option value="merge">Merge land</option></select>
        <span>Interior dimensions stay fixed.</span>
      </>}
      <button disabled={busy||!target||!mapId} onClick={()=>void transfer()}>Transfer map tree</button>
    </div>}
    {open&&world?.maps[mapId??'']?.link&&<div>
      <button disabled={busy} onClick={()=>void previewSync()}>Preview linked sync</button>
      {preview&&<div>
        <p>{preview.taken.length} incoming entity changes; {preview.conflicts.length} conflicts. Mine is kept unless you choose theirs.</p>
        {preview.conflicts.map(c=><label key={c.id} style={{display:'block'}}>{c.name}: {c.reason} ({describe(c.mine)} / {describe(c.theirs)}) <select aria-label={`Resolve ${c.id}`} value={choices[c.id]??'mine'} onChange={e=>setChoices({...choices,[c.id]:e.target.value as 'mine'|'theirs'})}><option value="mine">Mine</option><option value="theirs">Theirs</option></select></label>)}
        <button disabled={busy} onClick={()=>void applySync()}>Apply linked sync</button>
      </div>}
    </div>}
    {report&&<div role="status" aria-label="Transfer result">{report}</div>}
  </div>;
}
