import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import { filterPlaces, listPlaceCategories } from '../geom/places';
import type { PlaceEntity } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { PanelHeaderBar } from './PanelHeaderBar';

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

export function PlacesPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const selectedIds = useStore(viewStore, (s) => s.selectedEntityIds);
  const activeLayerId = useStore(viewStore, (s) => s.activeLayerId);
  const showOverlay = useStore(viewStore, (s) => s.showPlaceCategoryOverlay);

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
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
      <PanelHeaderBar title="Places" panelProps={props} />

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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
