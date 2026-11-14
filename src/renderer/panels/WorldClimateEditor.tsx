import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { ClimateSchema, BiomeRuleSchema } from '../model/schema';
import { worldStore } from '../model/store';

export function WorldClimateEditor() {
  const saved = useStore(worldStore, s => s.world?.meta.climate);
  const worldId = useStore(worldStore, s => s.world?.meta.id);
  const [climate, setClimate] = useState(() => ClimateSchema.parse(saved ?? {}));
  const [error, setError] = useState('');
  useEffect(() => { setClimate(ClimateSchema.parse(saved ?? {})); setError(''); }, [saved, worldId]);
  const updateRule = (index: number, patch: Record<string, unknown>) => setClimate({ ...climate,
    biomes: climate.biomes.map((rule, i) => i === index ? { ...rule, ...patch } : rule) });
  return <details><summary>World climate and biome table</summary>
    <p>Apply settings, then reroll to repaint generated biomes. Rules match from top to bottom; the last rule is the fallback. Temperature and moisture range from 0 to 1.</p>
    {(['temperature', 'moisture', 'northLatitude', 'southLatitude'] as const).map(key => {
      const latitude = key.includes('Latitude');
      const label = { temperature: 'Temperature bias', moisture: 'Moisture bias', northLatitude: 'North latitude', southLatitude: 'South latitude' }[key];
      return <label key={key} style={{ display: 'block' }}>{label} <input aria-label={label} type="number" min={latitude ? -90 : -.8} max={latitude ? 90 : .8} step={latitude ? 5 : .1} value={climate[key]}
        onChange={e => setClimate({ ...climate, [key]: Number(e.target.value) })} /></label>;
    })}
    {climate.biomes.map((rule, i) => <div key={i} style={{ borderTop: '1px solid var(--border)', padding: '4px 0' }}>
      <label>Name <input aria-label={`Biome ${i + 1} name`} value={rule.name} onChange={e => updateRule(i, { name: e.target.value })} /></label>
      {(['temperatureMin', 'temperatureMax', 'moistureMin', 'moistureMax', 'color'] as const).map(key => <label key={key} style={{ display: 'block' }}>{key} <input aria-label={`Biome ${i + 1} ${key}`}
        type={key === 'color' ? 'color' : 'number'} min={0} max={1} step={.05} value={rule[key]}
        onChange={e => updateRule(i, { [key]: key === 'color' ? e.target.value : Number(e.target.value) })} /></label>)}
      <button disabled={climate.biomes.length <= 1} onClick={() => setClimate({ ...climate, biomes: climate.biomes.filter((_, j) => j !== i) })}>Remove biome rule {i + 1}</button>
    </div>)}
    <button disabled={climate.biomes.length >= 40} onClick={() => setClimate({ ...climate,
      biomes: [BiomeRuleSchema.parse({ name: 'custom', temperatureMax: .5 }), ...climate.biomes] })}>Add custom biome rule</button>
    <button onClick={() => {
      try { worldStore.getState().execute('world.setClimate', { climate }); setError(''); }
      catch (e) { setError(String(e)); }
    }}>Apply world climate</button>
    {error && <div role="alert">{error}</div>}
  </details>;
}
