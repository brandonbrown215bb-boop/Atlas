import { createStore } from 'zustand/vanilla';
import type { AreaRole, AssetsIndex, PathRole } from './schema';
import type { CameraState } from '../render/camera';

export type ToolId = 'select' | 'area' | 'path' | 'pointEdit';
export type DrawMode = 'click' | 'freehand';
export type PointEditMode = 'edit' | 'add' | 'subtract';

export interface PanelViewState {
  mapId: string | null;
  camera: CameraState | null;
}

export interface ViewStoreState {
  panels: Record<string, PanelViewState>;
  activeTool: ToolId;
  activeLayerId: string | null;
  drawMode: DrawMode;
  pointEditMode: PointEditMode;
  snapToGrid: boolean;
  areaRole: AreaRole;
  pathRole: PathRole;
  pathWidth: number;
  pathClosed: boolean;
  selectedEntityIds: string[];
  assetsIndex: AssetsIndex;
  calibratingImageId: string | null;

  setPanelMap: (panelId: string, mapId: string | null) => void;
  setPanelCamera: (panelId: string, camera: CameraState) => void;
  removePanel: (panelId: string) => void;
  setActiveTool: (tool: ToolId) => void;
  setActiveLayerId: (layerId: string | null) => void;
  setDrawMode: (mode: DrawMode) => void;
  setPointEditMode: (mode: PointEditMode) => void;
  setSnapToGrid: (snap: boolean) => void;
  setAreaRole: (role: AreaRole) => void;
  setPathRole: (role: PathRole) => void;
  setPathWidth: (width: number) => void;
  setPathClosed: (closed: boolean) => void;
  setSelection: (entityIds: string[]) => void;
  setAssetsIndex: (index: AssetsIndex) => void;
  setCalibratingImageId: (entityId: string | null) => void;
}

export const viewStore = createStore<ViewStoreState>((set) => ({
  panels: {},
  activeTool: 'select',
  activeLayerId: null,
  drawMode: 'click',
  pointEditMode: 'edit',
  snapToGrid: false,
  areaRole: 'land',
  pathRole: 'road',
  pathWidth: 2,
  pathClosed: false,
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

  setActiveLayerId(layerId) {
    set({ activeLayerId: layerId });
  },

  setDrawMode(drawMode) {
    set({ drawMode });
  },

  setPointEditMode(pointEditMode) {
    set({ pointEditMode });
  },

  setSnapToGrid(snapToGrid) {
    set({ snapToGrid });
  },

  setAreaRole(areaRole) {
    set({ areaRole });
  },

  setPathRole(pathRole) {
    set({ pathRole });
  },

  setPathWidth(pathWidth) {
    set({ pathWidth });
  },

  setPathClosed(pathClosed) {
    set({ pathClosed });
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
