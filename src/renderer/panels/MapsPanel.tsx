import { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import { hasParentChanged } from '../geom/pullFromParent';
import type { MapKind, WorldMapSummary } from '../model/schema';
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

export function MapsPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, (s) => s.world);
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);

  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<MapKind>('settlement');
  const [newParentId, setNewParentId] = useState<string>('');

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
    worldStore.getState().setActiveMap(id);
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
    const defaultW =
      activeMap.kind === 'world'
        ? 4000
        : activeMap.kind === 'region'
          ? 1000
          : activeMap.kind === 'settlement'
            ? 400
            : (entry?.width ?? 1000) / (entry?.pxPerSquare ?? 200) * 1.524;
    const defaultH = defaultW * aspect;
    const layerId = activeMap.layers[0]?.id ?? 'layer-base';

    worldStore.getState().execute('entity.add', {
      mapId: activeMap.id,
      entity: {
        id: `img-${crypto.randomUUID().slice(0, 8)}`,
        type: 'image',
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
  };

  const tree = world ? buildMapTree(world.meta.maps) : [];

  return (
    <div
      data-testid={`panel-${props.api.id}`}
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
                  onClick={() => worldStore.getState().setActiveMap(map.id)}
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
          <input
            type="text"
            placeholder="Map name"
            data-testid="input-new-map-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
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
          <select
            data-testid="select-new-map-parent"
            value={newParentId}
            onChange={(e) => setNewParentId(e.target.value)}
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

          <hr style={{ width: '100%', borderColor: 'var(--atlas-border)' }} />

          <button
            type="button"
            data-testid="btn-import-backdrop"
            disabled={!activeMap || !worldPath}
            onClick={() => void handleImportBackdrop()}
          >
            Import Backdrop Image
          </button>
          <button
            type="button"
            data-testid="btn-calibrate-scale"
            disabled={!firstImageEntity}
            onClick={() => {
              if (firstImageEntity) {
                viewStore.getState().setCalibratingImageId(firstImageEntity.id);
              }
            }}
          >
            Set Real Size (Calibrate)
          </button>
        </div>
      )}
    </div>
  );
}
