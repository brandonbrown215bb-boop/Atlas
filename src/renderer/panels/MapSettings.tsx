import { useState } from 'react';
import type { MapDoc } from '../model/schema';
import { worldStore } from '../model/store';
import { FOOT, MILE, extentLabel } from '../model/mapDefaults';
import { viewStore } from '../model/viewStore';

export function MapSettings({ map }: { map: MapDoc }) {
  const unit = ['world', 'region', 'settlement'].includes(map.kind) ? MILE : FOOT;
  const [width, setWidth] = useState(String(Number((map.bounds.w / unit).toFixed(4))));
  const [height, setHeight] = useState(String(Number((map.bounds.h / unit).toFixed(4))));
  const [error, setError] = useState('');
  const execute = (name: string, input: Record<string, unknown>) => {
    try { worldStore.getState().execute(name, { mapId: map.id, ...input }); setError(''); }
    catch (e) { setError(String(e)); }
  };
  return <div className="generation-settings" data-testid="map-settings"><strong>{map.name} · Map settings</strong>
    <span>{extentLabel(map.bounds)}</span>
    {!map.parent && <><label>Width ({unit === MILE ? 'mi' : 'ft'}) <input aria-label="Map width" type="number" min="0.001" value={width} onChange={e => setWidth(e.target.value)} /></label>
      <label>Height ({unit === MILE ? 'mi' : 'ft'}) <input aria-label="Map height" type="number" min="0.001" value={height} onChange={e => setHeight(e.target.value)} /></label>
      <button onClick={() => execute('map.setExtent', { bounds: { ...map.bounds, w: Number(width) * unit, h: Number(height) * unit } })}>Apply size</button></>}
    {['world', 'region'].includes(map.kind) && <><label><input type="checkbox" checked={map.outsideLandIsWater ?? true} onChange={e => execute('map.setGeographyOptions', { outsideLandIsWater: e.target.checked })} />Outside land is water</label>
      <label>River display <select value={map.riverWidthMode ?? 'cartographic'} onChange={e => execute('map.setGeographyOptions', { riverWidthMode: e.target.value })}><option value="cartographic">Cartographic widths</option><option value="physical">Physical widths</option></select></label></>}
    <details><summary>Map repair</summary>{Object.entries(map.generators).map(([id, r]) => <div key={id}>{map.groups?.[r.groupId ?? id]?.name ?? r.type}: {r.boundary || map.entities[r.regionEntityId]?.type === 'area' ? 'Boundary available' : <>
      Missing boundary <button disabled={!viewStore.getState().selectedEntityIds.some(key => map.entities[key]?.type === 'area')} onClick={() => execute('map.repair', { reassign: { [id]: viewStore.getState().selectedEntityIds.find(key => map.entities[key]?.type === 'area') } })}>Use selected area</button>
    </>}</div>)}</details>
    {error && <div role="alert">{error}</div>}
  </div>;
}
