import { exportUvtt } from '../export/uvtt';
import { useState } from 'react';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { getSelectionBounds } from '../geom/hitTest';
import { exportPlayerImage } from '../export/playerImage';

export function ExportPanel() {
  const world=useStore(worldStore,s=>s.world);
  const mapId=useStore(worldStore,s=>s.activeMapId);
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [report,setReport]=useState('');
  const [pps,setPps]=useState(200);
  const [region,setRegion]=useState<'map'|'selection'|'rectangle'>('map');
  const [rect,setRect]=useState({x:0,y:0,w:30,h:30});
  const map=mapId?world?.maps[mapId]:undefined;
  const run=async (kind: 'png'|'dd2vtt') => {
    if(!map) return;
    setBusy(true);setReport('');
    try {
      let target=region==='rectangle'?rect:undefined;
      if(region==='selection') {
        const bounds=getSelectionBounds(viewStore.getState().selectedEntityIds.flatMap(id=>map.entities[id]?[map.entities[id]!]:[]));
        if(!bounds) throw new Error('Select map geometry to export its rectangle.');
        target={x:bounds.minX,y:bounds.minY,w:bounds.maxX-bounds.minX,h:bounds.maxY-bounds.minY};
      }
      const result=await exportPlayerImage(map,pps,target);
      const uvtt=kind==='dd2vtt'?exportUvtt(map,result.data,pps,target):null;
      const path=await window.atlasApi.saveExport(map.name,kind,uvtt?JSON.stringify(uvtt.document):result.data);
      setReport(path?`Saved ${result.width} x ${result.height} ${kind.toUpperCase()}. ${result.report} ${uvtt?.report ?? ''}`:'Export cancelled.');
    }catch(e){setReport((e as Error).message);}finally{setBusy(false);}
  };
  return <div style={{padding:'4px 10px',fontSize:12}}>
    <button disabled={!map} onClick={()=>setOpen(!open)}>Export</button>
    {open && <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <select aria-label="Export region" value={region} onChange={e=>setRegion(e.target.value as typeof region)}><option value="map">Whole map</option><option value="selection">Selection rectangle</option><option value="rectangle">Custom rectangle</option></select>
      {region==='rectangle' && (['x','y','w','h'] as const).map(key=><label key={key}>{key} (m) <input aria-label={`Export ${key}`} type="number" style={{width:70}} value={rect[key]} onChange={e=>setRect({...rect,[key]:Number(e.target.value)})}/></label>)}
      <label>Pixels per square <input aria-label="Export pixels per square" type="number" min="1" style={{width:70}} value={pps} onChange={e=>setPps(Number(e.target.value))}/></label>
      <button disabled={busy} onClick={()=>void run('png')}>Save player PNG</button>
      <button disabled={busy} onClick={()=>void run('dd2vtt')}>Save Universal VTT</button>
      <span>Private content is hidden. Fog is omitted. Maximum 8192 px per side.</span>
    </div>}
    {report && <div role="status" aria-label="Export result">{report}</div>}
  </div>;
}
