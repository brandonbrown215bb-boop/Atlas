import { createStore } from 'zustand/vanilla';
import type { AssetsIndex } from './schema';
import type { CameraState } from '../render/camera';

export type ToolId = 'select';

export interface PanelViewState {
  mapId: string | null;
  camera: CameraState | null;
}

export interface ViewStoreState {
  panels: Record<string, PanelViewState>;
  activeTool: ToolId;
  selectedEntityIds: string[];
  assetsIndex: AssetsIndex;
  calibratingImageId: string | null;

  setPanelMap: (panelId: string, mapId: string | null) => void;
  setPanelCamera: (panelId: string, camera: CameraState) => void;
  removePanel: (panelId: string) => void;
  setActiveTool: (tool: ToolId) => void;
  setSelection: (entityIds: string[]) => void;
  setAssetsIndex: (index: AssetsIndex) => void;
  setCalibratingImageId: (entityId: string | null) => void;
}

export const viewStore = createStore<ViewStoreState>((set) => ({
  panels: {},
  activeTool: 'select',
  selectedEntityIds: [],
  assetsIndex: {},
  calibratingImageId: null,

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

  setActiveTool(tool) {
    set({ activeTool: tool });
  },

  setSelection(entityIds) {
    set({ selectedEntityIds: entityIds });
  },

  setAssetsIndex(index) {
    set({ assetsIndex: index });
  },

  setCalibratingImageId(entityId) {
    set({ calibratingImageId: entityId });
  },
}));
