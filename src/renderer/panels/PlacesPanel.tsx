import { activateMapPanel, navigateToMap } from '../model/navigation';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { hudStore } from '../app/hudStore';
import { settlementServiceAudit } from '../gen/city/diagnostics';
import { filterPlaces, listPlaceCategories } from '../geom/places';
import { resolveGenerationContext } from '../model/generationContext';
import {
  defaultGenerationDraft,
  draftKey,
  generateFromContext,
  generationState,
} from '../model/generationState';
import type { Entity, PlaceEntity } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

function PlaceTextField(props: {
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color: 'var(--atlas-text-muted)' }}>{props.label}</span>
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
      />
    </label>
  );
}

function PlaceTextArea(props: {
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color: 'var(--atlas-text-muted)' }}>{props.label}</span>
      <textarea
        rows={3}
        data-testid={props.testId}
        placeholder={props.placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            commit();
          }
        }}
        style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
      />
    </label>
  );
}

export function PlacesPanel({ panelId = 'places' }: { panelId?: string }) {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const selectedIds = useStore(viewStore, (s) => s.selectedEntityIds);
  const editParts = useStore(viewStore, (s) => s.editParts);
  const activeLayerId = useStore(viewStore, (s) => s.activeLayerId);
  const showOverlay = useStore(viewStore, (s) => s.showPlaceCategoryOverlay);
  const roofMode = useStore(viewStore, (s) => s.roofMode);
  const showUndercity = useStore(viewStore, (s) => s.showUndercity);
  const job = useStore(generationState, (s) => s.job);

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newRumour, setNewRumour] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const map = activeMapId && world ? world.maps[activeMapId] : undefined;
  const allPlaces: PlaceEntity[] = map
    ? Object.values(map.entities)
        .filter((e): e is PlaceEntity => e.type === 'place')
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const categories = listPlaceCategories(allPlaces);
  const filteredPlaces = filterPlaces(allPlaces, searchQuery, categoryFilter);

  const selectedNonPlaceIds = map
    ? selectedIds.filter((id) => {
        const ent = map.entities[id];
        return Boolean(ent && ent.type !== 'place');
      })
    : [];

  const selectedPlace: PlaceEntity | null =
    map && selectedIds.length === 1 && map.entities[selectedIds[0]!]?.type === 'place'
      ? (map.entities[selectedIds[0]!] as PlaceEntity)
      : null;

  const handleCreatePlace = () => {
    if (!map) return;
    const trimmedName = newName.trim();
    if (!trimmedName || selectedNonPlaceIds.length === 0) return;

    const layerId =
      activeLayerId && map.layers.some((l) => l.id === activeLayerId)
        ? activeLayerId
        : map.layers[0]?.id;
    if (!layerId) return;

    const res = worldStore.getState().execute('place.create', {
      mapId: map.id,
      layerId,
      name: trimmedName,
      category: newCategory.trim(),
      notes: '',
      gmNotes: '',
      entityIds: selectedNonPlaceIds,
    }) as { id: string };

    setNewName('');
    setNewCategory('');
    viewStore.getState().setSelection([res.id]);
    viewStore.getState().requestFocusPlace(map.id, res.id);
  };

  const handleChoosePlace = (place: PlaceEntity) => {
    if (!map) return;
    viewStore.getState().setSelection([place.id]);
    viewStore.getState().requestFocusPlace(map.id, place.id);
  };

  const updatePlace = (placeId: string, patch: Record<string, unknown>) => {
    if (!map) return;
    worldStore.getState().execute('entity.update', {
      mapId: map.id,
      entityId: placeId,
      patch,
    });
  };

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
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {!map ? (
          <div style={{ color: 'var(--atlas-text-muted)' }}>No map open.</div>
        ) : (
          <>
            {map.kind === 'settlement' && (() => {
              const audit = settlementServiceAudit(map);
              return (
                <div
                  data-testid="settlement-service-audit"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 8,
                    border: '1px solid var(--atlas-border)',
                    borderRadius: 4,
                    background: 'var(--atlas-surface)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>OSE Services ({audit.presentCount}/5)</strong>
                    <span style={{ fontSize: 11, color: audit.complete ? '#22c55e' : '#f59e0b' }}>
                      {audit.complete ? 'All present' : `Missing: ${audit.missing.length}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {audit.services.map((svc) => (
                      <span
                        key={svc.key}
                        style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 3,
                          border: '1px solid var(--atlas-border)',
                          background: svc.present ? '#14532d66' : '#78350f66',
                          color: svc.present ? '#86efac' : '#fde68a',
                        }}
                      >
                        {svc.present ? '✓' : '○'} {svc.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                    <span>Roofs:</span>
                    {(['detailed', 'simple', 'hidden'] as const).map((rm) => (
                      <button
                        key={rm}
                        type="button"
                        onClick={() => viewStore.getState().setRoofMode(rm)}
                        style={{
                          padding: '2px 6px',
                          fontSize: 11,
                          fontWeight: roofMode === rm ? 700 : 400,
                          borderColor: roofMode === rm ? 'var(--atlas-accent)' : 'var(--atlas-border)',
                        }}
                      >
                        {rm}
                      </button>
                    ))}
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                      <input
                        type="checkbox"
                        checked={showUndercity}
                        onChange={(e) => viewStore.getState().setShowUndercity(e.target.checked)}
                      />
                      Undercity
                    </label>
                  </div>
                </div>
              );
            })()}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                border: '1px solid var(--atlas-border)',
                borderRadius: 4,
                background: 'var(--atlas-surface)',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                Create from Selection ({selectedNonPlaceIds.length} selected)
              </div>
              <input
                type="text"
                data-testid="place-create-name"
                placeholder="Place name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreatePlace();
                }}
              />
              <input
                type="text"
                data-testid="place-create-category"
                placeholder="Category (e.g. Tavern, Shop)..."
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreatePlace();
                }}
              />
              <button
                type="button"
                data-testid="btn-create-place"
                disabled={
                  newName.trim().length === 0 || selectedNonPlaceIds.length === 0
                }
                onClick={handleCreatePlace}
              >
                Create Place
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                type="text"
                data-testid="places-search"
                placeholder="Search places..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                data-testid="places-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  data-testid="toggle-place-overlay"
                  checked={showOverlay}
                  onChange={(e) =>
                    viewStore.getState().setShowPlaceCategoryOverlay(e.target.checked)
                  }
                />
                <span>Show category labels on map</span>
              </label>
            </div>

            <div
              data-testid="places-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {filteredPlaces.length === 0 ? (
                <div style={{ color: 'var(--atlas-text-muted)' }}>
                  No matching places.
                </div>
              ) : (
                filteredPlaces.map((place) => {
                  const isSelected = selectedPlace?.id === place.id;
                  return (
                    <div
                      key={place.id}
                      data-testid={`place-item-${place.id}`}
                      onClick={() => handleChoosePlace(place)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        border: isSelected
                          ? '1px solid var(--atlas-accent)'
                          : '1px solid var(--atlas-border)',
                        background: isSelected
                          ? 'var(--atlas-surface)'
                          : 'transparent',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {place.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--atlas-text-muted)' }}>
                          {place.category ? `${place.category} · ` : ''}
                          {place.entityIds.length} linked
                          {place.gmOnly ? ' · GM' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`btn-delete-place-${place.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          worldStore.getState().execute('entity.delete', {
                            mapId: map.id,
                            entityId: place.id,
                          });
                          if (isSelected) {
                            viewStore.getState().setSelection([]);
                          }
                        }}
                      >
                        Del
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {selectedPlace && (
              <div
                data-testid="place-editor"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 8,
                  border: '1px solid var(--atlas-border)',
                  borderRadius: 4,
                  background: 'var(--atlas-surface)',
                }}
              >
                <div style={{ fontWeight: 600 }}>Place Details</div>
                <PlaceTextField
                  label="Name"
                  testId="place-edit-name"
                  value={selectedPlace.name}
                  onCommit={(name) => {
                    if (name.trim().length > 0) {
                      updatePlace(selectedPlace.id, { name: name.trim() });
                    }
                  }}
                />
                <PlaceTextField
                  label="Category"
                  testId="place-edit-category"
                  value={selectedPlace.category}
                  onCommit={(category) =>
                    updatePlace(selectedPlace.id, { category: category.trim() })
                  }
                />
                <PlaceTextArea
                  label="Notes"
                  testId="place-edit-notes"
                  placeholder="Player-visible notes..."
                  value={selectedPlace.notes}
                  onCommit={(notes) => updatePlace(selectedPlace.id, { notes })}
                />
                <PlaceTextArea
                  label="GM Notes"
                  testId="place-edit-gm-notes"
                  placeholder="GM-only notes..."
                  value={selectedPlace.gmNotes}
                  onCommit={(gmNotes) =>
                    updatePlace(selectedPlace.id, { gmNotes })
                  }
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    data-testid="place-edit-gm-only"
                    checked={Boolean(selectedPlace.gmOnly)}
                    onChange={(e) =>
                      updatePlace(selectedPlace.id, { gmOnly: e.target.checked })
                    }
                  />
                  <span>GM Only</span>
                </label>

                <div style={{ fontWeight: 600, fontSize: 11, marginTop: 4, color: 'var(--atlas-text-muted)' }}>
                  Urbancrawl Metadata
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ color: 'var(--atlas-text-muted)' }}>District Layer Tier</span>
                  <select
                    data-testid="place-edit-layer-tier"
                    value={selectedPlace.layerTier ?? ''}
                    onChange={(e) =>
                      updatePlace(selectedPlace.id, {
                        layerTier: (e.target.value || undefined) as PlaceEntity['layerTier'],
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    <option value="incidental">Incidental</option>
                    <option value="focus">Focus</option>
                    <option value="belligerent">Belligerent</option>
                  </select>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ color: 'var(--atlas-text-muted)' }}>Active Hours</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(
                      [
                        ['morning', 'M'],
                        ['day', 'D'],
                        ['evening', 'E'],
                        ['night', 'N'],
                      ] as const
                    ).map(([slot, tag]) => {
                      const active = Boolean(selectedPlace.activeHours?.[slot]);
                      return (
                        <button
                          key={slot}
                          type="button"
                          title={slot}
                          data-testid={`place-hour-${slot}`}
                          onClick={() =>
                            updatePlace(selectedPlace.id, {
                              activeHours: {
                                ...selectedPlace.activeHours,
                                [slot]: !active,
                              },
                            })
                          }
                          style={{
                            flex: 1,
                            fontSize: 11,
                            fontWeight: active ? 700 : 400,
                            borderColor: active ? 'var(--atlas-accent)' : 'var(--atlas-border)',
                          }}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <PlaceTextField
                  label="Factions (comma-separated)"
                  testId="place-edit-factions"
                  value={(selectedPlace.factionLinks ?? []).join(', ')}
                  placeholder="Thieves Guild, City Watch"
                  onCommit={(val) =>
                    updatePlace(selectedPlace.id, {
                      factionLinks: val
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <PlaceTextField
                  label="Clue / Next Lead"
                  testId="place-edit-clue-next"
                  value={selectedPlace.clueNext ?? ''}
                  placeholder="Points toward Dockside Warehouse #4"
                  onCommit={(clueNext) => updatePlace(selectedPlace.id, { clueNext })}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ color: 'var(--atlas-text-muted)' }}>
                    Rumour Bin ({(selectedPlace.rumours ?? []).length})
                  </span>
                  {(selectedPlace.rumours ?? []).map((r, rIdx) => (
                    <div key={rIdx} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
                      <span style={{ flex: 1 }}>• {r}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updatePlace(selectedPlace.id, {
                            rumours: (selectedPlace.rumours ?? []).filter((_, j) => j !== rIdx),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="text"
                      data-testid="place-add-rumour-input"
                      placeholder="Add local rumour..."
                      value={newRumour}
                      onChange={(e) => setNewRumour(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newRumour.trim()) {
                          updatePlace(selectedPlace.id, {
                            rumours: [...(selectedPlace.rumours ?? []), newRumour.trim()],
                          });
                          setNewRumour('');
                        }
                      }}
                    />
                    <button
                      type="button"
                      data-testid="place-add-rumour-btn"
                      onClick={() => {
                        if (!newRumour.trim()) return;
                        updatePlace(selectedPlace.id, {
                          rumours: [...(selectedPlace.rumours ?? []), newRumour.trim()],
                        });
                        setNewRumour('');
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
                {(() => {
                  const linkedBuilding =
                    map.kind === 'settlement'
                      ? selectedPlace.entityIds
                          .map((id) => map.entities[id])
                          .find(
                            (e): e is Entity =>
                              Boolean(e) &&
                              e!.type === 'area' &&
                              e!.role === 'building',
                          )
                      : undefined;
                  const hasChildMap = Boolean(
                    selectedPlace.childMapId &&
                      world?.maps[selectedPlace.childMapId],
                  );
                  return (
                    <>
                      {linkedBuilding && !hasChildMap && (
                        <button
                          type="button"
                          data-testid="btn-generate-place-interior"
                          disabled={Boolean(job)}
                          onClick={() => {
                            const ctx = resolveGenerationContext(
                              map,
                              [selectedPlace.id],
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
                            hudStore.getState().openOrFocusPanel('inspector');
                            void generateFromContext(
                              map,
                              ctx,
                              { ...draft, placeId: selectedPlace.id },
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
                        data-testid="btn-open-interior"
                        onClick={() => {
                          const res = worldStore
                            .getState()
                            .execute('map.openInterior', {
                              parentMapId: map.id,
                              placeId: selectedPlace.id,
                            }) as { id: string };
                          const vs = viewStore.getState();
                          const targetPanelId =
                            vs.activeMapPanelId ?? 'map-main';
                          vs.setPanelMap(targetPanelId, res.id);
                          vs.setSelection([]);
                          navigateToMap(res.id);
                          hudStore.getState().openOrFocusPanel('inspector');
                        }}
                      >
                        {hasChildMap ? 'Open Interior' : 'Create & Open Interior'}
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
