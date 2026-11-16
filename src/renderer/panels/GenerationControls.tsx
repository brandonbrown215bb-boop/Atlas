import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { hudStore } from '../app/hudStore';
import { resolveGenerationContext, resultContext, resultName } from '../model/generationContext';
import { defaultGenerationDraft, draftKey, generationState, generateFromContext, selectGenerationResult,
  cancelGeneration, prepareTerrainUpgrade, type GenerationDraft } from '../model/generationState';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { activateMapPanel, navigateToMap } from '../model/navigation';
import type { MapDoc } from '../model/schema';
import { ROOM_PURPOSES } from '../gen/dungeon/dressing';
import { DistrictControls, districtPresets, matchingPresetName } from './DistrictControls';
import { WorldClimateEditor } from './WorldClimateEditor';
import { SettlementSuggestions } from './SettlementSuggestions';
import { cityDiagnostics } from '../gen/city/diagnostics';
import { auditDungeonTopology } from '../gen/dungeon/audit';
import { FOOT } from '../model/mapDefaults';
import { WorldUpgradePreview } from './WorldUpgradePreview';
import { applyGenerationPreview } from '../render/generationJob';

export function useGenerationTarget(map: MapDoc, panelId: string) {
  const worldId = useStore(worldStore, s => s.world?.meta.id ?? '');
  const selected = useStore(viewStore, s => s.selectedEntityIds);
  const editParts = useStore(viewStore, s => s.editParts);
  const activePanel = useStore(viewStore, s => s.activeMapPanelId);
  const siteType = useStore(generationState, s => s.siteTypes[`${worldId}:${map.id}`]);
  const context = useMemo(() => resolveGenerationContext(map, activePanel === panelId ? selected : [], editParts, siteType),
    [map, selected, activePanel, panelId, editParts, siteType]);
  const key = draftKey(worldId, map.id, context);
  const region = map.entities[context.regionId ?? ''];
  const signature = JSON.stringify([context.record?.seed, context.record?.params, context.record?.themeName,
    context.mode, region?.type === 'area' ? region.district : undefined]);
  const initial = useMemo(() => defaultGenerationDraft(map, context), [key, signature]);
  const draft = useStore(generationState, s => s.drafts[key]) ?? initial;
  useEffect(() => {
    generationState.setState(s => s.drafts[key] && s.draftSignatures[key] === signature ? s :
      { drafts: { ...s.drafts, [key]: initial }, draftSignatures: { ...s.draftSignatures, [key]: signature } });
  }, [key, initial, signature]);
  const update = (patch: Partial<GenerationDraft>) => generationState.setState(s => ({ drafts: { ...s.drafts,
    [key]: { ...(s.drafts[key] ?? initial), ...patch } } }));
  const patchParams = (patch: Record<string, unknown>) => update({ params: { ...draft.params, ...patch } });
  return { context, draft, update, patchParams, worldId, key };
}

export function openGenerationSettings(map: MapDoc, panelId: string, key: string, mode: 'generation' | 'map' = 'generation') {
  activateMapPanel(panelId, map.id);
  generationState.setState({ settings: { worldId: worldStore.getState().world!.meta.id, mapId: map.id, panelId, key, mode } });
  hudStore.getState().openOrFocusPanel('inspector');
}

export function GenerationControls({ map, panelId, detailed = false }: {
  map: MapDoc; panelId: string; detailed?: boolean;
}) {
  const { context: c, draft: d, update, patchParams: patch, worldId } = useGenerationTarget(map, panelId);
  const [upgrade, setUpgrade] = useState<Awaited<ReturnType<typeof prepareTerrainUpgrade>>>(null);
  useEffect(() => setUpgrade(null), [c.key, map.id]);
  const world = useStore(worldStore, s => s.world);
  const job = useStore(generationState, s => s.job);
  const error = useStore(generationState, s => s.error);
  const selected = useStore(viewStore, s => s.selectedEntityIds);
  const editParts = useStore(viewStore, s => s.editParts);
  const p = d.params;
  const isResult = c.kind === 'result';
  const isRoom = c.kind === 'room';
  const places = c.kind === 'building' ? Object.values(map.entities).filter(e => e.type === 'place' && e.entityIds.includes(c.regionId!)) : [];
  const selectedPlaceId = selected.length === 1 && map.entities[selected[0]!]?.type === 'place' ? selected[0] : undefined;
  const place = places.find(e => e.id === (selectedPlaceId ?? d.placeId)) ?? (places.length === 1 ? places[0] : undefined);
  const interiorId = place?.type === 'place' ? place.childMapId : undefined;
  const activeSelection = viewStore.getState().activeMapPanelId === panelId ? selected.filter(id => map.entities[id]) : [];
  const selectedGroup = activeSelection.length > 0 && !!map.entities[activeSelection[0]!]!.groupId &&
    activeSelection.every(id => map.entities[id]?.groupId === map.entities[activeSelection[0]!]!.groupId);
  const canOutline = activeSelection.length === 1 && ['area', 'path', 'wall'].includes(map.entities[activeSelection[0]!]!.type);
  const hasBoundary = !c.genId || !!c.record?.boundary || map.entities[c.record?.regionEntityId ?? '']?.type === 'area';
  const saved = c.record;
  const changed = isResult && (JSON.stringify(p) !== JSON.stringify(defaultGenerationDraft(map, c).params) ||
    d.seed !== saved?.seed || d.themeName !== (saved?.themeName ?? 'default'));
  const activate = () => activateMapPanel(panelId, map.id);
  const run = (action: Parameters<typeof generateFromContext>[4] = 'generate') => {
    activate();
    void generateFromContext(map, c, { ...d, placeId: place?.id }, panelId, action);
  };
  const chooseResult = (id: string, settings = false) => {
    activate();
    selectGenerationResult(map, id);
    if (settings) openGenerationSettings(map, panelId, resultContext(map, id).key);
  };
  const number = (key: string, label: string, min: number, max: number, step = 1, scale = 1) => <label className="generation-field" key={key}>
    {label} <input aria-label={label} type="number" min={min} max={max} step={step} value={Number((Number(p[key]) / scale).toFixed(3))}
      onChange={e => patch({ [key]: e.target.value === '' ? '' : Number(e.target.value) * scale })} />
  </label>;
  const check = (key: string, label: string) => <label className="generation-field" key={key}>
    <input aria-label={label} type="checkbox" checked={!!p[key]} onChange={e => patch({ [key]: e.target.checked })} />{label}
  </label>;
  const purpose = (room = false) => <label className="generation-field">Purpose <select aria-label={room ? 'Selected room purpose' : 'Room purpose'}
    value={room ? p.roomPurposes?.[map.entities[c.regionId!]?.name ?? ''] ?? p.purpose : p.purpose}
    onChange={e => patch(room ? { roomPurposes: { ...p.roomPurposes, [map.entities[c.regionId!]?.name ?? '']: e.target.value } } : { purpose: e.target.value })}>
    {ROOM_PURPOSES.map(value => <option key={value}>{value}</option>)}
  </select></label>;
  const resultList = <label>Generated results <select aria-label="Generated results" value={isResult ? c.genId : ''} onChange={e => e.target.value && chooseResult(e.target.value, detailed)}>
    <option value="">Choose a result</option>{Object.keys(map.generators).map(id => <option key={id} value={id}>{resultName(map, id)} · {map.generators[id]!.seed}</option>)}
  </select></label>;
  const generatingHere = job?.mapId === map.id && job.panelId === panelId;
  const action = c.kind === 'building' ? 'Generate interior' : c.type === 'world' ? (p.mode === 'populate' ? 'Add terrain detail' : 'Generate terrain') :
    c.type === 'city' ? c.regionId ? 'Generate district' : 'Generate town' : c.type === 'glade' ? 'Generate woodland' : c.type === 'dungeon' && map.kind === 'site' ? 'Generate dungeon' : 'Generate rooms';
  return <div className={detailed ? 'generation-settings' : 'generation-strip'} data-testid={detailed ? 'generation-settings' : 'generation-strip'} aria-busy={generatingHere}
    onPointerDown={activate}>
    <strong>{c.label}</strong>
    {c.kind === 'chooseSite' && <><span>Make:</span>{(['glade', 'dungeon'] as const).map(type => <button key={type} onClick={() => generationState.setState(s => ({ siteTypes: { ...s.siteTypes, [`${worldId}:${map.id}`]: type } }))}>{type === 'glade' ? 'Woodland' : 'Dungeon'}</button>)}</>}
    {c.type && c.kind !== 'selection' && !interiorId && <>
      {isRoom ? purpose(true) : c.type === 'world' ? <>
        {p.mode !== 'populate' && <label className="generation-field">Land amount <input aria-label="Land amount" type="range" min="0.15" max="0.85" step="0.05" value={1 - p.seaLevel} onChange={e => patch({ seaLevel: Number((1 - Number(e.target.value)).toFixed(2)) })} /></label>}
        {number('ruggedness', 'Ruggedness', 0, 1, .05)}{check('rivers', 'Rivers')}
      </> : c.type === 'city' ? <>
        <label className="generation-field" title="Sets the size of the built-up core; farmland fills the rest. Auto follows the world town this map was developed from.">Scale <select aria-label="Settlement scale" value={p.scale ?? 'auto'} onChange={e => patch({ scale: e.target.value })}>
          <option value="auto">Auto (from world)</option><option value="hamlet">Hamlet</option><option value="village">Village</option><option value="town">Town</option><option value="city">City</option>
        </select></label>
        {p.scale !== 'hamlet' && <label className="generation-field" title="Auto walls towns and cities on maps above 250k m²; Walled forces walls to fit">Walls <select aria-label="City walls" value={p.walls ?? 'auto'} onChange={e => patch({ walls: e.target.value })}>
          <option value="auto">Walls: Auto</option><option value="walled">Walled</option><option value="open">Open (no walls)</option>
        </select></label>}
        <label className="generation-field">Preset <select aria-label="District preset" value={matchingPresetName({ density: p.density, wealth: p.wealth, activity: p.activity, access: p.access })} onChange={e => { if (e.target.value) patch(districtPresets[e.target.value]!); }}><option value="">Custom</option>{Object.keys(districtPresets).map(name => <option key={name}>{name}</option>)}</select></label>
        {number('density', 'District density', 0, 1, .05)}
      </> : c.type === 'glade' ? <>
        <label className="generation-field">Preset <select aria-label="Outdoor preset" value={p.preset ?? 'woodland'} onChange={e => patch({ preset: e.target.value })}><option value="woodland">Woodland glades</option><option value="roadside">Roadside hedgerows</option><option value="ruins">Overgrown ruins</option></select></label>
        {number('clearings', 'Clearing count', 1, 20)}{number('density', 'Tree density', 0, 3, .25)}
      </> : <>
        {(c.kind !== 'building' || detailed) && <label className="generation-field">Layout <select aria-label="Layout mode" value={p.mode} onChange={e => patch({ mode: e.target.value })}><option value="building">Building rooms</option><option value="dungeon">Dungeon and corridors</option><option value="chamber">Chamber and alcoves</option><option value="cave">Natural cave</option></select></label>}
        {number('rooms', 'Room count', 1, 20)}{purpose()}
      </>}
    </>}
    {places.length > 1 && <label>Place <select aria-label="Interior place" value={d.placeId ?? ''} onChange={e => update({ placeId: e.target.value })}><option value="">Choose the place</option>{places.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
    {generatingHere ? <><span role="status">Generating…</span><button onClick={cancelGeneration}>Cancel generation</button></> : c.type && c.kind !== 'selection' && <>
      {isRoom ? <details className="context-menu"><summary>Furniture…</summary><div>{(['thin', 'more', 'reroll'] as const).map((value, i) => <button key={value} disabled={!!job} onClick={() => run(value)}>{['Fewer', 'More', 'Rearrange'][i]}</button>)}</div></details> : interiorId ?
        <button onClick={() => { activate(); navigateToMap(interiorId, panelId); }}>Open interior</button> : <>
        <button disabled={!!job || !hasBoundary || (places.length > 1 && !place)} onClick={() => run(isResult ? 'another' : 'generate')}>{isResult ? 'Try another' : action}</button>
        {changed && <button disabled={!!job || !hasBoundary} onClick={() => run('apply')}>Apply changes</button>}
      </>}
    </>}
    {!detailed && c.type && !interiorId && <button onClick={() => openGenerationSettings(map, panelId, c.key)}>Settings…</button>}
    {editParts ? <button onClick={() => {
      const groups = new Set(activeSelection.map(id => map.entities[id]?.groupId).filter(Boolean));
      viewStore.setState({ editParts: false, selectedEntityIds: Object.values(map.entities).filter(e =>
        groups.has(e.groupId) || activeSelection.includes(e.id)).map(e => e.id) });
    }}>Done editing parts</button> : selectedGroup && !changed && <button onClick={() => viewStore.setState({ editParts: true })}>Edit parts</button>}
    {c.kind === 'results' && resultList}
    {c.genId && (c.kind === 'building' || isRoom) && <button onClick={() => chooseResult(c.genId!, true)}>{isRoom ? 'Layout…' : 'Town…'}</button>}
    <details className="context-menu"><summary>More…</summary><div>
      {canOutline && <button onClick={() => viewStore.setState({ activeTool: 'pointEdit' })}>Edit outline</button>}
      {isResult && <button disabled={!!job} onClick={() => {
        worldStore.getState().execute('generator.accept', { mapId: map.id, genId: c.genId });
      }} title="Keep these objects and end their ability to regenerate">Make independent</button>}
      {activeSelection.some(id => map.entities[id]?.origin === 'manual' && map.generators[map.entities[id]?.genId ?? '']) && <button disabled={!!job} onClick={() => worldStore.getState().execute('entity.returnToGenerated', { mapId: map.id, entityIds: activeSelection.filter(id => map.entities[id]?.origin === 'manual' && map.generators[map.entities[id]?.genId ?? '']) })}>Allow regeneration of this part</button>}
      {c.type === 'dungeon' && isResult && <button disabled={!!job} onClick={() => run('dressing')}>Rearrange furniture only</button>}
      {map.kind === 'site' && c.kind === 'generate' && <button onClick={() => generationState.setState(s => ({ siteTypes: Object.fromEntries(Object.entries(s.siteTypes).filter(([key]) => key !== `${worldId}:${map.id}`)) }))}>Choose woodland or dungeon</button>}
      <button onClick={() => openGenerationSettings(map, panelId, c.key, 'map')}>Map settings…</button>
      {!detailed && Object.keys(map.generators).length > 0 && resultList}
    </div></details>
    {detailed && c.type && <>
      <label>Seed <input aria-label="Generator seed" type="number" value={d.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label>
      <label>Render seed <input aria-label="Render jitter seed" type="number" value={Number(p.renderSeed ?? 0)} onChange={e => patch({ renderSeed: Number(e.target.value) })} /></label>
      {isResult && (
        <button
          type="button"
          disabled={!!job}
          title="Keep geometry/roads/rooms locked; vary ink jitter, clutter, and labels (Ctrl+Enter)"
          onClick={() => {
            const nextRenderSeed = (Number(p.renderSeed ?? 0) + 1) | 0;
            patch({ renderSeed: nextRenderSeed });
            const nextDraft = { ...d, params: { ...d.params, renderSeed: nextRenderSeed } };
            void generateFromContext(map, c, { ...nextDraft, placeId: place?.id }, panelId, c.type === 'dungeon' ? 'dressing' : 'apply');
          }}
        >
          Re-jitter dressing / ink
        </button>
      )}
      <label>Theme <select aria-label="Generator theme" value={d.themeName} onChange={e => update({ themeName: e.target.value })}>{[...new Set(['default', ...Object.keys(world?.meta.themes ?? {})])].map(name => <option key={name}>{name}</option>)}</select></label>
      {c.type === 'world' ? <>
        <label>Land shape <select aria-label="World generation mode" value={p.mode} onChange={e => patch({ mode: e.target.value })}><option value="new">Generate land around existing edits</option><option value="populate">Follow existing land</option></select></label>
        {number('seaLevel', 'Sea level', .15, .85, .05)}{number('riverThreshold', 'River flow threshold', 2, 200)}
        {number('density', 'World decoration density', 0, 3, .25)}{number('settlements', 'Settlement suggestion count', 0, 50)}
        <details><summary>Terrain tuning</summary>{number('cells', 'Terrain cells', 100, 12000)}{number('plateCount', 'Plate count', 3, 40)}</details>
        <WorldClimateEditor /><details><summary>Settlement suggestions</summary><SettlementSuggestions mapId={map.id} entities={Object.values(map.entities)} /></details>
        {c.record && (c.record.algorithmVersion ?? 1) < 2 && <details><summary>Terrain upgrade</summary>
          <button disabled={!!job} onClick={async () => setUpgrade(await prepareTerrainUpgrade(map, c, d, panelId))}>Preview terrain upgrade</button>
          {upgrade?.after.maps[map.id] && <><WorldUpgradePreview map={upgrade.after.maps[map.id]!} /><p>Your map stays unchanged until you apply this upgrade. Edited features are preserved.</p>
            <button disabled={!!job} onClick={() => { try { applyGenerationPreview(upgrade); setUpgrade(null); } catch (e) { generationState.setState({ error: { mapId: map.id, message: String(e) } }); } }}>Apply terrain upgrade</button><button onClick={() => setUpgrade(null)}>Cancel upgrade</button></>}
        </details>}
      </> : c.type === 'city' ? <>
        <DistrictControls detailsOnly value={{ density: p.density, wealth: p.wealth, activity: p.activity, access: p.access }} onChange={patch} />
        {number('blockSize', 'City block size (ft)', 30 / FOOT, 180 / FOOT, 1, FOOT)}{number('streetWidth', 'City street width (ft)', 3 / FOOT, 16 / FOOT, 1, FOOT)}{number('lotDepth', 'City lot depth (ft)', 8 / FOOT, 30 / FOOT, 1, FOOT)}{check('fringe', 'City gardens and outskirts')}
        <p style={{ fontSize: 11, opacity: 0.75, margin: '4px 0 0' }}>
          Block size sets street grid spacing; Lot depth sets building depth; Gardens &amp; outskirts adds ribbon suburbs and orchards outside walls.
        </p>
      </> : c.type === 'glade' ? <>
        {check('water', 'Outdoor water')}{p.water && <>{check('stream', 'Stream crossing')}{check('pond', 'Pond')}</>}
        <details><summary>Entrances</summary><p>Without custom entrances, paths enter at the north and south edges.</p>
          {(p.entrances as Array<{ x: number; y: number }>).map((point, i) => <div key={i}>{(['x', 'y'] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (ft)<input aria-label={`Entrance ${i + 1} ${axis} (ft)`} type="number" value={Number((point[axis] / FOOT).toFixed(3))} onChange={e => patch({ entrances: p.entrances.map((q: typeof point, j: number) => j === i ? { ...q, [axis]: Number(e.target.value) * FOOT } : q) })} /></label>)}<button onClick={() => patch({ entrances: p.entrances.filter((_: unknown, j: number) => j !== i) })}>Remove entrance {i + 1}</button></div>)}
          <button disabled={p.entrances.length >= 8} onClick={() => { const area = map.entities[c.regionId ?? '']; const points = area?.type === 'area' ? area.rings[0]! : [{ x: map.bounds.x, y: map.bounds.y }, { x: map.bounds.x + map.bounds.w, y: map.bounds.y + map.bounds.h }]; patch({ entrances: [...p.entrances, { x: (Math.min(...points.map(q => q.x)) + Math.max(...points.map(q => q.x))) / 2, y: Math.min(...points.map(q => q.y)) }] }); }}>Add entrance</button>
        </details>
      </> : <>{!isRoom && <>{number('corridorWidth', 'Corridor width', 1, 6)}{check('mirror', 'Mirror left/right')}</>}{number('density', 'Dressing density', 0, 3, .25)}
        {(() => {
          const audit = auditDungeonTopology(map);
          if (audit.roomCount === 0) return null;
          return (
            <div data-testid="generation-dungeon-audit" style={{ marginTop: 6, padding: 6, border: '1px solid var(--atlas-border)', borderRadius: 4, fontSize: 11 }}>
              <strong>Topology: {audit.xanderingRating} ({audit.loops} {audit.loops === 1 ? 'loop' : 'loops'})</strong>
              <div>Max dead-end depth: {audit.maxDeadEndDepth}{audit.singleSecretChokes.length > 0 ? ` · ⚠ Secret choke: ${audit.singleSecretChokes.length}` : ''}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {audit.sevenPillars.map((pill) => (
                  <span key={pill.id} title={pill.tip} style={{ opacity: pill.passed ? 1 : 0.72 }}>
                    {pill.passed ? '✓' : '○'} {pill.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </>}
      {Object.keys(map.generators).length > 0 && <details><summary>Find a generated result</summary>{resultList}</details>}
    </>}
    {!hasBoundary && <div role="alert">This result needs a boundary. Select an area while editing parts, then choose it in Map repair.<button onClick={() => openGenerationSettings(map, panelId, c.key, 'map')}>Map repair…</button></div>}
    {error?.mapId === map.id && <div className="generation-error" role="alert">{error.message}
      {/layer/i.test(error.message) && <button onClick={() => hudStore.getState().openOrFocusPanel('layers')}>Open Layers</button>}
      {c.type === 'city' && c.regionId && <button onClick={() => { try { viewStore.setState({ diagnosticEntityIds: cityDiagnostics(map, c.regionId!)?.blockerIds ?? [] }); } catch { /* The error above already explains invalid boundaries. */ } }}>Highlight obstacles</button>}
    </div>}
  </div>;
}
