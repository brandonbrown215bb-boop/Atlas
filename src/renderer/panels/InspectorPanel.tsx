import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import type { AreaRole, Entity, PathRole } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { PanelHeaderBar } from './PanelHeaderBar';

const AREA_ROLES = [
  'land',
  'water',
  'plateau',
  'district',
  'building',
  'floor',
] as const;

const PATH_ROLES: readonly PathRole[] = [
  'road',
  'river',
  'cliff',
  'cityWall',
  'trail',
];

function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  testId?: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(Number(props.value.toFixed(4))));

  useEffect(() => {
    setDraft(String(Number(props.value.toFixed(4))));
  }, [props.value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Number(props.value.toFixed(4))));
      return;
    }
    if (props.min !== undefined && parsed < props.min) {
      setDraft(String(Number(props.value.toFixed(4))));
      return;
    }
    if (parsed !== props.value) {
      props.onCommit(parsed);
    }
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
        {props.label}
      </span>
      <input
        type="number"
        data-testid={props.testId}
        step={props.step ?? 'any'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
    </label>
  );
}

function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  testId?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);

  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  const commit = () => {
    if (draft !== props.value) {
      props.onCommit(draft);
    }
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
        {props.label}
      </span>
      <input
        type="text"
        data-testid={props.testId}
        placeholder={props.placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  placeholder?: string;
  testId?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);

  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  const commit = () => {
    if (draft !== props.value) {
      props.onCommit(draft);
    }
  };

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: 'var(--atlas-text-muted)' }}>{props.label}</span>
      <textarea
        rows={3}
        data-testid={props.testId}
        placeholder={props.placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
        }}
        style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
      />
    </label>
  );
}

export function InspectorPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const selectedIds = useStore(viewStore, (s) => s.selectedEntityIds);

  const map = activeMapId && world ? world.maps[activeMapId] : undefined;
  const selectedEntities: Entity[] = map
    ? selectedIds
        .map((id) => map.entities[id])
        .filter((e): e is Entity => Boolean(e))
    : [];

  const updateEntity = (entityId: string, patch: Record<string, unknown>) => {
    if (!map) return;
    worldStore.getState().execute('entity.update', {
      mapId: map.id,
      entityId,
      patch,
    });
  };

  const updateBatch = (patch: Record<string, unknown>) => {
    if (!map || selectedEntities.length === 0) return;
    worldStore.getState().executeBatch(
      selectedEntities.map((ent) => ({
        name: 'entity.update',
        input: { mapId: map.id, entityId: ent.id, patch },
      })),
      'inspector.batchUpdate',
    );
  };

  const single = selectedEntities.length === 1 ? selectedEntities[0]! : null;

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
      <PanelHeaderBar title="Inspector" panelProps={props} />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {!map || selectedEntities.length === 0 ? (
          <div style={{ color: 'var(--atlas-text-muted)' }}>
            Select an entity to inspect
          </div>
        ) : !single ? (
          <>
            <div style={{ fontWeight: 600 }}>
              {selectedEntities.length} entities selected
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                Layer
              </span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) updateBatch({ layerId: e.target.value });
                }}
                style={{ flex: 1 }}
              >
                <option value="">— Move to layer —</option>
                {map.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={selectedEntities.every((e) => Boolean(e.gmOnly))}
                onChange={(e) => updateBatch({ gmOnly: e.target.checked })}
              />
              <span>GM-only</span>
            </label>
          </>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 6,
                borderBottom: '1px solid var(--atlas-border)',
              }}
            >
              <strong data-testid="inspector-entity-type">
                {single.type}
              </strong>
              <span style={{ color: 'var(--atlas-text-muted)', fontSize: 11 }}>
                {single.origin} · {single.id.slice(0, 8)}
              </span>
            </div>

            <TextField
              label="Name"
              testId="inspector-field-name"
              value={single.name ?? ''}
              placeholder="(unnamed)"
              onCommit={(val) =>
                updateEntity(single.id, { name: val || undefined })
              }
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                Layer
              </span>
              <select
                data-testid="inspector-field-layer"
                value={single.layerId}
                onChange={(e) =>
                  updateEntity(single.id, { layerId: e.target.value })
                }
                style={{ flex: 1 }}
              >
                {map.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                data-testid="inspector-field-gmOnly"
                checked={Boolean(single.gmOnly)}
                onChange={(e) =>
                  updateEntity(single.id, { gmOnly: e.target.checked })
                }
              />
              <span>GM-only</span>
            </label>

            {single.type === 'image' && (
              <>
                <NumberField
                  label="X (m)"
                  value={single.x}
                  onCommit={(x) => updateEntity(single.id, { x })}
                />
                <NumberField
                  label="Y (m)"
                  value={single.y}
                  onCommit={(y) => updateEntity(single.id, { y })}
                />
                <NumberField
                  label="Width (m)"
                  value={single.w}
                  min={0.01}
                  onCommit={(w) => updateEntity(single.id, { w })}
                />
                <NumberField
                  label="Height (m)"
                  value={single.h}
                  min={0.01}
                  onCommit={(h) => updateEntity(single.id, { h })}
                />
                <NumberField
                  label="Rotation (°)"
                  value={(single.rotation * 180) / Math.PI}
                  onCommit={(deg) =>
                    updateEntity(single.id, {
                      rotation: (deg * Math.PI) / 180,
                    })
                  }
                />
              </>
            )}

            {single.type === 'area' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                    Role
                  </span>
                  <select
                    data-testid="inspector-field-role"
                    value={
                      AREA_ROLES.includes(
                        single.role as (typeof AREA_ROLES)[number],
                      )
                        ? single.role
                        : 'biome:forest'
                    }
                    onChange={(e) =>
                      updateEntity(single.id, {
                        role: e.target.value as AreaRole,
                      })
                    }
                    style={{ flex: 1 }}
                  >
                    {AREA_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="biome:forest">biome:forest</option>
                  </select>
                </label>
                {single.role.startsWith('biome:') && (
                  <TextField
                    label="Biome"
                    value={single.role}
                    onCommit={(role) => {
                      if (role.startsWith('biome:') && role.length > 6) {
                        updateEntity(single.id, { role });
                      }
                    }}
                  />
                )}
                <TextField
                  label="Fill (#hex)"
                  testId="inspector-field-fill"
                  value={single.fill ?? ''}
                  placeholder="#3b5249"
                  onCommit={(fill) =>
                    updateEntity(single.id, { fill: fill || undefined })
                  }
                />
                <NumberField
                  label="Elevation"
                  value={single.elevation ?? 0}
                  onCommit={(elevation) =>
                    updateEntity(single.id, { elevation })
                  }
                />
              </>
            )}

            {single.type === 'path' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                    Role
                  </span>
                  <select
                    data-testid="inspector-field-role"
                    value={single.role}
                    onChange={(e) =>
                      updateEntity(single.id, {
                        role: e.target.value as PathRole,
                      })
                    }
                    style={{ flex: 1 }}
                  >
                    {PATH_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label="Width (m)"
                  value={single.width}
                  min={0.05}
                  onCommit={(width) => updateEntity(single.id, { width })}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={single.closed}
                    onChange={(e) =>
                      updateEntity(single.id, { closed: e.target.checked })
                    }
                  />
                  <span>Closed loop</span>
                </label>
              </>
            )}

            {single.type === 'wall' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={single.blocksMove}
                    onChange={(e) =>
                      updateEntity(single.id, { blocksMove: e.target.checked })
                    }
                  />
                  <span>Blocks movement</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={single.blocksSight}
                    onChange={(e) =>
                      updateEntity(single.id, { blocksSight: e.target.checked })
                    }
                  />
                  <span>Blocks sight</span>
                </label>
              </>
            )}

            {single.type === 'door' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                    Kind
                  </span>
                  <select
                    value={single.kind}
                    onChange={(e) =>
                      updateEntity(single.id, { kind: e.target.value })
                    }
                    style={{ flex: 1 }}
                  >
                    <option value="door">door</option>
                    <option value="secret">secret</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={single.open}
                    onChange={(e) =>
                      updateEntity(single.id, { open: e.target.checked })
                    }
                  />
                  <span>Open</span>
                </label>
              </>
            )}

            {single.type === 'prop' && (
              <>
                <NumberField
                  label="X (m)"
                  value={single.x}
                  onCommit={(x) => updateEntity(single.id, { x })}
                />
                <NumberField
                  label="Y (m)"
                  value={single.y}
                  onCommit={(y) => updateEntity(single.id, { y })}
                />
                <NumberField
                  label="Rotation (°)"
                  value={(single.rotation * 180) / Math.PI}
                  onCommit={(deg) =>
                    updateEntity(single.id, {
                      rotation: (deg * Math.PI) / 180,
                    })
                  }
                />
                <NumberField
                  label="Scale"
                  value={single.scale}
                  min={0.05}
                  step={0.1}
                  onCommit={(scale) => updateEntity(single.id, { scale })}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={single.flipX}
                    onChange={(e) =>
                      updateEntity(single.id, { flipX: e.target.checked })
                    }
                  />
                  <span>Flip X</span>
                </label>
              </>
            )}

            {single.type === 'light' && (
              <>
                <NumberField
                  label="X (m)"
                  value={single.x}
                  onCommit={(x) => updateEntity(single.id, { x })}
                />
                <NumberField
                  label="Y (m)"
                  value={single.y}
                  onCommit={(y) => updateEntity(single.id, { y })}
                />
                <NumberField
                  label="Radius (m)"
                  value={single.radius}
                  min={0.1}
                  onCommit={(radius) => updateEntity(single.id, { radius })}
                />
                <TextField
                  label="Color"
                  value={single.color}
                  onCommit={(color) => {
                    if (color.trim()) updateEntity(single.id, { color });
                  }}
                />
              </>
            )}

            {single.type === 'label' && (
              <>
                <TextField
                  label="Text"
                  value={single.text}
                  onCommit={(text) => updateEntity(single.id, { text })}
                />
                <NumberField
                  label="X (m)"
                  value={single.x}
                  onCommit={(x) => updateEntity(single.id, { x })}
                />
                <NumberField
                  label="Y (m)"
                  value={single.y}
                  onCommit={(y) => updateEntity(single.id, { y })}
                />
                <NumberField
                  label="Size"
                  value={single.size}
                  min={1}
                  onCommit={(size) => updateEntity(single.id, { size })}
                />
              </>
            )}

            {single.type === 'portal' && (
              <>
                <NumberField
                  label="X (m)"
                  value={single.x}
                  onCommit={(x) => updateEntity(single.id, { x })}
                />
                <NumberField
                  label="Y (m)"
                  value={single.y}
                  onCommit={(y) => updateEntity(single.id, { y })}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                    Target map
                  </span>
                  <select
                    value={single.targetMapId}
                    onChange={(e) =>
                      updateEntity(single.id, { targetMapId: e.target.value })
                    }
                    style={{ flex: 1 }}
                  >
                    {world?.meta.maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  data-testid="btn-follow-portal"
                  onClick={() => {
                    const vs = viewStore.getState();
                    const targetPanelId = vs.activeMapPanelId ?? 'map-main';
                    vs.setPanelMap(targetPanelId, single.targetMapId);
                    vs.setSelection([]);
                    worldStore.getState().setActiveMap(single.targetMapId);
                  }}
                >
                  Follow Portal
                </button>
              </>
            )}

            {single.type === 'place' && (
              <>
                <TextField
                  label="Category"
                  value={single.category}
                  onCommit={(category) =>
                    updateEntity(single.id, { category })
                  }
                />
                <TextAreaField
                  label="Notes"
                  value={single.notes}
                  onCommit={(notes) => updateEntity(single.id, { notes })}
                />
                <TextAreaField
                  label="GM Notes"
                  value={single.gmNotes}
                  onCommit={(gmNotes) => updateEntity(single.id, { gmNotes })}
                />
                <button
                  type="button"
                  data-testid="btn-inspector-open-interior"
                  onClick={() => {
                    const res = worldStore.getState().execute('map.openInterior', {
                      parentMapId: map.id,
                      placeId: single.id,
                    }) as { id: string };
                    const vs = viewStore.getState();
                    const targetPanelId = vs.activeMapPanelId ?? 'map-main';
                    vs.setPanelMap(targetPanelId, res.id);
                    vs.setSelection([]);
                    worldStore.getState().setActiveMap(res.id);
                  }}
                >
                  {single.childMapId ? 'Open Interior' : 'Create & Open Interior'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
