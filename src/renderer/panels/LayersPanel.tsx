import { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import type { Layer } from '../model/schema';
import { worldStore } from '../model/store';
import { PanelHeaderBar } from './PanelHeaderBar';

export function LayersPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const map = activeMapId && world ? world.maps[activeMapId] : undefined;

  const [newLayerName, setNewLayerName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleAddLayer = () => {
    if (!map) return;
    const name = newLayerName.trim() || `Layer ${map.layers.length + 1}`;
    const id = `layer-${crypto.randomUUID().slice(0, 8)}`;
    worldStore.getState().execute('layer.add', {
      mapId: map.id,
      layer: {
        id,
        name,
        visible: true,
        locked: false,
        gmOnly: false,
      },
    });
    setNewLayerName('');
  };

  const updateLayer = (layerId: string, patch: Partial<Omit<Layer, 'id'>>) => {
    if (!map) return;
    worldStore.getState().execute('layer.update', {
      mapId: map.id,
      layerId,
      patch,
    });
  };

  const reorderLayer = (layerId: string, toIndex: number) => {
    if (!map) return;
    worldStore.getState().execute('layer.reorder', {
      mapId: map.id,
      layerId,
      toIndex,
    });
  };

  const deleteLayer = (layerId: string) => {
    if (!map || map.layers.length <= 1) return;
    worldStore.getState().execute('layer.delete', {
      mapId: map.id,
      layerId,
    });
  };

  const commitRename = (layerId: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      updateLayer(layerId, { name: trimmed });
    }
    setEditingId(null);
  };

  // Display top-to-bottom (highest draw-order index first)
  const layersTopFirst = map
    ? map.layers.map((layer, index) => ({ layer, index })).reverse()
    : [];

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
      <PanelHeaderBar title="Layers" panelProps={props} />

      {!map ? (
        <div style={{ padding: 12, color: 'var(--atlas-text-muted)' }}>
          No active map
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            padding: 8,
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              data-testid="input-new-layer"
              placeholder="New layer name..."
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddLayer();
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              data-testid="btn-add-layer"
              onClick={handleAddLayer}
            >
              + Add
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {layersTopFirst.map(({ layer, index }) => (
              <div
                key={layer.id}
                data-testid={`layer-row-${layer.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--atlas-border)',
                  background: 'var(--atlas-surface)',
                  opacity: layer.visible ? 1 : 0.6,
                }}
              >
                {editingId === layer.id ? (
                  <input
                    type="text"
                    autoFocus
                    data-testid={`layer-rename-input-${layer.id}`}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(layer.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                ) : (
                  <span
                    data-testid={`layer-name-${layer.id}`}
                    title="Double-click to rename"
                    onDoubleClick={() => {
                      setEditingId(layer.id);
                      setEditingName(layer.name);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'text',
                    }}
                  >
                    {layer.name}
                  </span>
                )}

                <button
                  type="button"
                  data-testid={`layer-visible-${layer.id}`}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                  style={{
                    fontWeight: layer.visible ? 600 : 400,
                    opacity: layer.visible ? 1 : 0.5,
                  }}
                >
                  {layer.visible ? 'Vis' : 'Hid'}
                </button>

                <button
                  type="button"
                  data-testid={`layer-lock-${layer.id}`}
                  title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                  onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                  style={{
                    fontWeight: layer.locked ? 700 : 400,
                    color: layer.locked ? 'var(--atlas-danger)' : undefined,
                  }}
                >
                  {layer.locked ? 'Lock' : 'Unl'}
                </button>

                <button
                  type="button"
                  data-testid={`layer-gm-${layer.id}`}
                  title="Toggle GM-only"
                  onClick={() => updateLayer(layer.id, { gmOnly: !layer.gmOnly })}
                  style={{
                    fontWeight: layer.gmOnly ? 700 : 400,
                    opacity: layer.gmOnly ? 1 : 0.55,
                  }}
                >
                  GM
                </button>

                <button
                  type="button"
                  data-testid={`layer-up-${layer.id}`}
                  title="Move up in draw order"
                  disabled={index >= map.layers.length - 1}
                  onClick={() => reorderLayer(layer.id, index + 1)}
                >
                  ▲
                </button>

                <button
                  type="button"
                  data-testid={`layer-down-${layer.id}`}
                  title="Move down in draw order"
                  disabled={index <= 0}
                  onClick={() => reorderLayer(layer.id, index - 1)}
                >
                  ▼
                </button>

                <button
                  type="button"
                  data-testid={`layer-delete-${layer.id}`}
                  title="Delete layer"
                  disabled={map.layers.length <= 1}
                  onClick={() => deleteLayer(layer.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
