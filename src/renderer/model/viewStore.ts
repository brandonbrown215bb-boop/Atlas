import { createStore } from 'zustand/vanilla';
import type { AreaRole, AssetsIndex, MapKind, PathRole } from './schema';
import type { CameraState } from '../render/camera';

export type ToolId =
  | 'select'
  | 'area'
  | 'path'
  | 'pointEdit'
  | 'wall'
  | 'door'
  | 'light'
  | 'label'
  | 'portal'
  | 'developArea';
export type DrawMode = 'click' | 'freehand';
export type PointEditMode = 'edit' | 'add' | 'subtract';
export type DoorKind = 'door' | 'secret';

export interface PanelViewState {
  mapId: string | null;
  camera: CameraState | null;
}

export interface FocusPlaceRequest {
  mapId: string;
  placeId: string;
  nonce: number;
}

export interface ViewStoreState {
  panels: Record<string, PanelViewState>;
  activeMapPanelId: string | null;
  activeTool: ToolId;
  activeLayerId: string | null;
  drawMode: DrawMode;
  pointEditMode: PointEditMode;
  snapToGrid: boolean;
  areaRole: AreaRole;
  pathRole: PathRole;
  pathWidth: number;
  pathClosed: boolean;
  wallSnapToGrid: boolean;
  wallBlocksMove: boolean;
  wallBlocksSight: boolean;
  doorKind: DoorKind;
  lightRadius: number;
  lightColor: string;
  labelText: string;
  labelSize: number;
  portalTargetMapId: string | null;
  developAreaKind: MapKind;
  pendingDevelopRect: {
    mapId: string;
    rect: { x: number; y: number; w: number; h: number };
  } | null;
  selectedEntityIds: string[];
  assetsIndex: AssetsIndex;
  calibratingImageId: string | null;
  showPlaceCategoryOverlay: boolean;
  focusPlaceRequest: FocusPlaceRequest | null;

  setPanelMap: (panelId: string, mapId: string | null) => void;
  setPanelCamera: (panelId: string, camera: CameraState) => void;
  removePanel: (panelId: string) => void;
  setActiveMapPanelId: (panelId: string | null) => void;
  setActiveTool: (tool: ToolId) => void;
  setActiveLayerId: (layerId: string | null) => void;
  setDrawMode: (mode: DrawMode) => void;
  setPointEditMode: (mode: PointEditMode) => void;
  setSnapToGrid: (snap: boolean) => void;
  setAreaRole: (role: AreaRole) => void;
  setPathRole: (role: PathRole) => void;
  setPathWidth: (width: number) => void;
  setPathClosed: (closed: boolean) => void;
  setWallSnapToGrid: (snap: boolean) => void;
  setWallBlocksMove: (blocks: boolean) => void;
  setWallBlocksSight: (blocks: boolean) => void;
  setDoorKind: (kind: DoorKind) => void;
  setLightRadius: (radius: number) => void;
  setLightColor: (color: string) => void;
  setLabelText: (text: string) => void;
  setLabelSize: (size: number) => void;
  setPortalTargetMapId: (mapId: string | null) => void;
  setDevelopAreaKind: (kind: MapKind) => void;
  setPendingDevelopRect: (
    pending: {
      mapId: string;
      rect: { x: number; y: number; w: number; h: number };
    } | null,
  ) => void;
  setSelection: (entityIds: string[]) => void;
  setAssetsIndex: (index: AssetsIndex) => void;
  setCalibratingImageId: (entityId: string | null) => void;
  setShowPlaceCategoryOverlay: (show: boolean) => void;
  requestFocusPlace: (mapId: string, placeId: string) => void;
}

export const viewStore = createStore<ViewStoreState>((set) => ({
  panels: {},
  activeMapPanelId: null,
  activeTool: 'select',
  activeLayerId: null,
  drawMode: 'click',
  pointEditMode: 'edit',
  snapToGrid: false,
  areaRole: 'land',
  pathRole: 'road',
  pathWidth: 2,
  pathClosed: false,
  wallSnapToGrid: true,
  wallBlocksMove: true,
  wallBlocksSight: true,
  doorKind: 'door',
  lightRadius: 10,
  lightColor: '#fde047',
  labelText: 'Label',
  labelSize: 16,
  portalTargetMapId: null,
  developAreaKind: 'settlement',
  pendingDevelopRect: null,
  selectedEntityIds: [],
  assetsIndex: {},
  calibratingImageId: null,
  showPlaceCategoryOverlay: false,
  focusPlaceRequest: null,

  setPanelMap(panelId, mapId) {
    set((state) => {
      const prev = state.panels[panelId];
      const changed = prev?.mapId !== mapId;
      return {
        panels: {
          ...state.panels,
          [panelId]: {
            mapId,
            camera: changed ? null : (prev?.camera ?? null),
          },
        },
      };
    });
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
      return {
        panels: next,
        activeMapPanelId:
          state.activeMapPanelId === panelId ? null : state.activeMapPanelId,
      };
    });
  },

  setActiveMapPanelId(activeMapPanelId) {
    set({ activeMapPanelId });
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

  setWallSnapToGrid(wallSnapToGrid) {
    set({ wallSnapToGrid });
  },

  setWallBlocksMove(wallBlocksMove) {
    set({ wallBlocksMove });
  },

  setWallBlocksSight(wallBlocksSight) {
    set({ wallBlocksSight });
  },

  setDoorKind(doorKind) {
    set({ doorKind });
  },

  setLightRadius(lightRadius) {
    set({ lightRadius });
  },

  setLightColor(lightColor) {
    set({ lightColor });
  },

  setLabelText(labelText) {
    set({ labelText });
  },

  setLabelSize(labelSize) {
    set({ labelSize });
  },

  setPortalTargetMapId(portalTargetMapId) {
    set({ portalTargetMapId });
  },

  setDevelopAreaKind(developAreaKind) {
    set({ developAreaKind });
  },

  setPendingDevelopRect(pendingDevelopRect) {
    set({ pendingDevelopRect });
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

  setShowPlaceCategoryOverlay(showPlaceCategoryOverlay) {
    set({ showPlaceCategoryOverlay });
  },

  requestFocusPlace(mapId, placeId) {
    set((state) => ({
      focusPlaceRequest: {
        mapId,
        placeId,
        nonce: (state.focusPlaceRequest?.nonce ?? 0) + 1,
      },
    }));
  },
}));
