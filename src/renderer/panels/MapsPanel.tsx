import { formatFloorLabel } from '../geom/expandMap';
import { TraceGeographyDialog } from './TraceGeographyDialog';
import { FOOT, MILE } from '../model/mapDefaults';
import { navigateToMap } from '../model/navigation';
import { useState } from 'react';
import { useStore } from 'zustand';
import { hasParentChanged } from '../geom/pullFromParent';
import { parseSvg, type SvgDrawing } from '../import/svg';
import type { MapDoc, MapKind, WorldMapSummary } from '../model/schema';
import { SvgImportDialog } from './SvgImportDialog';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

function buildMapTree(
  maps: readonly WorldMapSummary[],
  parentId?: string,
  depth = 0,
): Array<{ map: WorldMapSummary; depth: number }> {
  const result: Array<{ map: WorldMapSummary; depth: number }> = [];
  for (const m of maps) {
    if ((m.parentId ?? undefined) === parentId) {
      result.push({ map: m, depth });
      result.push(...buildMapTree(maps, m.id, depth + 1));
    }
  }
  return result;
}

export function MapsPanel({ panelId = 'maps' }: { panelId?: string }) {
  const world = useStore(worldStore, (s) => s.world);
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);

  const [backdropWidth, setBackdropWidth] = useState('');
  const [backdropUnit, setBackdropUnit] = useState<'mi' | 'ft'>('mi');
  const [tracing,setTracing] = useState(false);
  const [repairing,setRepairing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<MapKind>('settlement');
  const [newParentId, setNewParentId] = useState<string>('');
  const [svgImport, setSvgImport] = useState<{ drawing: SvgDrawing; fileName: string; map: MapDoc; worldId: string } | null>(null);
  const [svgError, setSvgError] = useState('');
  const [loadingSvg, setLoadingSvg] = useState(false);

  const activeMap =
    activeMapId && world ? world.maps[activeMapId] : undefined;
  const firstImageEntity = activeMap
    ? Object.values(activeMap.entities).find((e) => e.type === 'image')
    : undefined;

  const handleCreateMap = () => {
    if (!world) return;
    const id = `map-${crypto.randomUUID().slice(0, 8)}`;
    const name = newName.trim() || `New ${newKind}`;
    worldStore.getState().execute('map.create', {
      id,
      name,
      kind: newKind,
      parentId: newParentId || undefined,
    });
    navigateToMap(id);
    setNewName('');
  };

  const handleImportBackdrop = async () => {
    if (!worldPath || !activeMap) return;
    const filePath = await window.atlasApi.pickImage();
    if (!filePath) return;
    const { assetId, index } = await window.atlasApi.importImageAsset(
      worldPath,
      filePath,
    );
    viewStore.getState().setAssetsIndex(index);

    const entry = index[assetId];
    const aspect = entry ? entry.height / entry.width : 1;
    const defaultW = Number(backdropWidth) > 0 ? Number(backdropWidth) * (backdropUnit === 'mi' ? MILE : FOOT) : activeMap.bounds.w;
    const defaultH = defaultW * aspect;
    const layerId = activeMap.layers[0]?.id ?? 'layer-base';

    const imageId = `img-${crypto.randomUUID().slice(0, 8)}`;
    worldStore.getState().execute('entity.add', {
      mapId: activeMap.id,
      entity: {
        id: imageId,
        type: 'image', usage: 'reference',
        layerId,
        origin: 'manual',
        rev: 0,
        assetId,
        x: 0,
        y: 0,
        w: defaultW,
        h: defaultH,
        rotation: 0,
      },
    });
    viewStore.getState().setSelection([imageId]);
    viewStore.setState({ fitRequest: { panelId: viewStore.getState().activeMapPanelId ?? 'map-main', bounds: { x: 0, y: 0, w: defaultW, h: defaultH }, nonce: Date.now() } });
    if (!Object.keys(activeMap.entities).length) worldStore.getState().execute('map.setExtent', { mapId: activeMap.id, bounds: { x: 0, y: 0, w: defaultW, h: defaultH } });
  };

  const tree = world ? buildMapTree(world.meta.maps) : [];

  return (
    <div
      data-testid={`panel-${panelId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--atlas-bg)',
        color: 'var(--atlas-text)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--atlas-border)',
          background: 'var(--atlas-surface)',
          fontWeight: 600,
        }}
      >
        Maps
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {!world ? (
          <span style={{ color: 'var(--atlas-text-muted)' }}>No world open</span>
        ) : (
          tree.map(({ map, depth }) => {
            const mapDoc = world.maps[map.id];
            const parentDoc = mapDoc?.parent
              ? world.maps[mapDoc.parent.mapId]
              : undefined;
            const changed = Boolean(
              mapDoc && parentDoc && hasParentChanged(mapDoc, parentDoc),
            );
            return (
              <div
                key={map.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginLeft: depth * 12,
                }}
              >
                <button
                  type="button"
                  data-testid={`map-tree-item-${map.id}`}
                  onClick={() => navigateToMap(map.id)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    borderColor:
                      map.id === activeMapId
                        ? 'var(--atlas-accent)'
                        : 'var(--atlas-border)',
                  }}
                >
                  {map.name} <span style={{ opacity: 0.65 }}>({map.kind})</span>
                  {changed && (
                    <span
                      data-testid={`parent-changed-${map.id}`}
                      style={{
                        marginLeft: 6,
                        color: '#f59e0b',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      • parent changed
                    </span>
                  )}
                </button>
                {changed && (
                  <button
                    type="button"
                    data-testid={`btn-pull-parent-${map.id}`}
                    onClick={() =>
                      worldStore
                        .getState()
                        .execute('map.pullFromParent', { mapId: map.id })
                    }
                  >
                    Pull
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {world && (
        <div
          style={{
            padding: 8,
            borderTop: '1px solid var(--atlas-border)',
            background: 'var(--atlas-surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 600 }}>New Map</div>
          {activeMap && (activeMap.kind === 'interior' || activeMap.kind === 'site') && world && (() => {
            const groupId = activeMap.floorGroupId ?? activeMap.id;
            const stack = Object.values(world.maps)
              .filter((m) => (m.floorGroupId ?? m.id) === groupId)
              .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
            const topLevel = stack[stack.length - 1]?.level ?? 0;
            const botLevel = stack[0]?.level ?? 0;
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--atlas-text-muted)' }}>Floors:</span>
                {stack.map((fl) => (
                  <button
                    key={fl.id}
                    type="button"
                    data-testid={`btn-floor-${formatFloorLabel(fl.level ?? 0)}`}
                    onClick={() => navigateToMap(fl.id)}
                    style={{
                      padding: '2px 6px',
                      fontSize: 11,
                      fontWeight: fl.id === activeMap.id ? 700 : 400,
                      borderColor: fl.id === activeMap.id ? 'var(--atlas-accent)' : 'var(--atlas-border)',
                    }}
                  >
                    {formatFloorLabel(fl.level ?? 0)}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="btn-add-basement"
                  title="Add Basement Level Below"
                  onClick={() => {
                    const lowest = stack[0] ?? activeMap;
                    const newId = `map-${crypto.randomUUID().slice(0, 8)}`;
                    const res = worldStore.getState().execute('map.createFloor', {
                      sourceMapId: lowest.id,
                      levelDelta: -1,
                      newId,
                    }) as { id: string };
                    navigateToMap(res.id);
                  }}
                  style={{ padding: '2px 5px', fontSize: 11 }}
                >
                  +{formatFloorLabel(botLevel - 1)}
                </button>
                <button
                  type="button"
                  data-testid="btn-add-upper-floor"
                  title="Add Upper Floor Level"
                  onClick={() => {
                    const highest = stack[stack.length - 1] ?? activeMap;
                    const newId = `map-${crypto.randomUUID().slice(0, 8)}`;
                    const res = worldStore.getState().execute('map.createFloor', {
                      sourceMapId: highest.id,
                      levelDelta: 1,
                      newId,
                    }) as { id: string };
                    navigateToMap(res.id);
                  }}
                  style={{ padding: '2px 5px', fontSize: 11 }}
                >
                  +{formatFloorLabel(topLevel + 1)}
                </button>
              </div>
            );
          })()}
          {activeMap && (activeMap.kind === 'world' || activeMap.kind === 'region') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--atlas-text-muted)' }}>Expand Seam:</span>
              {(['N', 'S', 'E', 'W'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  data-testid={`btn-expand-${dir}`}
                  title={`Create seam-matched ${dir} neighbor map`}
                  onClick={() => {
                    const id = `map-${crypto.randomUUID().slice(0, 8)}`;
                    worldStore.getState().execute('map.expandNeighbor', {
                      sourceMapId: activeMap.id,
                      direction: dir,
                      newId: id,
                    });
                    navigateToMap(id);
                  }}
                  style={{ flex: 1, padding: '2px 4px', fontSize: 11 }}
                >
                  +{dir}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              placeholder="Map name"
              data-testid="input-new-map-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <select
              data-testid="select-new-map-kind"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as MapKind)}
            >
              <option value="world">world</option>
              <option value="region">region</option>
              <option value="settlement">settlement</option>
              <option value="site">site</option>
              <option value="interior">interior</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              data-testid="select-new-map-parent"
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">(no parent)</option>
              {world.meta.maps.map((m) => (
                <option key={m.id} value={m.id}>
                  Parent: {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="btn-create-map"
              onClick={handleCreateMap}
            >
              Create Map
            </button>
          </div>

          <hr style={{ width: '100%', borderColor: 'var(--atlas-border)', margin: '2px 0' }} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Backdrop width</span>
            <input
              aria-label="Backdrop real width"
              type="number"
              min="0.01"
              placeholder="Map width"
              value={backdropWidth}
              onChange={(e) => setBackdropWidth(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <select
              aria-label="Backdrop width unit"
              value={backdropUnit}
              onChange={(e) => setBackdropUnit(e.target.value as typeof backdropUnit)}
            >
              <option value="mi">mi</option>
              <option value="ft">ft</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              data-testid="btn-import-backdrop"
              disabled={!activeMap || !worldPath}
              onClick={() => void handleImportBackdrop()}
              style={{ flex: 1 }}
            >
              Import Backdrop Image
            </button>
            <button
              type="button"
              data-testid="btn-import-svg"
              disabled={!activeMap || loadingSvg}
              style={{ flex: 1 }}
              onClick={async (event) => {
                if (!activeMap || !world) return;
                const doc = event.currentTarget.ownerDocument;
                setSvgError('');
                setLoadingSvg(true);
                try {
                  const file = await window.atlasApi.pickSvg();
                  if (file && worldStore.getState().world?.meta.id === world.meta.id) {
                    setSvgImport({ drawing: parseSvg(file.text, doc), fileName: file.name, map: activeMap, worldId: world.meta.id });
                  }
                } catch (error) { setSvgError(error instanceof Error ? error.message : String(error)); }
                finally { setLoadingSvg(false); }
              }}
            >
              {loadingSvg ? 'Reading SVG…' : 'Import SVG'}
            </button>
          </div>
          {svgError && <div role="alert" style={{ color: 'var(--atlas-danger)' }}>{svgError}</div>}
          {firstImageEntity && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                data-testid="btn-trace-geography"
                onClick={() => setTracing(true)}
                style={{ flex: 1 }}
              >
                Trace Geography
              </button>
              <button
                type="button"
                data-testid="btn-calibrate-scale"
                onClick={() => {
                  viewStore.getState().setCalibratingImageId(firstImageEntity.id);
                }}
                style={{ flex: 1 }}
              >
                Set Real Size (Calibrate)
              </button>
            </div>
          )}
          <button type="button" onClick={() => setRepairing(!repairing)}>Repair Existing World…</button>
          {repairing && activeMap && <div role="region" aria-label="Repair preview">
            <p>Repair this map's extent, restore missing layers for stranded contents, and recover boundaries from surviving source areas. Existing geometry is preserved; missing sources stay unresolved. Applying is undoable.</p>
            {Object.values(activeMap.entities).some(e=>!activeMap.layers.some(l=>l.id===e.layerId))&&<p>Some contents belong to deleted layers. Repair will restore those layers as “Recovered contents”.</p>}
            {Object.entries(activeMap.generators).map(([id,r])=><div key={id}>{r.type}: {r.boundary||activeMap.entities[r.regionEntityId]?.type==='area'?'Boundary available':'Missing boundary'}{!r.boundary&&activeMap.entities[r.regionEntityId]?.type!=='area'&&<button disabled={!viewStore.getState().selectedEntityIds.some(key=>activeMap.entities[key]?.type==='area')} onClick={()=>worldStore.getState().execute('map.repair',{mapId:activeMap.id,reassign:{[id]:viewStore.getState().selectedEntityIds.find(key=>activeMap.entities[key]?.type==='area')}})}>Use selected area</button>}</div>)}
            <button onClick={()=>{worldStore.getState().execute('map.repair',{mapId:activeMap.id});setRepairing(false);}}>Apply Repair</button>
          </div>}
        </div>
      )}
      {tracing && firstImageEntity?.type==='image' && <TraceGeographyDialog image={firstImageEntity} onClose={()=>setTracing(false)} />}
      {svgImport && <SvgImportDialog {...svgImport} onClose={() => setSvgImport(null)} />}
    </div>
  );
}
