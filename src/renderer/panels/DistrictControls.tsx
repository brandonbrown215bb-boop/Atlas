import type { DistrictProfile } from '../model/schema';

export const districtPresets: Record<string, DistrictProfile> = {
  mixed: {density:.65,wealth:.5,activity:.5,access:'open'},
  market: {density:.8,wealth:.55,activity:1,access:'open'},
  workshops: {density:.75,wealth:.4,activity:.8,access:'open'},
  estates: {density:.35,wealth:.9,activity:.2,access:'restricted'},
  precinct: {density:.35,wealth:.6,activity:.3,access:'gated'},
  gardens: {density:0,wealth:.4,activity:.2,access:'open'},
};

export function matchingPresetName(value: DistrictProfile): string {
  for (const [name, preset] of Object.entries(districtPresets)) {
    if (
      Math.abs(value.density - preset.density) < 0.001 &&
      Math.abs(value.wealth - preset.wealth) < 0.001 &&
      Math.abs(value.activity - preset.activity) < 0.001 &&
      value.access === preset.access
    ) {
      return name;
    }
  }
  return '';
}

const hints: Record<'density' | 'wealth' | 'activity', string> = {
  density: 'How tightly packed buildings are (0 = open green, 1 = crowded).',
  wealth: 'Larger lots, richer roofs, and more stonework.',
  activity: 'More shops, taverns, and street-facing fronts.',
};

export function DistrictControls({value,onChange,detailsOnly=false}: {value:DistrictProfile;onChange:(profile:DistrictProfile)=>void;detailsOnly?:boolean}) {
  const matchedPreset = matchingPresetName(value);
  return <>
    {!detailsOnly && <label>District preset <select aria-label="District preset" value={matchedPreset} onChange={e=>{if(e.target.value)onChange({...districtPresets[e.target.value]!});}}>
      <option value="">Custom</option>{Object.keys(districtPresets).map(p=><option key={p} value={p}>{p}</option>)}
    </select></label>}
    {(['density','wealth','activity'] as const).filter(key=>!detailsOnly||key!=='density').map(key=><label key={key} title={hints[key]}>{key[0]!.toUpperCase()+key.slice(1)} <input aria-label={`District ${key}`} type="number" min={0} max={1} step={.05} value={value[key]} onChange={e=>{
      const next=Number(e.target.value); if(Number.isFinite(next)&&next>=0&&next<=1) onChange({...value,[key]:next});
    }} /></label>)}
    <label title="Controls building setbacks and courtyard gating">Access <select aria-label="District access" value={value.access} onChange={e=>onChange({...value,access:e.target.value as DistrictProfile['access']})}>
      <option value="open">Open</option><option value="restricted">Restricted · wider setbacks</option><option value="gated">Gated · reserve access space</option>
    </select></label>
  </>;
}
