import { useState } from 'react';
import { useStore } from 'zustand';
import type { IDockviewPanelProps } from 'dockview-react';
import { listGenerators } from '../gen/framework';
import { DungeonParamsSchema, type DungeonParams } from '../gen/dungeon/layout';
import { ROOM_PURPOSES } from '../gen/dungeon/dressing';
import { previewInterior } from '../gen/dungeon/interior';
import type { MapDoc, Theme } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { PanelHeaderBar } from './PanelHeaderBar';
import { InteriorPreview } from './InteriorPreview';

type Preview = { map: MapDoc; source: MapDoc; buildingId: string; worldId: string; theme: Theme | undefined;
  themeName: string; seed: number; params: DungeonParams; placeId?: string };

export function GeneratorPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, s => s.world);
  const mapId = useStore(worldStore, s => s.activeMapId);
  const selectedIds = useStore(viewStore, s => s.selectedEntityIds);
  const layerId = useStore(viewStore, s => s.activeLayerId);
  const definitions = listGenerators();
  const [type, setType] = useState(definitions[0]?.type ?? '');
  const [seed, setSeed] = useState(1);
  const [params, setParams] = useState(DungeonParamsSchema.parse({}));
  const [themeName, setThemeName] = useState('default');
  const [runId, setRunId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const map = mapId ? world?.maps[mapId] : undefined;
  const record = map?.generators[runId];
  const regionId = selectedIds.find(id => map?.entities[id]?.type === 'area');
  const selectedArea = regionId ? map?.entities[regionId] : undefined;
  const isBuilding = map?.kind === 'settlement' && selectedArea?.type === 'area' && selectedArea.role === 'building';
  const linkedPlaces = isBuilding ? Object.values(map.entities).filter(e => e.type === 'place' && e.entityIds.includes(selectedArea.id)) : [];
  const place = linkedPlaces.find(e => e.id === placeId) ?? (linkedPlaces.length === 1 ? linkedPlaces[0] : undefined);
  const existingInterior = place?.type === 'place' ? place.childMapId : undefined;
  const validPreview = preview && preview.source === map && preview.buildingId === regionId && preview.worldId === world?.meta.id
    && preview.theme === world.meta.themes[themeName] && preview.themeName === themeName && preview.seed === seed
    && preview.placeId === place?.id && JSON.stringify(preview.params) === JSON.stringify(params);
  const call = (name: string, input: Record<string, unknown>) => {
    try {
      const result = worldStore.getState().execute(name, { mapId, ...input }) as { genId?: string };
      if (result.genId) setRunId(result.genId);
      setError('');
    } catch (e) { setError(String(e)); }
  };
  const reroll = (dressingOnly: boolean) => {
    const nextSeed = (seed + 1) >>> 0;
    setSeed(nextSeed);
    call('generator.reroll', { genId: runId, seed: nextSeed, params, themeName, dressingOnly });
  };
  const makePreview = (nextSeed: number) => {
    if (!map || !world || !regionId) return;
    try {
      if (linkedPlaces.length > 1 && !place) throw new Error('Choose which place owns this interior.');
      const result = previewInterior(map, { buildingId: regionId, childMapId: 'interior-preview', seed: nextSeed, params,
        name: `${place?.name ?? selectedArea?.name ?? 'Building'} Interior`, theme: world.meta.themes[themeName] ?? {}, themeName });
      setSeed(nextSeed);
      setPreview({ map: result, source: map, buildingId: regionId, worldId: world.meta.id,
        theme: world.meta.themes[themeName], themeName, seed: nextSeed, params, placeId: place?.id });
      setError('');
    } catch (e) { setError(String(e)); }
  };
  const openMap = (id: string) => {
    const view = viewStore.getState(), panelId = view.activeMapPanelId ?? 'map-main';
    view.setPanelMap(panelId, id);
    view.setSelection([]);
    worldStore.getState().setActiveMap(id);
    props.containerApi.getPanel(panelId)?.api.setActive();
  };
  const acceptInterior = () => {
    if (!preview || !validPreview) return;
    try {
      const result = worldStore.getState().execute('map.generateInterior', {
        parentMapId: preview.source.id, buildingId: preview.buildingId, seed: preview.seed, params: preview.params,
        themeName: preview.themeName, placeId: preview.placeId, name: preview.map.name, expectedParentRevision: preview.source.revision,
      }) as { id: string; genId: string };
      setPreview(null); setRunId(result.genId); setError(''); openMap(result.id);
    } catch (e) { setError(String(e)); }
  };
  return <div data-testid={`panel-${props.api.id}`} style={{ height: '100%', overflow: 'auto', fontSize: 12 }}>
    <PanelHeaderBar title="Generator" panelProps={props} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
      <p>Select a footprint on a site/interior, or a building on a settlement to preview its interior. Edits survive rerolls.</p>
      <label>Generator <select aria-label="Generator type" value={type} onChange={e => setType(e.target.value)}>
        {definitions.map(g => <option key={g.type} value={g.type}>{g.title}</option>)}
      </select></label>
      <label>Theme <select aria-label="Generator theme" value={themeName} onChange={e => setThemeName(e.target.value)}>
        {[...new Set(['default', ...Object.keys(world?.meta.themes ?? {})])].map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>Seed <input aria-label="Generator seed" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
      <label>Layout <select aria-label="Layout mode" value={params.mode} onChange={e => setParams({ ...params, mode: e.target.value as typeof params.mode })}>
        <option value="building">Building rooms</option><option value="dungeon">Dungeon and corridors</option><option value="chamber">Chamber and alcoves</option>
      </select></label>
      <label>Rooms <input aria-label="Room count" type="number" min={1} max={20} value={params.rooms} onChange={e => setParams({ ...params, rooms: Number(e.target.value) })} /></label>
      <label><input type="checkbox" checked={params.mirror} onChange={e => setParams({ ...params, mirror: e.target.checked })} />Mirror left/right</label>
      <label>Purpose <select aria-label="Room purpose" value={params.purpose} onChange={e => setParams({ ...params, purpose: e.target.value as typeof params.purpose })}>
        {ROOM_PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
      </select></label>
      <label>Dressing density <input aria-label="Dressing density" type="number" min={0} max={3} step={0.25} value={params.density} onChange={e => setParams({ ...params, density: Number(e.target.value) })} /></label>
      {isBuilding ? <>
        {linkedPlaces.length > 1 && <label>Place <select aria-label="Interior place" value={place?.id ?? ''} onChange={e => setPlaceId(e.target.value)}>
          <option value="">Choose a place</option>{linkedPlaces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>}
        {existingInterior ? <button onClick={() => openMap(existingInterior)}>Open existing interior</button> : <>
          <button onClick={() => makePreview(seed)}>Preview interior</button>
          {preview && <>
            <InteriorPreview map={preview.map} />
            <button onClick={() => makePreview((seed + 1) >>> 0)}>Reroll preview</button>
            <button disabled={!validPreview} onClick={acceptInterior}>Accept interior</button>
            <button onClick={() => setPreview(null)}>Cancel preview</button>
            {!validPreview && <span>The source or settings changed. Preview again before accepting.</span>}
          </>}
        </>}
      </> : <>
        {selectedArea?.type === 'area' && selectedArea.role === 'floor' && selectedArea.name && <label>{selectedArea.name} purpose <select aria-label="Selected room purpose"
          value={params.roomPurposes[selectedArea.name] ?? params.purpose} onChange={e => setParams({ ...params, roomPurposes: { ...params.roomPurposes, [selectedArea.name!]: e.target.value as typeof params.purpose } })}>
          {ROOM_PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
        </select></label>}
        <button disabled={!map || !regionId || !type || !['site','interior'].includes(map.kind)} onClick={() =>
          call('generator.run', { type, seed, params, themeName, regionEntityId: regionId, layerId: layerId ?? map?.layers[0]?.id })}>Generate</button>
        <label>Existing run <select aria-label="Generator run" value={record ? runId : ''} onChange={e => {
          setRunId(e.target.value); const r = map?.generators[e.target.value];
          if (r) { setType(r.type); setSeed(r.seed); setParams(DungeonParamsSchema.parse(r.params)); setThemeName(r.themeName ?? 'default'); }
        }}><option value="">Choose a run</option>{Object.entries(map?.generators ?? {}).map(([id, r]) => <option key={id} value={id}>{r.type} · {r.seed}</option>)}</select></label>
        <button disabled={!record} onClick={() => reroll(false)}>Reroll</button>
        <button disabled={!record} onClick={() => reroll(true)}>Reroll dressing only</button>
        <span>Selected area dressing</span>
        <button disabled={!record || !regionId} onClick={() => call('generator.dressArea', { genId: runId, areaEntityId: regionId, action: 'thin', params, themeName })}>Thin out</button>
        <button disabled={!record || !regionId} onClick={() => call('generator.dressArea', { genId: runId, areaEntityId: regionId, action: 'more', seed: seed + 1, params, themeName })}>Add more</button>
        <button disabled={!record || !regionId} onClick={() => call('generator.dressArea', { genId: runId, areaEntityId: regionId, action: 'reroll', seed: seed + 1, params, themeName })}>Reroll area dressing</button>
        <button disabled={!record} onClick={() => call('generator.accept', { genId: runId })}>Accept</button>
        <span>Accept keeps the result as manual content.</span>
      </>}
      {error && <div role="alert">{error}</div>}
    </div>
  </div>;
}
