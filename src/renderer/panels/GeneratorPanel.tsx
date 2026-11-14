import { useState } from 'react';
import { useStore } from 'zustand';
import type { IDockviewPanelProps } from 'dockview-react';
import { listGenerators } from '../gen/framework';
import { DungeonParamsSchema } from '../gen/dungeon/layout';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { PanelHeaderBar } from './PanelHeaderBar';

export function GeneratorPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, s => s.world);
  const mapId = useStore(worldStore, s => s.activeMapId);
  const selectedIds = useStore(viewStore, s => s.selectedEntityIds);
  const layerId = useStore(viewStore, s => s.activeLayerId);
  const definitions = listGenerators();
  const [type, setType] = useState(definitions[0]?.type ?? '');
  const [seed, setSeed] = useState(1);
  const [params, setParams] = useState(DungeonParamsSchema.parse({}));
  const [runId, setRunId] = useState('');
  const [error, setError] = useState('');
  const map = mapId ? world?.maps[mapId] : undefined;
  const record = map?.generators[runId];
  const regionId = selectedIds.find(id => map?.entities[id]?.type === 'area');
  const call = (name: string, input: Record<string, unknown>) => {
    try {
      const result = worldStore.getState().execute(name, { mapId, ...input }) as { genId: string };
      setRunId(result.genId); setError('');
    } catch (e) { setError(String(e)); }
  };
  const reroll = (dressingOnly: boolean) => {
    const nextSeed = (seed + 1) >>> 0; setSeed(nextSeed);
    try { call('generator.reroll', { genId: runId, seed: nextSeed, params, dressingOnly }); }
    catch (e) { setError(String(e)); }
  };
  return <div data-testid={`panel-${props.api.id}`} style={{ height: '100%', overflow: 'auto', fontSize: 12 }}>
    <PanelHeaderBar title="Generator" panelProps={props} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
      <p>Select a footprint area on a site or interior map. Edits survive rerolls.</p>
      <label>Generator <select aria-label="Generator type" value={type} onChange={e => setType(e.target.value)}>
        {definitions.map(g => <option key={g.type} value={g.type}>{g.title}</option>)}
      </select></label>
      <label>Seed <input aria-label="Generator seed" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
      <label>Layout <select aria-label="Layout mode" value={params.mode} onChange={e=>setParams({...params,mode:e.target.value as typeof params.mode})}>
        <option value="building">Building rooms</option><option value="dungeon">Dungeon and corridors</option><option value="chamber">Chamber and alcoves</option>
      </select></label>
      <label>Rooms <input aria-label="Room count" type="number" min={1} max={20} value={params.rooms} onChange={e=>setParams({...params,rooms:Number(e.target.value)})} /></label>
      <label><input type="checkbox" checked={params.mirror} onChange={e=>setParams({...params,mirror:e.target.checked})} />Mirror left/right</label>
      <button disabled={!map || !regionId || !type} onClick={() => {
        try { call('generator.run', { type, seed, params, regionEntityId: regionId, layerId: layerId ?? map?.layers[0]?.id }); }
        catch (e) { setError(String(e)); }
      }}>Generate</button>
      <label>Existing run <select aria-label="Generator run" value={record ? runId : ''} onChange={e => {
        setRunId(e.target.value); const r = map?.generators[e.target.value];
        if (r) { setType(r.type); setSeed(r.seed); setParams(DungeonParamsSchema.parse(r.params)); }
      }}><option value="">Choose a run</option>{Object.entries(map?.generators ?? {}).map(([id, r]) => <option key={id} value={id}>{r.type} · {r.seed}</option>)}</select></label>
      <button disabled={!record} onClick={() => reroll(false)}>Reroll</button>
      <button disabled={!record} onClick={() => reroll(true)}>Reroll dressing only</button>
      <button disabled={!record} onClick={() => call('generator.accept', { genId: runId })}>Accept</button>
      <span>Accept keeps the result as manual content.</span>
      {error && <div role="alert">{error}</div>}
    </div>
  </div>;
}
