import type { DistrictProfile } from '../model/schema';

export const districtPresets: Record<string, DistrictProfile> = {
  mixed: {density:.65,wealth:.5,activity:.5,access:'open'},
  market: {density:.8,wealth:.55,activity:1,access:'open'},
  workshops: {density:.75,wealth:.4,activity:.8,access:'open'},
  estates: {density:.35,wealth:.9,activity:.2,access:'restricted'},
  precinct: {density:.35,wealth:.6,activity:.3,access:'gated'},
  gardens: {density:0,wealth:.4,activity:.2,access:'open'},
};

export function DistrictControls({value,onChange,detailsOnly=false}: {value:DistrictProfile;onChange:(profile:DistrictProfile)=>void;detailsOnly?:boolean}) {
  return <>
    {!detailsOnly && <label>District preset <select aria-label="District preset" value="" onChange={e=>onChange({...districtPresets[e.target.value]!})}>
      <option value="">Choose a starting point</option>{Object.keys(districtPresets).map(p=><option key={p} value={p}>{p}</option>)}
    </select></label>}
    {(['density','wealth','activity'] as const).filter(key=>!detailsOnly||key!=='density').map(key=><label key={key}>{key[0]!.toUpperCase()+key.slice(1)} <input aria-label={`District ${key}`} type="number" min={0} max={1} step={.05} value={value[key]} onChange={e=>{
      const next=Number(e.target.value); if(Number.isFinite(next)&&next>=0&&next<=1) onChange({...value,[key]:next});
    }} /></label>)}
    <label>Access <select aria-label="District access" value={value.access} onChange={e=>onChange({...value,access:e.target.value as DistrictProfile['access']})}>
      <option value="open">Open</option><option value="restricted">Restricted · wider setbacks</option><option value="gated">Gated · reserve access space</option>
    </select></label>
  </>;
}
