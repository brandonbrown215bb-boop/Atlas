import { createBiomeTool } from '../tools/biomeTool';
import { createGeographyBrushTool } from '../tools/geographyBrushTool';
import { editorHistory, registerDrawingHistory } from '../model/drawingHistory';
import { resolveGenerationContext } from '../model/generationContext';
import {
  defaultGenerationDraft,
  draftKey,
  generationState,
  generateFromContext,
} from '../model/generationState';
import { activateMapPanel, navigateToMap } from '../model/navigation';
import { extentLabel, distanceLabel } from '../model/mapDefaults';
import { geographicEntities } from '../geom/geography';
import { getSelectionBounds } from '../geom/hitTest';
import { createFogTool } from '../tools/fogTool';
import { drawFog } from './drawFog';
import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import { mapBackdropStyle } from './backdrop';
import { drawRoomLightingOverlay } from './lighting';
import { getProceduralTexture } from './proceduralTextures';
import { useStore } from 'zustand';
import type { Entity, MapDoc, Point } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import {
  centerCameraOnPoint,
  fitBoundsCamera,
  screenToMap,
  zoomAtCursor,
  type CameraState,
} from './camera';
import {
  childMapParentRect,
  childToParentCamera,
  findZoomInChild,
  parentToChildCamera,
  shouldDrawChildInline,
  shouldZoomOutToParent,
} from '../geom/childMaps';
import { getPlaceBounds, getPlaceCenter } from '../geom/places';
import {
  hasParentChanged,
  type KeptEditedEntityInfo,
} from '../geom/pullFromParent';
import { buildEntityDisplay, buildPathOutlineOverlay, buildWallNetworkOverlay, createWallHatchTest } from './drawEntity';
import {
  getCachedAssetTexture,
  loadAssetTexture,
  resolveWorldAssetUrl,
  entityAssetId,
  updateTextureUsage,
} from './textures';
import { boxesIntersect, getEntityBounds } from '../geom/hitTest';
import { createAreaTool } from '../tools/areaTool';
import { createDevelopAreaTool } from '../tools/developAreaTool';
import { openGenerationSettings } from '../panels/GenerationControls';
import { createDoorTool } from '../tools/doorTool';
import { createLabelTool } from '../tools/labelTool';
import { createLightTool } from '../tools/lightTool';
import { createMeasureTool } from '../tools/measureTool';
import { createPathTool } from '../tools/pathTool';
import { createPointEditTool } from '../tools/pointEditTool';
import { createPortalTool } from '../tools/portalTool';
import { createSelectTool } from '../tools/selectTool';
import { createWallTool } from '../tools/wallTool';
import { createPropTool } from '../tools/propTool';
import type { MapTool, ToolContext } from '../tools/types';

export interface MapViewProps {
  panelId: string;
  mapId?: string;
  isMainMap?: boolean;
  isPopout?: boolean;
}

interface CachedEntityDisplay {
  rev: number;
  selected: boolean;
  layerId: string;
  layerGmOnly: boolean;
  hasTexture: boolean;
  wasPreview: boolean;
  roofMode?: 'detailed' | 'simple' | 'hidden';
  container: Container;
}

export function MapView(props: MapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [locationEpoch, setLocationEpoch] = useState(0);
  const isPopout = Boolean(props.isPopout);
  const [liveDimensions,setLiveDimensions]=useState('');
  const [renderCount, setRenderCount] = useState(0);

  const interactionMessage=useStore(viewStore,s=>s.interactionMessage);
  const diagnosticEntityIds = useStore(viewStore,s=>s.diagnosticEntityIds);
  const zoomThrough = useStore(viewStore, s => s.zoomThrough);
  const editParts = useStore(viewStore, s => s.editParts);
  const fitRequest = useStore(viewStore, s => s.fitRequest);
  const roofMode = useStore(viewStore, s => s.roofMode);
  const lightingMode = useStore(viewStore, s => s.lightingMode);
  const showUndercity = useStore(viewStore, s => s.showUndercity);
  const showHorizonRing = useStore(viewStore, s => s.showHorizonRing);
  const blueprintMode = useStore(viewStore, s => s.blueprintMode);
  const world = useStore(worldStore, (s) => s.world);
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const panelState = useStore(viewStore, (s) => s.panels[props.panelId]);
  const activeToolId = useStore(viewStore, (s) => s.activeTool);
  const selectedIds = useStore(viewStore, (s) => s.selectedEntityIds);
  const assetsIndex = useStore(viewStore, (s) => s.assetsIndex);
  const calibratingImageId = useStore(viewStore, (s) => s.calibratingImageId);
  const showPlaceCategoryOverlay = useStore(
    viewStore,
    (s) => s.showPlaceCategoryOverlay,
  );
  const focusPlaceRequest = useStore(viewStore, (s) => s.focusPlaceRequest);
  const activeMapPanelId = useStore(viewStore, (s) => s.activeMapPanelId);
  const pendingDevelopRect = useStore(viewStore, (s) => s.pendingDevelopRect);
  const measurement = useStore(viewStore, (s) => s.measurements[props.panelId]);
  const measureSchedule = useStore(viewStore, s => s.measureSchedule);
  const measureMarkers = useStore(viewStore, s => s.measureMarkers);
  const measureSpeed = useStore(viewStore, s => s.measureSpeedMph);
  const measureDeparture = useStore(viewStore, s => s.measureDeparture);

  const [calibLine, setCalibLine] = useState<{
    start: Point;
    end: Point;
    pendingConfirm: boolean;
  } | null>(null);
  const [calibLengthInput, setCalibLengthInput] = useState('100');
  const [calibUnit, setCalibUnit] = useState<'ft' | 'mi' | 'm'>('ft');
  const [textureVersion, setTextureVersion] = useState(0);
  const [pullReport, setPullReport] = useState<KeptEditedEntityInfo[] | null>(
    null,
  );

  const effectiveMapId = panelState?.mapId ?? props.mapId ?? activeMapId;
  const map: MapDoc | undefined =
    effectiveMapId && world ? world.maps[effectiveMapId] : undefined;

  const mapRef = useRef<MapDoc | undefined>(map);
  mapRef.current = map;
  const worldRef = useRef(world);
  worldRef.current = world;
  const worldPathRef = useRef<string | null>(worldPath);
  worldPathRef.current = worldPath;
  const assetsIndexRef = useRef(assetsIndex);
  assetsIndexRef.current = assetsIndex;
  const calibratingIdRef = useRef<string | null>(calibratingImageId);
  calibratingIdRef.current = calibratingImageId;
  const selectedSetRef = useRef<Set<string>>(new Set(selectedIds));
  selectedSetRef.current = new Set(selectedIds);
  const activeToolIdRef = useRef(activeToolId);
  activeToolIdRef.current = activeToolId;
  const showPlaceCategoryOverlayRef = useRef(showPlaceCategoryOverlay);
  showPlaceCategoryOverlayRef.current = showPlaceCategoryOverlay;

  const scheduleRenderRef = useRef<(() => void) | null>(null);
  const syncSceneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!viewStore.getState().activeMapPanelId || props.isMainMap) {
      activateMapPanel(props.panelId, mapRef.current?.id);
    }
  }, [props.panelId, props.isMainMap]);

  const prevPopoutRef = useRef(isPopout);
  useEffect(() => {
    if (prevPopoutRef.current !== isPopout) {
      prevPopoutRef.current = isPopout;
      setLocationEpoch((n) => n + 1);
    }
  }, [isPopout]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const ownerDoc = host.ownerDocument;
    const ownerWin = ownerDoc.defaultView;
    if (!ownerWin) {
      return;
    }

    const canvas = ownerDoc.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.tabIndex = 0;
    host.replaceChildren(canvas);

    let disposed = false;
    let rafId: number | null = null;
    let dirty = false;

    const app = new Application();
    const worldLayer = new Container();
    worldLayer.eventMode = 'none';
    const gridGfx = new Graphics();
    gridGfx.eventMode = 'none';
    const underlayGfx = new Graphics();
    underlayGfx.eventMode = 'none';
    const entitiesRoot = new Container();
    entitiesRoot.eventMode = 'none';
    const childMapsContainer = new Container();
    childMapsContainer.eventMode = 'none';
    const placeOverlayContainer = new Container();
    placeOverlayContainer.eventMode = 'none';
    const overlayGfx = new Graphics();
    overlayGfx.eventMode = 'none';
    const measureGfx = new Graphics();
    measureGfx.eventMode = 'none';

    const contentMask = new Graphics();
    const lightingGfx = new Graphics();
    lightingGfx.eventMode = 'none';
    const fogGfx = new Graphics();
    let backdropSprite: TilingSprite | null = null;
    let grainSprite: TilingSprite | null = null;
    let vignetteSprite: Sprite | null = null;
    const biomeTool = createBiomeTool();
    const landBrushTool = createGeographyBrushTool('land');
    const waterBrushTool = createGeographyBrushTool('water');
    const fogTool = createFogTool();
    const selectTool = createSelectTool();
    const propTool = createPropTool();
    const areaTool = createAreaTool();
    const pathTool = createPathTool();
    const pointEditTool = createPointEditTool();
    const wallTool = createWallTool();
    const doorTool = createDoorTool();
    const lightTool = createLightTool();
    const labelTool = createLabelTool();
    const portalTool = createPortalTool();
    const developAreaTool = createDevelopAreaTool();
    const measureTool = createMeasureTool();
    const getActiveTool = (): MapTool => {
      switch (activeToolIdRef.current) {
        case 'biome': return biomeTool;
        case 'landBrush': return landBrushTool;
        case 'waterBrush': return waterBrushTool;
        case 'fog': return fogTool;
        case 'prop': return propTool;
        case 'area':
          return areaTool;
        case 'path':
          return pathTool;
        case 'pointEdit':
          return pointEditTool;
        case 'wall':
          return wallTool;
        case 'door':
          return doorTool;
        case 'light':
          return lightTool;
        case 'label':
          return labelTool;
        case 'portal':
          return portalTool;
        case 'developArea':
          return developAreaTool;
        case 'measure':
          return measureTool;
        default:
          return selectTool;
      }
    };

    const layerContainers = new Map<string, Container>();
    const entityCache = new Map<string, CachedEntityDisplay>();
    const textureOwner = {};

    let panning = false;
    let spaceHeld = false;
    let lastX = 0;
    let lastY = 0;
    let lastZoomForRebuild = 0;

    const getCamera = (): CameraState => {
      const stored = viewStore.getState().panels[props.panelId]?.camera;
      if (stored) {
        return stored;
      }
      const m = mapRef.current;
      if (!m) {
        return { x: 0, y: 0, zoom: 1 };
      }
      const initial = fitBoundsCamera(
        m.bounds,
        Math.max(1, host.clientWidth),
        Math.max(1, host.clientHeight),
        m.kind,
      );
      // Restored tabs can initialize before Dockview gives them any space.
      // Don't keep the temporary one-pixel fit as the user's actual camera.
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        viewStore.getState().setPanelCamera(props.panelId, initial);
      }
      return initial;
    };

    const drawGrid = (m: MapDoc, cam: CameraState) => {
      gridGfx.clear();
      if (!m.grid.visible || m.grid.size <= 0) {
        return;
      }
      const step = m.grid.size;
      const pxStep = step * cam.zoom;
      if (pxStep < 6) {
        return;
      }
      const { x, y, w, h } = m.bounds;
      const strokeW = Math.max(0.05, 1 / cam.zoom);
      for (let gx = x; gx <= x + w; gx += step) {
        gridGfx.moveTo(gx, y).lineTo(gx, y + h);
      }
      for (let gy = y; gy <= y + h; gy += step) {
        gridGfx.moveTo(x, gy).lineTo(x + w, gy);
      }
      gridGfx.stroke({ width: strokeW, color: 0x4b5563, alpha: 0.4 });
    };

    const buildToolContext = (m: MapDoc): ToolContext => ({
      panelId: props.panelId,
      worldId: worldRef.current?.meta.id ?? '',
      map: m,
      camera: getCamera(),
      getSelectedIds: () => viewStore.getState().selectedEntityIds,
      setSelectedIds: (ids) => viewStore.getState().setSelection(ids),
      execute: (name, input) => worldStore.getState().execute(name, input),
      executeBatch: (calls, label) =>
        worldStore.getState().executeBatch(calls, label),
      requestRedraw: () => {
        syncScene();
        scheduleRender();
      },
    });

    const unregisterHistory = registerDrawingHistory(props.panelId, redo => {
      const m = mapRef.current;
      if (!m) return false;
      const handled = getActiveTool().onKey({ key: redo ? 'y' : 'z', ctrlKey: true, preventDefault() {} } as KeyboardEvent, buildToolContext(m));
      syncScene(); scheduleRender(); return handled;
    });
    let lastToolMap = `${worldRef.current?.meta.id}:${mapRef.current?.id}`;
    const syncScene = () => {
      const toolMap=`${worldRef.current?.meta.id}:${mapRef.current?.id}`;
      if(toolMap!==lastToolMap&&mapRef.current){
        lastToolMap=toolMap;
        for (const cached of entityCache.values()) cached.container.destroy({ children: true });
        entityCache.clear();
        const e={key:'Escape',preventDefault(){}} as KeyboardEvent;const ctx={...buildToolContext(mapRef.current),requestRedraw(){}};for(const tool of [areaTool,pathTool,wallTool,pointEditTool,biomeTool,developAreaTool])tool.onKey(e,ctx);
      }
      const live=getActiveTool().extentPreview?.();setLiveDimensions(live?extentLabel(live):'');
      if (viewStore.getState().activeMapPanelId === props.panelId) {
        const d = getActiveTool().draftState?.() ?? { undo: false, redo: false };
        if (viewStore.getState().draftUndo !== d.undo || viewStore.getState().draftRedo !== d.redo) viewStore.setState({ draftUndo: d.undo, draftRedo: d.redo });
      }
      if (disposed || !app.renderer || host.clientWidth <= 0 || host.clientHeight <= 0) {
        return;
      }
      const m = mapRef.current;
      if (!m) {
        entitiesRoot.removeChildren();
        childMapsContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
        placeOverlayContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
        fogGfx.clear();
        lightingGfx.clear();
        gridGfx.clear();
        underlayGfx.clear();
        overlayGfx.clear();
        measureGfx.clear();
        for (const cached of entityCache.values()) cached.container.destroy({ children: true });
        entityCache.clear();
        updateTextureUsage(textureOwner, new Set());
        return;
      }

      const cam = getCamera();
      const {
        roofMode: currentRoofMode,
        lightingMode: currentLightingMode,
        showUndercity: currentShowUndercity,
      } = viewStore.getState();

      // Live optical backdrop, texture & vignette parity with export
      const backdrop = mapBackdropStyle(m);
      app.renderer.background.color = backdrop.color;
      if (backdropSprite) {
        const bTex = getProceduralTexture(backdrop.texKind);
        if (bTex) {
          if (backdropSprite.texture !== bTex) backdropSprite.texture = bTex;
          backdropSprite.visible = true;
          backdropSprite.alpha = backdrop.texAlpha;
          backdropSprite.width = host.clientWidth;
          backdropSprite.height = host.clientHeight;
          const tScale = Math.max(0.2, Math.min(4, cam.zoom * 0.35));
          backdropSprite.tileScale.set(tScale);
          backdropSprite.tilePosition.set(cam.x, cam.y);
        } else {
          backdropSprite.visible = false;
        }
      }
      if (grainSprite) {
        grainSprite.width = host.clientWidth;
        grainSprite.height = host.clientHeight;
      }
      if (vignetteSprite) {
        vignetteSprite.width = host.clientWidth;
        vignetteSprite.height = host.clientHeight;
      }

      drawFog(fogGfx, m, {x:-cam.x/cam.zoom,y:-cam.y/cam.zoom,w:host.clientWidth/cam.zoom,h:host.clientHeight/cam.zoom},0.5);
      contentMask.clear();
      if (m.parent) {
        contentMask.rect(m.bounds.x, m.bounds.y, m.bounds.w, m.bounds.h).fill(0xffffff);
        entitiesRoot.mask = contentMask; childMapsContainer.mask = contentMask;
      } else { entitiesRoot.mask = null; childMapsContainer.mask = null; }
      const usedTextures = new Set<string>();
      const textureFor = (entity: Entity): Texture | undefined => {
        const id = entityAssetId(entity);
        if (!id) return undefined;
        const url = resolveWorldAssetUrl(worldPathRef.current, assetsIndexRef.current, id);
        if (!url) return undefined;
        usedTextures.add(url);
        const texture = getCachedAssetTexture(url);
        if (!texture) void loadAssetTexture(url, () => { if (!disposed) setTextureVersion(v => v + 1); });
        return texture;
      };
      const viewBounds = { minX: -cam.x/cam.zoom, minY: -cam.y/cam.zoom,
        maxX: (host.clientWidth-cam.x)/cam.zoom, maxY: (host.clientHeight-cam.y)/cam.zoom };
      const zoomChangedSignificantly =
        lastZoomForRebuild === 0 ||
        Math.abs(cam.zoom - lastZoomForRebuild) / lastZoomForRebuild > 0.25;

      // The hatch test scans every entity, so build it at most once per sync.
      let hatchCache: ReturnType<typeof createWallHatchTest> | false | undefined;
      const mapHatch = () => hatchCache ??= (['interior', 'site'].includes(m.kind) ? createWallHatchTest(Object.values(m.entities), m.generators) : false);
      // Sync layer containers in array order
      const desiredLayerIds = new Set(m.layers.map((l) => l.id));
      for (const [lid, container] of layerContainers) {
        if (!desiredLayerIds.has(lid)) {
          container.destroy({ children: true });
          layerContainers.delete(lid);
        }
      }

      entitiesRoot.removeChildren();
      for (const layer of m.layers) {
        let lc = layerContainers.get(layer.id);
        if (!lc) {
          lc = new Container();
          lc.eventMode = 'none';
          layerContainers.set(layer.id, lc);
        }
        lc.visible = layer.visible;
        entitiesRoot.addChild(lc);
      }

      const geoEntities = (geographicEntities(m) as Entity[]).filter(
        (e) => !(e.type === 'path' && e.routeTier === 'sewer' && !currentShowUndercity),
      );
      const geoIds = new Set(geoEntities.map((e) => e.id));
      // Remove deleted entities from cache
      for (const [eid, cached] of entityCache) {
        if (!geoIds.has(eid)) {
          cached.container.destroy({ children: true });
          entityCache.delete(eid);
        }
      }

      // Add or update changed entities only
      const selectedSet = selectedSetRef.current;
      const groupIds = !viewStore.getState().editParts && selectedSet.size > 1
        ? new Set([...selectedSet].map((id) => m.entities[id]?.groupId ?? m.entities[id]?.genId).filter(Boolean))
        : null;
      const isGroupSelection = Boolean(groupIds && groupIds.size === 1);
      const layerGmMap = new Map(m.layers.map((l) => [l.id, l.gmOnly]));
      const activeTool = getActiveTool();
      const previewMap = activeTool.getPreviewEntities?.() ?? null;
      const displayOrder = new Map<string, Array<{ entity: Entity; container: Container }>>();
      for (const rawEntity of geoEntities) {
        const isPreview = Boolean(previewMap?.has(rawEntity.id));
        const entity = previewMap?.get(rawEntity.id) ?? rawEntity;
        const bounds = getEntityBounds(entity);
        if (!m.layers.some(l => l.id === entity.layerId && l.visible) || (bounds && !boxesIntersect(bounds, viewBounds))) {
          const hidden = entityCache.get(entity.id);
          if (hidden) { hidden.container.destroy({ children: true }); entityCache.delete(entity.id); }
          continue;
        }
        const texture = textureFor(entity);

        const hasTexture = Boolean(texture);
        const isSelected = selectedSet.has(entity.id) && !isGroupSelection;
        const layerGmOnly = Boolean(layerGmMap.get(entity.layerId));
        const cached = entityCache.get(entity.id);
        const needsRebuild =
          !cached ||
          isPreview ||
          cached.wasPreview !== isPreview ||
          cached.rev !== entity.rev ||
          cached.selected !== isSelected ||
          cached.layerId !== entity.layerId ||
          cached.layerGmOnly !== layerGmOnly ||
          cached.hasTexture !== hasTexture ||
          cached.roofMode !== currentRoofMode ||
          zoomChangedSignificantly;

        if (needsRebuild) {
          if (cached) {
            cached.container.destroy({ children: true });
          }
          const wallHatch = mapHatch();
          const display = buildEntityDisplay(entity, {
            selected: isSelected,
            zoom: cam.zoom,
            cartographicRivers: (m.riverWidthMode ?? (['world','region'].includes(m.kind)?'cartographic':'physical')) === 'cartographic',
            texture,
            layerGmOnly,
            mapKind: m.kind,
            roofMode: currentRoofMode,
            wallHatch,
            separatePathOutline: true,
            separateWallPass: true,
          });
          const targetLayer = layerContainers.get(entity.layerId);
          if (targetLayer) {
            targetLayer.addChild(display);
          }
          entityCache.set(entity.id, {
            rev: entity.rev,
            selected: isSelected,
            layerId: entity.layerId,
            layerGmOnly,
            hasTexture,
            wasPreview: isPreview,
            roofMode: currentRoofMode,
            container: display,
          });
        }
        const order = displayOrder.get(entity.layerId) ?? [];
        order.push({ entity, container: entityCache.get(entity.id)!.container });
        displayOrder.set(entity.layerId, order);
      }
      // Restore model order and splice pooled path/clearing outlines & merged 3-pass solid walls cleanly.
      const layerHatchTest = mapHatch();
      // Clear overlays on every layer, including layers with nothing on screen now (or after a map switch).
      for (const layer of layerContainers.values()) {
        for (const ch of [...layer.children]) {
          if (ch.label === '__pathOutlineOverlay' || ch.label === '__wallNetworkOverlay') {
            layer.removeChild(ch);
            ch.destroy();
          }
        }
      }
      for (const [layerId, entries] of displayOrder) {
        const layer = layerContainers.get(layerId)!;
        const layerEnts = geoEntities.filter((e) => e.layerId === layerId);
        const outlineOverlay = buildPathOutlineOverlay(layerEnts, cam.zoom, m.kind);
        outlineOverlay.label = '__pathOutlineOverlay';
        const wallOverlay = buildWallNetworkOverlay(
          entries.map((x) => x.entity),
          cam.zoom,
          layerHatchTest,
        );
        wallOverlay.label = '__wallNetworkOverlay';
        const insertPathAt = entries.findIndex(
          ({ entity: e }) =>
            (e.type === 'path' && e.role !== 'cityWall')
            || (e.type === 'area' && (e.role === 'building' || (e.role === 'land' && e.name?.startsWith('Clearing ')))),
        );
        const spliced = entries.map((x) => x.container);
        if (insertPathAt >= 0) {
          spliced.splice(insertPathAt, 0, outlineOverlay);
          layer.addChild(outlineOverlay);
        } else {
          outlineOverlay.destroy();
        }
        const insertWallAt = spliced.findIndex((_, i) => {
          const idx = insertPathAt >= 0 && i > insertPathAt ? i - 1 : i;
          const e = entries[idx]?.entity;
          return e && (e.type === 'wall' || e.type === 'door' || e.type === 'prop' || e.type === 'portal');
        });
        if (entries.some((x) => x.entity.type === 'wall')) {
          const wAt = insertWallAt >= 0 ? insertWallAt : spliced.length;
          spliced.splice(wAt, 0, wallOverlay);
          layer.addChild(wallOverlay);
        } else {
          wallOverlay.destroy();
        }
        spliced.forEach((display, index) => {
          if (layer.children[index] !== display) layer.setChildIndex(display, index);
        });
      }

      if (zoomChangedSignificantly) {
        lastZoomForRebuild = cam.zoom;
      }
      drawRoomLightingOverlay(
        lightingGfx,
        m,
        {
          x: viewBounds.minX,
          y: viewBounds.minY,
          w: viewBounds.maxX - viewBounds.minX,
          h: viewBounds.maxY - viewBounds.minY,
        },
        currentLightingMode,
      );
      drawGrid(m, cam);

      // Draw inline child maps whose rectangle is on-screen and > 64px (interiors excluded)
      childMapsContainer
        .removeChildren()
        .forEach((c) => c.destroy({ children: true }));
      const currentWorld = worldRef.current;
      if (currentWorld) {
        const viewW = Math.max(1, host.clientWidth);
        const viewH = Math.max(1, host.clientHeight);
        for (const childMap of Object.values(currentWorld.maps)) {
          if (childMap.parent?.mapId !== m.id) continue;
          const rect = childMapParentRect(childMap);
          if (!rect || !shouldDrawChildInline(cam, rect, viewW, viewH)) continue;

          const childContainer = new Container();
          childContainer.eventMode = 'none';
          childContainer.position.set(rect.x, rect.y);

          const frame = new Graphics();
          frame.eventMode = 'none';
          frame
            .rect(0, 0, rect.w, rect.h)
            .stroke({ width: Math.max(0.1, 1.5 / Math.max(0.01, cam.zoom)), color: 0x38bdf8, alpha: 0.7 });
          const childMask = new Graphics().rect(0,0,rect.w,rect.h).fill(0xffffff);
          childContainer.addChild(childMask); childContainer.mask = childMask;
          childContainer.addChild(frame);
          if (childMap.kind === 'settlement' && (m.kind === 'world' || m.kind === 'region')) {
            childMapsContainer.addChild(childContainer);
            continue;
          }

          const childLayerGmMap = new Map(childMap.layers.map((l) => [l.id, l.gmOnly]));
          const childLayerVisMap = new Map(childMap.layers.map((l) => [l.id, l.visible]));
          const childHatch = ['interior', 'site'].includes(childMap.kind)
            ? createWallHatchTest(Object.values(childMap.entities), childMap.generators)
            : false;
          for (const layer of childMap.layers) {
            if (!childLayerVisMap.get(layer.id)) continue;
            for (const ent of geographicEntities(childMap)) {
              if (ent.layerId !== layer.id) continue;
              const disp = buildEntityDisplay(ent, {
                selected: false,
                zoom: cam.zoom,
                layerGmOnly: Boolean(childLayerGmMap.get(layer.id)),
                texture: textureFor(ent),
                mapKind: childMap.kind,
                roofMode: currentRoofMode,
                wallHatch: childHatch,
              });
              childContainer.addChild(disp);
            }
          }
          childMapsContainer.addChild(childContainer);
        }
      }
      updateTextureUsage(textureOwner, usedTextures);

      // Rebuild optional category label overlay for places
      placeOverlayContainer
        .removeChildren()
        .forEach((c) => c.destroy({ children: true }));
      if (showPlaceCategoryOverlayRef.current) {
        const layerVisibleMap = new Map(m.layers.map((l) => [l.id, l.visible]));
        const invScale = 1 / Math.max(0.01, cam.zoom);
        for (const entity of Object.values(m.entities)) {
          if (entity.type !== 'place') continue;
          if (layerVisibleMap.get(entity.layerId) === false) continue;
          const center = getPlaceCenter(m, entity);
          if (!center) continue;

          const badge = new Container();
          badge.eventMode = 'none';
          badge.position.set(center.x, center.y);
          badge.scale.set(invScale);

          const labelText = entity.category.trim()
            ? `${entity.name} [${entity.category.trim()}]`
            : entity.name;
          const text = new Text({
            text: labelText,
            style: {
              fontSize: 12,
              fill: 0xf8fafc,
              fontFamily: 'system-ui, sans-serif',
            },
          });
          text.eventMode = 'none';
          text.anchor.set(0.5, 0.5);

          const padX = 6;
          const padY = 3;
          const bg = new Graphics();
          bg.eventMode = 'none';
          const w = text.width + padX * 2;
          const h = text.height + padY * 2;
          bg.roundRect(-w / 2, -h / 2, w, h, 4)
            .fill({ color: 0x0f172a, alpha: 0.85 })
            .stroke({ width: 1, color: 0x38bdf8, alpha: 0.9 });

          badge.addChild(bg);
          badge.addChild(text);
          placeOverlayContainer.addChild(badge);
        }
      }

      underlayGfx.clear();
      if ((m.kind === 'interior' || m.kind === 'site') && m.floorGroupId) {
        const w = worldStore.getState().world;
        const floorBelow = w
          ? Object.values(w.maps).find(
              (cand) =>
                (cand.floorGroupId ?? cand.id) === m.floorGroupId &&
                (cand.level ?? 0) === (m.level ?? 0) - 1,
            )
          : undefined;
        if (floorBelow) {
          for (const ent of Object.values(floorBelow.entities)) {
            if (ent.type === 'area' && ent.role === 'floor') {
              for (const ring of ent.rings) {
                if (ring.length < 3) continue;
                underlayGfx.moveTo(ring[0]!.x, ring[0]!.y);
                for (let i = 1; i < ring.length; i++) underlayGfx.lineTo(ring[i]!.x, ring[i]!.y);
                underlayGfx.closePath().stroke({ color: 0x94a3b8, width: 0.18, alpha: 0.22 });
              }
            } else if (ent.type === 'wall' && ent.points.length >= 2) {
              underlayGfx.moveTo(ent.points[0]!.x, ent.points[0]!.y);
              for (let i = 1; i < ent.points.length; i++) underlayGfx.lineTo(ent.points[i]!.x, ent.points[i]!.y);
              underlayGfx.stroke({ color: 0x94a3b8, width: 0.28, alpha: 0.22 });
            }
          }
        }
      }

      overlayGfx.clear();
      if (viewStore.getState().blueprintMode || activeToolIdRef.current === 'area') {
        for (const ent of Object.values(m.entities)) {
          if (ent.type === 'area' && ent.usage === 'blueprint') {
            for (const ring of ent.rings) {
              if (ring.length < 3) continue;
              overlayGfx.moveTo(ring[0]!.x, ring[0]!.y);
              for (let i = 1; i < ring.length; i++) overlayGfx.lineTo(ring[i]!.x, ring[i]!.y);
              overlayGfx.closePath()
                .fill({ color: 0x38bdf8, alpha: 0.1 })
                .stroke({ color: 0x38bdf8, width: Math.max(0.15, 2 / cam.zoom), alpha: 0.72 });
            }
          }
        }
      }
      for(const id of viewStore.getState().diagnosticEntityIds){const entity=m.entities[id]??geographicEntities(m).find(e=>e.id===id);if(!entity)continue;const b=getEntityBounds(entity);if(b)overlayGfx.rect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY).stroke({color:0xf87171,width:2/cam.zoom});}
      for (const selectedId of selectedSetRef.current) {
        const ent = m.entities[selectedId];
        if (ent?.type === 'place') {
          const bounds = getPlaceBounds(m, ent);
          if (bounds) {
            const pad = Math.max(0.5, 6 / Math.max(0.01, cam.zoom));
            const strokeW = Math.max(0.05, 2 / Math.max(0.01, cam.zoom));
            overlayGfx
              .rect(
                bounds.minX - pad,
                bounds.minY - pad,
                bounds.maxX - bounds.minX + pad * 2,
                bounds.maxY - bounds.minY + pad * 2,
              )
              .fill({ color: 0x38bdf8, alpha: 0.12 })
              .stroke({ width: strokeW, color: 0x38bdf8, alpha: 0.95 });
          }
        }
      }
      measureGfx.clear();
      if (activeTool.id === 'measure') {
        activeTool.drawOverlay(measureGfx, buildToolContext(m));
      } else {
        const vs = viewStore.getState();
        if (vs.measurements[props.panelId] || vs.showHorizonRing) {
          measureTool.drawOverlay(measureGfx, buildToolContext(m));
        }
        activeTool.drawOverlay(overlayGfx, buildToolContext(m));
      }
    };

    const scheduleRender = () => {
      if (disposed || dirty) {
        return;
      }
      dirty = true;
      rafId = ownerWin.requestAnimationFrame(() => {
        rafId = null;
        dirty = false;
        if (disposed || !app.renderer) {
          return;
        }
        const cam = getCamera();
        worldLayer.position.set(cam.x, cam.y);
        worldLayer.scale.set(cam.zoom);
        app.render();
        setRenderCount((c) => c + 1);
      });
    };

    syncSceneRef.current = () => {
      syncScene();
      scheduleRender();
    };
    scheduleRenderRef.current = scheduleRender;

    const resizeToHost = () => {
      if (disposed || !app.renderer) {
        return;
      }
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      app.renderer.resolution = ownerWin.devicePixelRatio || 1;
      app.renderer.resize(width, height);
      syncScene();
      scheduleRender();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = true;
      }
      const active = ownerDoc.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      if (active !== canvas) {
        return;
      }
      const m = mapRef.current;
      if (m && !calibratingIdRef.current) {
        if (getActiveTool().onKey(e, buildToolContext(m))) {
          e.preventDefault();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']') && m.floorGroupId) {
          const w = worldStore.getState().world;
          if (w) {
            const stack = Object.values(w.maps)
              .filter((cand) => (cand.floorGroupId ?? cand.id) === m.floorGroupId)
              .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
            const idx = stack.findIndex((cand) => cand.id === m.id);
            const target = stack[idx + (e.key === ']' ? 1 : -1)];
            if (target) {
              e.preventDefault();
              navigateToMap(target.id, props.panelId);
              return;
            }
          }
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
          e.preventDefault();
          worldStore.getState().execute('map.rearrangeLabels', { mapId: m.id });
          return;
        }
        if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
          const w = worldStore.getState().world;
          const vs = viewStore.getState();
          const ctx = resolveGenerationContext(m, vs.selectedEntityIds, vs.editParts, generationState.getState().siteTypes[`${w?.meta.id ?? ''}:${m.id}`]);
          if (w && ctx.type) {
            e.preventDefault();
            const key = draftKey(w.meta.id, m.id, ctx);
            const draft = generationState.getState().drafts[key] ?? defaultGenerationDraft(m, ctx);
            if (e.ctrlKey || e.metaKey) {
              if (ctx.type === 'dungeon' && ctx.kind === 'result') {
                const nextRender = (Number(draft.params.renderSeed ?? 0) + 1) | 0;
                void generateFromContext(m, ctx, { ...draft, params: { ...draft.params, renderSeed: nextRender } }, props.panelId, 'dressing');
              } else {
                worldStore.getState().execute('map.rearrangeLabels', { mapId: m.id });
              }
            } else if (e.shiftKey) {
              void generateFromContext(m, ctx, draft, props.panelId, 'another');
            }
            return;
          }
        }
        if (e.key === 'Escape') {
          const vs = viewStore.getState();
          if (vs.pendingDevelopRect) {
            vs.setPendingDevelopRect(null);
            e.preventDefault();
            return;
          }
          if (vs.activeTool !== 'select') {
            vs.setActiveTool('select');
            e.preventDefault();
            return;
          }
          if (vs.selectedEntityIds.length > 0) {
            vs.setSelection([]);
            e.preventDefault();
            return;
          }
        }
      }
    };
    const onPopupShortcut = (e:KeyboardEvent) => {
      if(ownerWin===window||e.defaultPrevented||!(e.ctrlKey||e.metaKey))return;
      const target=e.target as HTMLElement|null;if(target?.closest('input,textarea,select,[contenteditable=true]'))return;
      const key=e.key.toLowerCase();if(key==='z'||key==='y'){e.preventDefault();editorHistory(key==='y'||e.shiftKey);}
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false;
      }
    };

    let calibratingDrag = false;
    let calibStart: Point | null = null;
    let toolCapture = false;

    // Chromium reports pointerdown.detail as 0, so tools never saw a double-click
    // (Edit parts, point editing, finishing a shape). Count clicks here instead.
    let lastDown = { t: 0, x: 0, y: 0, count: 0 };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        const now = performance.now();
        const again = now - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
        lastDown = { t: now, x: e.clientX, y: e.clientY, count: again ? lastDown.count + 1 : 1 };
        Object.defineProperty(e, 'detail', { value: lastDown.count });
      }
      activateMapPanel(props.panelId, mapRef.current?.id);
      canvas.focus({ preventScroll: true });
      if (e.button === 0 && calibratingIdRef.current && !spaceHeld) {
        const rect = canvas.getBoundingClientRect();
        const pt = screenToMap(
          getCamera(),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        calibratingDrag = true;
        calibStart = pt;
        setCalibLine({ start: pt, end: pt, pendingConfirm: false });
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const m = mapRef.current;
      if (m && e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const pt = screenToMap(
          getCamera(),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        if (getActiveTool().onPointerDown(pt, e, buildToolContext(m))) {
          toolCapture = true;
          canvas.setPointerCapture(e.pointerId);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (calibratingDrag && calibStart) {
        const rect = canvas.getBoundingClientRect();
        const pt = screenToMap(
          getCamera(),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        setCalibLine({ start: calibStart, end: pt, pendingConfirm: false });
        return;
      }
      if (panning) {
        const cam = getCamera();
        viewStore.getState().setPanelCamera(props.panelId, {
          ...cam,
          x: cam.x + (e.clientX - lastX),
          y: cam.y + (e.clientY - lastY),
        });
        lastX = e.clientX;
        lastY = e.clientY;
        scheduleRender();
        return;
      }
      const m = mapRef.current;
      if (m && !calibratingIdRef.current) {
        const rect = canvas.getBoundingClientRect();
        const pt = screenToMap(
          getCamera(),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        getActiveTool().onPointerMove(pt, e, buildToolContext(m));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (calibratingDrag && calibStart) {
        calibratingDrag = false;
        const rect = canvas.getBoundingClientRect();
        const pt = screenToMap(
          getCamera(),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        setCalibLine({ start: calibStart, end: pt, pendingConfirm: true });
        calibStart = null;
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
        return;
      }
      if (panning) {
        panning = false;
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
        return;
      }
      if (toolCapture) {
        toolCapture = false;
        const m = mapRef.current;
        if (m) {
          const rect = canvas.getBoundingClientRect();
          const pt = screenToMap(
            getCamera(),
            e.clientX - rect.left,
            e.clientY - rect.top,
          );
          getActiveTool().onPointerUp(pt, e, buildToolContext(m));
        }
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = mapRef.current;
      if (!m) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextCam = zoomAtCursor(getCamera(), sx, sy, factor, m.kind);

      const currentWorld = worldRef.current;
      const viewW = Math.max(1, host.clientWidth);
      const viewH = Math.max(1, host.clientHeight);
      if (viewStore.getState().zoomThrough && currentWorld && e.deltaY < 0) {
        const children = Object.values(currentWorld.maps).filter(
          (c) => c.parent?.mapId === m.id && c.kind !== 'interior',
        );
        let zoomTarget = findZoomInChild(nextCam, m.kind, children, viewW, viewH, { x: sx, y: sy });
        if (!zoomTarget && m.kind === 'settlement') {
          const interiorHit = Object.values(currentWorld.maps).find((c) => {
            if (c.parent?.mapId !== m.id || c.kind !== 'interior') return false;
            const left = c.parent.x * nextCam.zoom + nextCam.x;
            const top = c.parent.y * nextCam.zoom + nextCam.y;
            const right = (c.parent.x + c.bounds.w) * nextCam.zoom + nextCam.x;
            const bottom = (c.parent.y + c.bounds.h) * nextCam.zoom + nextCam.y;
            const inCursor = sx >= left && sx <= right && sy >= top && sy <= bottom;
            const cov = ((Math.min(viewW, right) - Math.max(0, left)) * (Math.min(viewH, bottom) - Math.max(0, top))) / Math.max(1, viewW * viewH);
            return inCursor && cov >= 0.52;
          });
          if (interiorHit) zoomTarget = interiorHit;
        }
        if (zoomTarget && zoomTarget.parent) {
          const childCam = parentToChildCamera(
            nextCam,
            { x: zoomTarget.parent.x, y: zoomTarget.parent.y },
            zoomTarget.kind,
          );
          viewStore.getState().setSelection([]);
          viewStore.getState().setPanelMap(props.panelId, zoomTarget.id);
          viewStore.getState().setPanelCamera(props.panelId, childCam);
          navigateToMap(zoomTarget.id, props.panelId);
          syncScene();
          scheduleRender();
          return;
        }
      } else if (
        viewStore.getState().zoomThrough && currentWorld &&
        e.deltaY > 0 &&
        m.parent &&
        m.kind !== 'interior' &&
        shouldZoomOutToParent(nextCam, m, viewW, viewH)
      ) {
        const parentMap = currentWorld.maps[m.parent.mapId];
        if (parentMap) {
          const parentCam = childToParentCamera(
            nextCam,
            { x: m.parent.x, y: m.parent.y },
            parentMap.kind,
          );
          viewStore.getState().setSelection([]);
          viewStore.getState().setPanelMap(props.panelId, parentMap.id);
          viewStore.getState().setPanelCamera(props.panelId, parentCam);
          navigateToMap(parentMap.id, props.panelId);
          syncScene();
          scheduleRender();
          return;
        }
      }

      viewStore.getState().setPanelCamera(props.panelId, nextCam);
      syncScene();
      scheduleRender();
    };

    let observer: ResizeObserver | null = null;

    void app
      .init({
        canvas,
        preference: 'webgl',
        autoStart: false,
        antialias: true,
        backgroundColor: 0x0d1117,
        width: Math.max(1, Math.floor(host.clientWidth)),
        height: Math.max(1, Math.floor(host.clientHeight)),
        resolution: ownerWin.devicePixelRatio || 1,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        app.stage.eventMode = 'none';
        const initW = Math.max(1, Math.floor(host.clientWidth));
        const initH = Math.max(1, Math.floor(host.clientHeight));
        const initStyle = mapRef.current ? mapBackdropStyle(mapRef.current) : mapBackdropStyle('world');
        const bTex = getProceduralTexture(initStyle.texKind);
        if (bTex) {
          backdropSprite = new TilingSprite({ texture: bTex, width: initW, height: initH });
          backdropSprite.eventMode = 'none';
          backdropSprite.alpha = initStyle.texAlpha;
          app.stage.addChild(backdropSprite);
        }
        worldLayer.addChild(gridGfx);
        worldLayer.addChild(underlayGfx);
        worldLayer.addChild(contentMask);
        worldLayer.addChild(entitiesRoot);
        worldLayer.addChild(childMapsContainer);
        worldLayer.addChild(placeOverlayContainer);
        worldLayer.addChild(lightingGfx);
        worldLayer.addChild(fogGfx);
        worldLayer.addChild(overlayGfx);
        worldLayer.addChild(measureGfx);
        app.stage.addChild(worldLayer);
        const parchmentTex = getProceduralTexture('parchment');
        if (parchmentTex) {
          grainSprite = new TilingSprite({ texture: parchmentTex, width: initW, height: initH });
          grainSprite.eventMode = 'none';
          grainSprite.alpha = 0.08;
          app.stage.addChild(grainSprite);
        }
        const vignetteTex = getProceduralTexture('vignette');
        if (vignetteTex) {
          vignetteSprite = new Sprite(vignetteTex);
          vignetteSprite.eventMode = 'none';
          vignetteSprite.width = initW;
          vignetteSprite.height = initH;
          vignetteSprite.alpha = 0.72;
          app.stage.addChild(vignetteSprite);
        }

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        // Let the focused drawing tool consume Undo before the app shortcut.
        ownerWin.addEventListener('keydown', onKeyDown, true);
        ownerWin.addEventListener('keyup', onKeyUp);
        ownerWin.addEventListener('keydown',onPopupShortcut);

        observer = new ownerWin.ResizeObserver(() => {
          resizeToHost();
        });
        observer.observe(host);

        syncScene();
        resizeToHost();
      })
      .catch((err) => {
        console.error('MapView Pixi init failed:', err);
      });

    return () => {
      unregisterHistory();
      disposed = true;
      syncSceneRef.current = null;
      scheduleRenderRef.current = null;
      if (rafId !== null) {
        ownerWin.cancelAnimationFrame(rafId);
      }
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      ownerWin.removeEventListener('keydown', onKeyDown, true);
      ownerWin.removeEventListener('keyup', onKeyUp);
      ownerWin.removeEventListener('keydown',onPopupShortcut);
      if (app.renderer) {
        app.destroy(true, { children: true });
      }
      updateTextureUsage(textureOwner, new Set());
      host.replaceChildren();
    };
  }, [locationEpoch, props.panelId]);

  useEffect(() => {
    syncSceneRef.current?.();
  }, [
    world,
    map,
    selectedIds,
    assetsIndex,
    textureVersion,
    activeToolId,
    showPlaceCategoryOverlay,
    pendingDevelopRect,
    measurement,
    measureSchedule, measureMarkers, measureSpeed, measureDeparture,
    diagnosticEntityIds,
    panelState?.camera,
    roofMode,
    lightingMode,
    showUndercity,
    showHorizonRing,
    blueprintMode,
  ]);

  useEffect(() => {
    if (!focusPlaceRequest || !map || focusPlaceRequest.mapId !== map.id) {
      return;
    }
    const isTargetPanel =
      activeMapPanelId === props.panelId ||
      (!activeMapPanelId && props.panelId === 'map-main');
    if (!isTargetPanel) {
      return;
    }
    const place = map.entities[focusPlaceRequest.placeId];
    if (!place || place.type !== 'place') {
      return;
    }
    const center = getPlaceCenter(map, place);
    const host = hostRef.current;
    if (!center || !host) {
      return;
    }
    const currentCam =
      viewStore.getState().panels[props.panelId]?.camera ??
      fitBoundsCamera(
        map.bounds,
        Math.max(1, host.clientWidth),
        Math.max(1, host.clientHeight),
        map.kind,
      );
    const nextCam = centerCameraOnPoint(
      currentCam,
      center.x,
      center.y,
      Math.max(1, host.clientWidth),
      Math.max(1, host.clientHeight),
    );
    viewStore.getState().setPanelCamera(props.panelId, nextCam);
    syncSceneRef.current?.();
  }, [focusPlaceRequest, map, activeMapPanelId, props.panelId]);

  useEffect(() => {
    if (!fitRequest || fitRequest.panelId !== props.panelId || !map || !hostRef.current) return;
    const host = hostRef.current;
    viewStore.getState().setPanelCamera(props.panelId, fitBoundsCamera(fitRequest.bounds ?? map.bounds, host.clientWidth, host.clientHeight, map.kind));
    viewStore.setState({fitRequest:null});
    syncSceneRef.current?.();
  }, [fitRequest, map?.id, props.panelId]);

  const fit = (selection = false) => {
    if (!map) return;
    const b = selection ? getSelectionBounds(selectedIds.flatMap(id => map.entities[id] ? [map.entities[id]!] : [])) : null;
    viewStore.setState({ fitRequest: { panelId: props.panelId, bounds: b ? { x: b.minX, y: b.minY, w: Math.max(.01,b.maxX-b.minX), h: Math.max(.01,b.maxY-b.minY) } : undefined, nonce: Date.now() } });
  };
  const applyCalibration = () => {
    if (!map || !calibratingImageId || !calibLine) {
      return;
    }
    const entity = map.entities[calibratingImageId];
    if (!entity || entity.type !== 'image') {
      return;
    }
    const dx = calibLine.end.x - calibLine.start.x;
    const dy = calibLine.end.y - calibLine.start.y;
    const drawnMetres = Math.hypot(dx, dy);
    const val = Number.parseFloat(calibLengthInput);
    if (!Number.isFinite(val) || val <= 0 || drawnMetres <= 0) {
      return;
    }
    const knownMetres =
      calibUnit === 'ft'
        ? val * 0.3048
        : calibUnit === 'mi'
          ? val * 1609.344
          : val;
    const scale = knownMetres / drawnMetres;
    worldStore.getState().execute('entity.update', {
      mapId: map.id,
      entityId: entity.id,
      patch: {
        w: entity.w * scale,
        h: entity.h * scale,
      },
    });
    viewStore.setState({ fitRequest: { panelId: props.panelId, bounds: { x: entity.x, y: entity.y, w: entity.w * scale, h: entity.h * scale }, nonce: Date.now() } });
    setCalibLine(null);
    viewStore.getState().setCalibratingImageId(null);
  };

  const entityCount = map ? Object.keys(map.entities).length : 0;
  const parentMap =
    map?.parent && world ? world.maps[map.parent.mapId] : undefined;
  const parentChanged =
    Boolean(map && parentMap && hasParentChanged(map, parentMap));

  const handlePullFromParent = () => {
    if (!map) return;
    const res = worldStore.getState().execute('map.pullFromParent', {
      mapId: map.id,
    }) as { keptEdited?: KeptEditedEntityInfo[] };
    setPullReport(res.keptEdited ?? []);
  };

  return (
    <div
      data-testid={`panel-${props.panelId}`}
      data-entity-count={entityCount}
      data-render-count={renderCount}
      data-location-type={isPopout ? 'popout' : 'grid'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--atlas-bg)',
        color: 'var(--atlas-text)',
      }}
    >
      {!props.isMainMap && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            padding: '4px 8px',
            borderBottom: '1px solid var(--atlas-border)',
            background: 'var(--atlas-surface)',
            fontSize: 12,
          }}
        >
          <strong>{map ? `${map.name} (${map.kind})` : 'No map'}</strong>
          {map && (
            <>
              <button data-testid="fit-map" onClick={() => fit()}>
                Fit
              </button>
              <details className="context-menu">
                <summary>Map…</summary>
                <div>
                  <span>
                    {entityCount} entities · {extentLabel(map.bounds)}
                  </span>
                  <button
                    data-testid="fit-selection"
                    disabled={!selectedIds.length}
                    onClick={() => fit(true)}
                  >
                    Fit Selection
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={zoomThrough}
                      onChange={(e) => viewStore.setState({ zoomThrough: e.target.checked })}
                    />
                    Zoom-through
                  </label>
                  <button onClick={() => openGenerationSettings(map, props.panelId, '', 'map')}>
                    Map settings…
                  </button>
                </div>
              </details>
            </>
          )}
          {parentChanged && (
            <button
              type="button"
              data-testid="btn-pull-from-parent"
              onClick={handlePullFromParent}
              style={{
                background: '#f59e0b',
                color: '#111827',
                fontWeight: 600,
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              Parent changed — Pull from parent
            </button>
          )}
        </div>
      )}
      {pullReport && pullReport.length > 0 && (
        <div
          data-testid="pull-kept-report"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            background: 'var(--atlas-surface)',
            border: '1px solid #fbbf24',
            borderRadius: 6,
            padding: '4px 10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: '#fbbf24',
          }}
        >
          Kept {pullReport.length} edited:{' '}
          {pullReport.map((k) => k.name || `${k.type} (${k.id.slice(0, 6)})`).join(', ')}
          <button type="button" onClick={() => setPullReport(null)}>
            ×
          </button>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        <div
          ref={hostRef}
          data-testid={`canvas-host-${props.panelId}`}
          style={{ width: '100%', height: '100%' }}
        />
        {liveDimensions&&<div data-testid="live-dimensions" style={{position:'absolute',top:8,right:8,pointerEvents:'none',background:'#10151acc',color:'#f8fafc',fontSize:11,borderRadius:4,padding:6}}>Selection extent: {liveDimensions}</div>}
        {interactionMessage&&<div role="status" style={{position:'absolute',top:6,left:8,background:'#10151aee',color:'#f8fafc',fontSize:12,borderRadius:4,padding:8}} onClick={()=>viewStore.setState({interactionMessage:''})}>{interactionMessage}</div>}
        {panelState?.camera && <div style={{ position: 'absolute', bottom: 8, left: 10, pointerEvents: 'none', background: '#10151acc', color: '#f8fafc', fontSize: 11, borderRadius: 4, padding: 5 }}>
          <div style={{ width: 100, borderBottom: '2px solid #e5e7eb' }}>{distanceLabel(100 / panelState.camera.zoom)}</div>
        </div>}
        {map && (map.kind === 'settlement' || map.kind === 'interior') && (
          <div
            data-testid="cartographic-view-pills"
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#10151acc',
              color: '#f8fafc',
              fontSize: 11,
              borderRadius: 4,
              padding: '3px 6px',
              zIndex: 4,
            }}
          >
            {map.kind === 'settlement' && (
              <>
                <span style={{ opacity: 0.75 }}>Roofs:</span>
                {(['detailed', 'simple', 'hidden'] as const).map((rm) => (
                  <button
                    key={rm}
                    type="button"
                    data-testid={`roof-mode-${rm}`}
                    onClick={() => viewStore.getState().setRoofMode(rm)}
                    style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      border: '1px solid #4b5563',
                      background: roofMode === rm ? '#d97706' : 'transparent',
                      color: '#f8fafc',
                      fontSize: 11,
                    }}
                  >
                    {rm}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="toggle-undercity"
                  onClick={() => viewStore.getState().setShowUndercity(!showUndercity)}
                  style={{
                    marginLeft: 4,
                    padding: '1px 6px',
                    borderRadius: 3,
                    border: '1px solid #4b5563',
                    background: showUndercity ? '#0f766e' : 'transparent',
                    color: '#f8fafc',
                    fontSize: 11,
                  }}
                >
                  Undercity
                </button>
              </>
            )}
            {map.kind === 'interior' && (
              <>
                <span style={{ opacity: 0.75 }}>Light:</span>
                {(['ambient', 'lights'] as const).map((lm) => (
                  <button
                    key={lm}
                    type="button"
                    data-testid={`lighting-mode-${lm}`}
                    onClick={() => viewStore.getState().setLightingMode(lm)}
                    style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      border: '1px solid #4b5563',
                      background: lightingMode === lm ? '#d97706' : 'transparent',
                      color: '#f8fafc',
                      fontSize: 11,
                    }}
                  >
                    {lm === 'ambient' ? 'AO' : 'Lights'}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        {calibratingImageId && (
          <div
            data-testid="calibration-bar"
            style={{
              // Top centre: the floating Tools panel covers the top-left corner.
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--atlas-surface)',
              border: '1px solid var(--atlas-border)',
              borderRadius: 4,
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              zIndex: 10,
            }}
          >
            {!calibLine?.pendingConfirm ? (
              <span>Drag a line across a known distance on the image…</span>
            ) : (
              <>
                <span>Known distance:</span>
                <input
                  type="number"
                  value={calibLengthInput}
                  onChange={(e) => setCalibLengthInput(e.target.value)}
                  style={{ width: 70 }}
                />
                <select
                  value={calibUnit}
                  onChange={(e) =>
                    setCalibUnit(e.target.value as 'ft' | 'mi' | 'm')
                  }
                >
                  <option value="ft">ft</option>
                  <option value="mi">mi</option>
                  <option value="m">m</option>
                </select>
                <button type="button" onClick={applyCalibration}>
                  Apply
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setCalibLine(null);
                viewStore.getState().setCalibratingImageId(null);
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
