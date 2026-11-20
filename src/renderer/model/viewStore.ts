import { createStore } from 'zustand/vanilla';
import type {
  AreaRole,
  AssetsIndex,
  ConnectorKind,
  MapKind,
  PathRole,
  Point,
  RoofShape,
  RouteTier,
  WallKind,
} from './schema';
import type { CameraState } from '../render/camera';
import type { TravelSchedule, TravelSeason } from '../geom/measure';

export type ToolId =
  | 'fog'
  | 'biome'
  | 'landBrush'
  | 'waterBrush'
  | 'select'
  | 'prop'
  | 'area'
  | 'path'
  | 'pointEdit'
  | 'wall'
  | 'door'
  | 'light'
  | 'label'
  | 'portal'
  | 'measure'
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

export interface MeasurementRoute {
  worldId: string;
  mapId: string;
  points: Point[];
  hover: Point | null;
  finished: boolean;
}

export interface ViewStoreState {
  interactionMessage: string;
  diagnosticEntityIds: string[];
  biomeName: string;
  biomeRadius: number;
  biomeErase: boolean;
  geoBrushRadius: number;
  zoomThrough: boolean;
  /** Draw child maps inside their parent (e.g. a region's detail on the world map). */
  showChildMaps: boolean;
  setShowChildMaps: (show: boolean) => void;
  editParts: boolean;
  fitRequest: { panelId: string; bounds?: { x: number; y: number; w: number; h: number }; nonce: number } | null;
  draftUndo: boolean;
  draftRedo: boolean;
  fogMode: 'reveal' | 'los' | 'memory' | 'hide';
  fogRadius: number;
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
  selectedPackAssetId: string | null;
  selectedBuiltin: string | null;
  propScale: number;
  propRotation: number;
  propFlipX: boolean;
  assetError: string;
  calibratingImageId: string | null;
  showPlaceCategoryOverlay: boolean;
  focusPlaceRequest: FocusPlaceRequest | null;
  measurements: Record<string, MeasurementRoute>;
  measureSpeedMph: string;
  measureDeparture: string;
  measureSchedule: TravelSchedule | null;
  measureMarkers: boolean;
  wallKind: WallKind;
  wallBlocksLight: boolean;
  wallBlocksSound: boolean;
  doorLocked: boolean;
  portalConnectorKind: ConnectorKind;
  pathRouteTier: RouteTier;
  roofMode: 'detailed' | 'simple' | 'hidden';
  roofShapePref: RoofShape;
  lightingMode: 'ambient' | 'lights';
  showUndercity: boolean;
  /** Editor-only see-through per layer id (0.1–1), remembered on this computer. */
  layerOpacity: Record<string, number>;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  measureTerrainWeighted: boolean;
  measureSeason: TravelSeason;
  showHorizonRing: boolean;
  blueprintMode: boolean;

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
  setWallKind: (kind: WallKind) => void;
  setWallBlocksLight: (blocks: boolean) => void;
  setWallBlocksSound: (blocks: boolean) => void;
  setDoorKind: (kind: DoorKind) => void;
  setDoorLocked: (locked: boolean) => void;
  setPortalConnectorKind: (kind: ConnectorKind) => void;
  setPathRouteTier: (tier: RouteTier) => void;
  setRoofMode: (mode: 'detailed' | 'simple' | 'hidden') => void;
  setLightingMode: (mode: 'ambient' | 'lights') => void;
  setShowUndercity: (show: boolean) => void;
  setMeasureTerrainWeighted: (enabled: boolean) => void;
  setMeasureSeason: (season: TravelSeason) => void;
  setShowHorizonRing: (show: boolean) => void;
  setBlueprintMode: (enabled: boolean) => void;
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
  setMeasurement: (panelId: string, route: MeasurementRoute | null) => void;
  setMeasureSpeedMph: (speed: string) => void;
  setMeasureDeparture: (departure: string) => void;
  setMeasureSchedule: (schedule: TravelSchedule | null) => void;
  setMeasureMarkers: (show: boolean) => void;
}

export const viewStore = createStore<ViewStoreState>((set, get) => ({
  interactionMessage: '',
  diagnosticEntityIds: [],
  biomeName: 'forest', biomeRadius: 1000, biomeErase: false, geoBrushRadius: 1000,
  zoomThrough: true,
  showChildMaps: (() => { try { return localStorage.getItem('atlas.showChildMaps') !== 'false'; } catch { return true; } })(),
  editParts: false,
  fitRequest: null,
  draftUndo: false,
  draftRedo: false,
  fogMode: 'reveal',
  fogRadius: 3,
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
  selectedPackAssetId: null,
  selectedBuiltin: null,
  propScale: 1,
  propRotation: 0,
  propFlipX: false,
  assetError: '',
  calibratingImageId: null,
  showPlaceCategoryOverlay: false,
  focusPlaceRequest: null,
  measurements: {},
  measureSpeedMph: '3',
  measureDeparture: '08:00',
  measureSchedule: null,
  measureMarkers: false,
  wallKind: 'solid',
  wallBlocksLight: true,
  wallBlocksSound: true,
  doorLocked: false,
  portalConnectorKind: 'portal',
  pathRouteTier: 'road',
  roofMode: 'detailed',
  roofShapePref: 'gable',
  lightingMode: 'ambient',
  showUndercity: false,
  layerOpacity: (() => { try { return JSON.parse(localStorage.getItem('atlas.layerOpacity') ?? '{}') as Record<string, number>; } catch { return {}; } })(),
  measureTerrainWeighted: true,
  measureSeason: 'summer',
  showHorizonRing: false,
  blueprintMode: false,

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
      const measurements = { ...state.measurements };
      delete measurements[panelId];
      return {
        panels: next,
        measurements,
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

  setWallKind(wallKind) {
    set({ wallKind });
  },

  setWallBlocksLight(wallBlocksLight) {
    set({ wallBlocksLight });
  },

  setWallBlocksSound(wallBlocksSound) {
    set({ wallBlocksSound });
  },

  setDoorKind(doorKind) {
    set({ doorKind });
  },

  setDoorLocked(doorLocked) {
    set({ doorLocked });
  },

  setPortalConnectorKind(portalConnectorKind) {
    set({ portalConnectorKind });
  },

  setPathRouteTier(pathRouteTier) {
    set({ pathRouteTier });
  },

  setRoofMode(roofMode) {
    set({ roofMode });
  },

  setLightingMode(lightingMode) {
    set({ lightingMode });
  },

  setShowUndercity(showUndercity) {
    set({ showUndercity });
  },

  setShowChildMaps(showChildMaps) {
    set({ showChildMaps });
    try { localStorage.setItem('atlas.showChildMaps', String(showChildMaps)); } catch { /* per-computer nicety only */ }
  },

  setLayerOpacity(layerId, opacity) {
    const layerOpacity = { ...get().layerOpacity, [layerId]: opacity };
    set({ layerOpacity });
    try { localStorage.setItem('atlas.layerOpacity', JSON.stringify(layerOpacity)); } catch { /* per-computer nicety only */ }
  },

  setMeasureTerrainWeighted(measureTerrainWeighted) {
    set({ measureTerrainWeighted });
  },

  setMeasureSeason(measureSeason) {
    set({ measureSeason });
  },

  setShowHorizonRing(showHorizonRing) {
    set({ showHorizonRing });
  },

  setBlueprintMode(blueprintMode) {
    set({ blueprintMode });
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
  setMeasurement(panelId, route) {
    set((state) => {
      const measurements = { ...state.measurements };
      if (route) measurements[panelId] = route;
      else delete measurements[panelId];
      return { measurements };
    });
  },
  setMeasureSpeedMph(measureSpeedMph) { set({ measureSpeedMph }); },
  setMeasureDeparture(measureDeparture) { set({ measureDeparture }); },
  setMeasureSchedule(measureSchedule) { set({ measureSchedule }); },
  setMeasureMarkers(measureMarkers) { set({ measureMarkers }); },
}));
