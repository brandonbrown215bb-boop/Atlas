import { activateMapPanel, navigateToMap } from '../model/navigation';
import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import {
  DEFAULT_BIOMES,
  DistrictProfileSchema,
  type AreaRole,
  type Entity,
  type MapDoc,
  type PathRole,
  type PlaceEntity,
} from '../model/schema';
import { DistrictControls } from './DistrictControls';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { PanelHeaderBar } from './PanelHeaderBar';
import { GenerationControls, useGenerationTarget } from './GenerationControls';
import { resolveGenerationContext } from '../model/generationContext';
import {
  defaultGenerationDraft,
  draftKey,
  generateFromContext,
  generationState,
  type SettingsTarget,
} from '../model/generationState';
import { MapSettings } from './MapSettings';

function ContextSettings({ map, target, props }: { map: MapDoc; target: SettingsTarget; props: IDockviewPanelProps }) {
  const { context } = useGenerationTarget(map, target.panelId);
  const valid = target.mode === 'map' || context.key === target.key;
  useEffect(() => { if (!valid) generationState.setState({ settings: null }); }, [valid]);
  if (!valid) return null;
  return <div data-testid={`panel-${props.api.id}`} style={{ height: '100%', overflow: 'auto' }}>
    <PanelHeaderBar title={target.mode === 'map' ? 'Map settings' : 'Generation settings'} panelProps={props} />
    <button onClick={() => generationState.setState({ settings: null })}>Back to selection</button>
    {target.mode === 'map' ? <MapSettings key={map.id} map={map} /> : <GenerationControls map={map} panelId={target.panelId} api={props.containerApi} detailed />}
  </div>;
}

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

function toHexColor(val?: string): string {
  if (!val) return '#3b5249';
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val;
  const short = val.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return '#3b5249';
}

const PLACE_CATEGORY_SUGGESTIONS = [
  'settlement',
  'dungeon',
  'region',
  'building',
  'room',
  'landmark',
  'poi',
  'Tavern',
  'Shop',
  'other',
];

function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  testId?: string;
  list?: string;
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
        list={props.list}
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
  const editParts = useStore(viewStore, (s) => s.editParts);
  const settings = useStore(generationState, s => s.settings);
  const job = useStore(generationState, (s) => s.job);

  const map = activeMapId && world ? world.maps[activeMapId] : undefined;
  const prevSelectedKey = useRef(selectedIds.join(','));
  const prevSettings = useRef(settings);

  useEffect(() => {
    const selectedKey = selectedIds.join(',');
    if (
      settings &&
      prevSettings.current === settings &&
      selectedKey !== prevSelectedKey.current &&
      selectedIds.length === 1 &&
      map
    ) {
      const ent = map.entities[selectedIds[0]!];
      if (ent && (!ent.groupId || editParts || ent.type === 'place')) {
        generationState.setState({ settings: null });
      }
    }
    prevSelectedKey.current = selectedKey;
    prevSettings.current = settings;
  }, [selectedIds, settings, editParts, map]);
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

  if (settings && settings.worldId === world?.meta.id && settings.mapId === activeMapId && map) {
    return <ContextSettings map={map} target={settings} props={props} />;
  }

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
        {map&&selectedEntities.length>0&&selectedEntities[0]?.groupId&&selectedEntities.every(e=>e.groupId===selectedEntities[0]!.groupId)&&<div>
          Group: {map.groups?.[selectedEntities[0]!.groupId!]?.name??'Map group'}{' '}
          <button onClick={()=>viewStore.setState({editParts:true})}>Edit Parts</button>
        </div>}
        {map&&selectedEntities.some(e=>e.origin==='manual'&&e.genId&&map.generators[e.genId])&&<div>
          Edited parts are preserved on reroll.{' '}
          <details><summary>More…</summary><button onClick={()=>worldStore.getState().execute('entity.returnToGenerated',{mapId:map.id,entityIds:selectedEntities.filter(e=>e.origin==='manual'&&e.genId).map(e=>e.id)})}>Allow regeneration of this part</button></details>
        </div>}
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
            {single.type==='path'&&single.role==='river'&&single.outlet&&<div>Downstream outlet: {single.outlet}</div>}

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
                {single.role==='floor'&&single.roomPurpose&&<div>Room purpose: {single.roomPurpose}</div>}
                {(() => {
                  const biomeRoles = Array.from(
                    new Set([
                      ...(world?.meta.climate?.biomes ?? DEFAULT_BIOMES).map(
                        (b) => `biome:${b.name}`,
                      ),
                      ...(single.role.startsWith('biome:') ? [single.role] : []),
                    ]),
                  );
                  return (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 78, color: 'var(--atlas-text-muted)' }}>
                        Role
                      </span>
                      <select
                        data-testid="inspector-field-role"
                        value={single.role}
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
                        {biomeRoles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })()}
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
                {single.role === 'district' && <DistrictControls value={single.district ?? DistrictProfileSchema.parse({})} onChange={district=>updateEntity(single.id,{district})} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Fill (#hex)"
                      testId="inspector-field-fill"
                      value={single.fill ?? ''}
                      placeholder="#3b5249"
                      onCommit={(fill) =>
                        updateEntity(single.id, { fill: fill || undefined })
                      }
                    />
                  </div>
                  <input
                    type="color"
                    data-testid="inspector-field-fill-picker"
                    aria-label="Fill color"
                    value={toHexColor(single.fill)}
                    onChange={(e) =>
                      updateEntity(single.id, { fill: e.target.value })
                    }
                    style={{
                      width: 28,
                      height: 24,
                      padding: 0,
                      border: '1px solid var(--atlas-border)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  />
                  {single.fill && (
                    <button
                      type="button"
                      onClick={() => updateEntity(single.id, { fill: undefined })}
                    >
                      Clear
                    </button>
                  )}
                </div>
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
                  label="Path width (ft)"
                  value={single.width/.3048}
                  min={0.05}
                  onCommit={(width) => updateEntity(single.id, { width:width*.3048 })}
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
                    navigateToMap(single.targetMapId);
                  }}
                >
                  Follow Portal
                </button>
              </>
            )}

            <datalist id="inspector-place-categories">
              {PLACE_CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            {single.type === 'place' &&
              (() => {
                const linkedBuilding =
                  map.kind === 'settlement'
                    ? single.entityIds
                        .map((id) => map.entities[id])
                        .find((e) => e?.type === 'area' && e.role === 'building')
                    : undefined;
                const hasChildMap = Boolean(
                  single.childMapId && world?.maps[single.childMapId],
                );
                return (
                  <>
                    <TextField
                      label="Category"
                      list="inspector-place-categories"
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
                      onCommit={(gmNotes) =>
                        updateEntity(single.id, { gmNotes })
                      }
                    />
                    {!hasChildMap && linkedBuilding && (
                      <button
                        type="button"
                        data-testid="btn-inspector-generate-interior"
                        disabled={Boolean(job)}
                        onClick={() => {
                          const ctx = resolveGenerationContext(
                            map,
                            [single.id],
                            editParts,
                          );
                          if (!world || !ctx.kind) return;
                          const draft =
                            generationState.getState().drafts[
                              draftKey(world.meta.id, map.id, ctx)
                            ] ?? defaultGenerationDraft(map, ctx);
                          const panelId =
                            viewStore.getState().activeMapPanelId ?? 'map-main';
                          activateMapPanel(panelId, map.id);
                          props.containerApi.getPanel(panelId)?.api.setActive();
                          void generateFromContext(
                            map,
                            ctx,
                            { ...draft, placeId: single.id },
                            panelId,
                          );
                        }}
                      >
                        {job?.mapId === map.id
                          ? 'Generating…'
                          : 'Generate Interior'}
                      </button>
                    )}
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
                        navigateToMap(res.id);
                      }}
                    >
                      {hasChildMap ? 'Open Interior' : 'Create & Open Interior'}
                    </button>
                  </>
                );
              })()}

            {single.type !== 'place' &&
              (() => {
                const linkedPlace = Object.values(map.entities).find(
                  (e): e is PlaceEntity =>
                    e.type === 'place' && e.entityIds.includes(single.id),
                );
                const isSettlementBuilding =
                  map.kind === 'settlement' &&
                  single.type === 'area' &&
                  single.role === 'building';
                if (!isSettlementBuilding && !linkedPlace) return null;
                const hasChildMap = Boolean(
                  linkedPlace?.childMapId && world?.maps[linkedPlace.childMapId],
                );
                const commitPlaceField = (patch: {
                  category?: string;
                  notes?: string;
                  gmNotes?: string;
                }) => {
                  if (linkedPlace) {
                    updateEntity(linkedPlace.id, patch);
                    return;
                  }
                  worldStore.getState().execute('place.create', {
                    mapId: map.id,
                    layerId: single.layerId,
                    name: single.name?.trim() || 'Place',
                    category:
                      patch.category ??
                      (isSettlementBuilding ? 'building' : 'other'),
                    notes: patch.notes ?? '',
                    gmNotes: patch.gmNotes ?? '',
                    entityIds: [single.id],
                  });
                };
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      paddingTop: 6,
                      borderTop: '1px solid var(--atlas-border)',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>Place &amp; Notes</div>
                    <TextField
                      label="Category"
                      list="inspector-place-categories"
                      value={linkedPlace?.category ?? ''}
                      onCommit={(category) => commitPlaceField({ category })}
                    />
                    <TextAreaField
                      label="Notes"
                      value={linkedPlace?.notes ?? ''}
                      onCommit={(notes) => commitPlaceField({ notes })}
                    />
                    <TextAreaField
                      label="GM Notes"
                      value={linkedPlace?.gmNotes ?? ''}
                      onCommit={(gmNotes) => commitPlaceField({ gmNotes })}
                    />
                    {hasChildMap && linkedPlace ? (
                      <button
                        type="button"
                        data-testid="btn-inspector-open-interior"
                        onClick={() => {
                          const res = worldStore
                            .getState()
                            .execute('map.openInterior', {
                              parentMapId: map.id,
                              placeId: linkedPlace.id,
                            }) as { id: string };
                          const vs = viewStore.getState();
                          const targetPanelId = vs.activeMapPanelId ?? 'map-main';
                          vs.setPanelMap(targetPanelId, res.id);
                          vs.setSelection([]);
                          navigateToMap(res.id);
                        }}
                      >
                        Open Interior
                      </button>
                    ) : (
                      <>
                        {isSettlementBuilding && (
                          <button
                            type="button"
                            data-testid="btn-inspector-generate-interior"
                            disabled={Boolean(job)}
                            onClick={() => {
                              const ctx = resolveGenerationContext(
                                map,
                                [single.id],
                                editParts,
                              );
                              if (!world || !ctx.kind) return;
                              const draft =
                                generationState.getState().drafts[
                                  draftKey(world.meta.id, map.id, ctx)
                                ] ?? defaultGenerationDraft(map, ctx);
                              const panelId =
                                viewStore.getState().activeMapPanelId ??
                                'map-main';
                              activateMapPanel(panelId, map.id);
                              props.containerApi
                                .getPanel(panelId)
                                ?.api.setActive();
                              void generateFromContext(
                                map,
                                ctx,
                                {
                                  ...draft,
                                  placeId: linkedPlace?.id ?? draft.placeId,
                                },
                                panelId,
                              );
                            }}
                          >
                            {job?.mapId === map.id
                              ? 'Generating…'
                              : 'Generate Interior'}
                          </button>
                        )}
                        {linkedPlace && (
                          <button
                            type="button"
                            data-testid="btn-inspector-open-interior"
                            onClick={() => {
                              const res = worldStore
                                .getState()
                                .execute('map.openInterior', {
                                  parentMapId: map.id,
                                  placeId: linkedPlace.id,
                                }) as { id: string };
                              const vs = viewStore.getState();
                              const targetPanelId =
                                vs.activeMapPanelId ?? 'map-main';
                              vs.setPanelMap(targetPanelId, res.id);
                              vs.setSelection([]);
                              navigateToMap(res.id);
                            }}
                          >
                            Create &amp; Open Interior
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
          </>
        )}
      </div>
    </div>
  );
}
