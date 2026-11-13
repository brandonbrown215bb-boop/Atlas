import { createStore } from 'zustand/vanilla';
import type { CameraState } from '../render/camera';

export interface PanelViewState {
  mapId: string | null;
  camera: CameraState | null;
}

export interface ViewStoreState {
  panels: Record<string, PanelViewState>;
  selectedEntityIds: string[];

  setPanelMap: (panelId: string, mapId: string | null) => void;
  setPanelCamera: (panelId: string, camera: CameraState) => void;
  removePanel: (panelId: string) => void;
  setSelection: (entityIds: string[]) => void;
}

export const viewStore = createStore<ViewStoreState>((set) => ({
  panels: {},
  selectedEntityIds: [],

  setPanelMap(panelId, mapId) {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          mapId,
          camera: state.panels[panelId]?.camera ?? null,
        },
      },
    }));
  },

  setPanelCamera(panelId, camera) {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          mapId: state.panels[panelId]?.mapId ?? null,
          camera,
        },
      },
    }));
  },

  removePanel(panelId) {
    set((state) => {
      const next = { ...state.panels };
      delete next[panelId];
      return { panels: next };
    });
  },

  setSelection(entityIds) {
    set({ selectedEntityIds: entityIds });
  },
}));
