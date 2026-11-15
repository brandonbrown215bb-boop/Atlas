import { createBiomeTool } from '../tools/biomeTool';
import { editorHistory, registerDrawingHistory } from '../model/drawingHistory';
import { activateMapPanel, navigateToMap } from '../model/navigation';
import { extentLabel, distanceLabel } from '../model/mapDefaults';
import { geographicEntities } from '../geom/geography';
import { getSelectionBounds } from '../geom/hitTest';
import { createFogTool } from '../tools/fogTool';
import { drawFog } from './drawFog';
import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text, type Texture } from 'pixi.js';
import type { IDockviewPanelProps } from 'dockview-react';
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
import { buildEntityDisplay } from './drawEntity';
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
import { GenerationControls, openGenerationSettings } from '../panels/GenerationControls';
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
import { MeasureBar } from '../panels/MeasureBar';

export interface MapPanelParams {
  mapId?: string;
}

interface CachedEntityDisplay {
  rev: number;
  selected: boolean;
  layerId: string;
  layerGmOnly: boolean;
  hasTexture: boolean;
  wasPreview: boolean;
  container: Container;
}

export function MapView(props: IDockviewPanelProps<MapPanelParams>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [locationEpoch, setLocationEpoch] = useState(0);
  const [isPopout, setIsPopout] = useState(
    () => props.api.location.type === 'popout',
  );
  const [liveDimensions,setLiveDimensions]=useState('');
  const [renderCount, setRenderCount] = useState(0);

  const interactionMessage=useStore(viewStore,s=>s.interactionMessage);
  const diagnosticEntityIds = useStore(viewStore,s=>s.diagnosticEntityIds);
  const zoomThrough = useStore(viewStore, s => s.zoomThrough);
  const editParts = useStore(viewStore, s => s.editParts);
  const fitRequest = useStore(viewStore, s => s.fitRequest);
  const world = useStore(worldStore, (s) => s.world);
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const panelState = useStore(viewStore, (s) => s.panels[props.api.id]);
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
  const measurement = useStore(viewStore, (s) => s.measurements[props.api.id]);
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

  const effectiveMapId = panelState?.mapId ?? props.params.mapId ?? activeMapId;
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
    if (!viewStore.getState().activeMapPanelId || props.api.isActive) {
      activateMapPanel(props.api.id, mapRef.current?.id);
    }
    const locDisposable = props.api.onDidLocationChange((event) => {
      setIsPopout(event.location.type === 'popout');
      setLocationEpoch((n) => n + 1);
    });
    const activeDisposable = props.api.onDidActiveChange((event) => {
      if (event.isActive) {
        activateMapPanel(props.api.id, mapRef.current?.id);
      }
    });
    return () => {
      locDisposable.dispose();
      activeDisposable.dispose();
    };
  }, [props.api]);

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
    const fogGfx = new Graphics();
    const biomeTool = createBiomeTool();
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
      const stored = viewStore.getState().panels[props.api.id]?.camera;
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
        viewStore.getState().setPanelCamera(props.api.id, initial);
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
      panelId: props.api.id,
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

    const unregisterHistory = registerDrawingHistory(props.api.id, redo => {
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
      if (viewStore.getState().activeMapPanelId === props.api.id) {
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
        gridGfx.clear();
        overlayGfx.clear();

        measureGfx.clear();
        for (const cached of entityCache.values()) cached.container.destroy({ children: true });
        entityCache.clear();
        updateTextureUsage(textureOwner, new Set());
        return;
      }

      const cam = getCamera();
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

      const geoEntities = geographicEntities(m) as Entity[];
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
      const displayOrder = new Map<string, Container[]>();
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
          zoomChangedSignificantly;

        if (needsRebuild) {
          if (cached) {
            cached.container.destroy({ children: true });
          }
          const display = buildEntityDisplay(entity, {
            selected: isSelected,
            zoom: cam.zoom,
            cartographicRivers: (m.riverWidthMode ?? (['world','region'].includes(m.kind)?'cartographic':'physical')) === 'cartographic',
            texture,
            layerGmOnly,
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
            container: display,
          });
        }
        const order=displayOrder.get(entity.layerId) ?? [];
        order.push(entityCache.get(entity.id)!.container);
        displayOrder.set(entity.layerId,order);
      }
      // Rebuilding a selected/edited entity appends its display. Restore model order
      // so a district fill cannot jump over its streets and buildings.
      for(const [layerId,order] of displayOrder) {
        const layer=layerContainers.get(layerId)!;
        order.forEach((display,index)=>{if(layer.children[index]!==display) layer.setChildIndex(display,index);});
      }

      if (zoomChangedSignificantly) {
        lastZoomForRebuild = cam.zoom;
      }
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

          const childLayerGmMap = new Map(childMap.layers.map((l) => [l.id, l.gmOnly]));
          const childLayerVisMap = new Map(childMap.layers.map((l) => [l.id, l.visible]));
          for (const layer of childMap.layers) {
            if (!childLayerVisMap.get(layer.id)) continue;
            for (const ent of geographicEntities(childMap)) {
              if (ent.layerId !== layer.id) continue;
              const disp = buildEntityDisplay(ent, {
                selected: false,
                zoom: cam.zoom,
                layerGmOnly: Boolean(childLayerGmMap.get(layer.id)),
                texture: textureFor(ent),
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

      overlayGfx.clear();
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
      activeTool.drawOverlay(activeTool.id === 'measure' ? measureGfx : overlayGfx, buildToolContext(m));
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

    const onPointerDown = (e: PointerEvent) => {
      activateMapPanel(props.api.id, mapRef.current?.id);
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
        viewStore.getState().setPanelCamera(props.api.id, {
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
        const zoomTarget = findZoomInChild(nextCam, m.kind, children, viewW, viewH, { x: sx, y: sy });
        if (zoomTarget && zoomTarget.parent) {
          const childCam = parentToChildCamera(
            nextCam,
            { x: zoomTarget.parent.x, y: zoomTarget.parent.y },
            zoomTarget.kind,
          );
          viewStore.getState().setSelection([]);
          viewStore.getState().setPanelMap(props.api.id, zoomTarget.id);
          viewStore.getState().setPanelCamera(props.api.id, childCam);
          navigateToMap(zoomTarget.id, props.api.id);
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
          viewStore.getState().setPanelMap(props.api.id, parentMap.id);
          viewStore.getState().setPanelCamera(props.api.id, parentCam);
          navigateToMap(parentMap.id, props.api.id);
          syncScene();
          scheduleRender();
          return;
        }
      }

      viewStore.getState().setPanelCamera(props.api.id, nextCam);
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
        worldLayer.addChild(gridGfx);
        worldLayer.addChild(contentMask);
        worldLayer.addChild(entitiesRoot);
        worldLayer.addChild(childMapsContainer);
        worldLayer.addChild(placeOverlayContainer);
        worldLayer.addChild(fogGfx);
        worldLayer.addChild(overlayGfx);
        worldLayer.addChild(measureGfx);
        app.stage.addChild(worldLayer);

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
  }, [locationEpoch, props.api.id]);

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
  ]);

  useEffect(() => {
    if (!focusPlaceRequest || !map || focusPlaceRequest.mapId !== map.id) {
      return;
    }
    const isTargetPanel =
      activeMapPanelId === props.api.id ||
      (!activeMapPanelId && props.api.id === 'map-main');
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
      viewStore.getState().panels[props.api.id]?.camera ??
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
    viewStore.getState().setPanelCamera(props.api.id, nextCam);
    syncSceneRef.current?.();
  }, [focusPlaceRequest, map, activeMapPanelId, props.api.id]);

  useEffect(() => {
    if (!fitRequest || fitRequest.panelId !== props.api.id || !map || !hostRef.current) return;
    const host = hostRef.current;
    viewStore.getState().setPanelCamera(props.api.id, fitBoundsCamera(fitRequest.bounds ?? map.bounds, host.clientWidth, host.clientHeight, map.kind));
    viewStore.setState({fitRequest:null});
    syncSceneRef.current?.();
  }, [fitRequest, map?.id, props.api.id]);

  const fit = (selection = false) => {
    if (!map) return;
    const b = selection ? getSelectionBounds(selectedIds.flatMap(id => map.entities[id] ? [map.entities[id]!] : [])) : null;
    viewStore.setState({ fitRequest: { panelId: props.api.id, bounds: b ? { x: b.minX, y: b.minY, w: Math.max(.01,b.maxX-b.minX), h: Math.max(.01,b.maxY-b.minY) } : undefined, nonce: Date.now() } });
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
    viewStore.setState({ fitRequest: { panelId: props.api.id, bounds: { x: entity.x, y: entity.y, w: entity.w * scale, h: entity.h * scale }, nonce: Date.now() } });
    setCalibLine(null);
    viewStore.getState().setCalibratingImageId(null);
  };

  const handlePopout = () => {
    const panel = props.containerApi.getPanel(props.api.id);
    if (panel) {
      void props.containerApi.addPopoutGroup(panel);
    }
  };

  const handleDockBack = () => {
    const mainGroup = props.containerApi.groups.find(
      (g) => g.api.location.type === 'grid',
    );
    if (mainGroup) {
      props.api.moveTo({ group: mainGroup });
    }
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
      data-testid={`panel-${props.api.id}`}
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--atlas-border)',
          background: 'var(--atlas-surface)',
          fontSize: 12,
        }}
      >
        <strong>{map ? `${map.name} (${map.kind})` : 'No map'}</strong>
        {map && <>
          <button data-testid="fit-map" onClick={() => fit()}>Fit</button>
          <details className="context-menu"><summary>Map…</summary><div>
            <span>{entityCount} entities · {extentLabel(map.bounds)}</span>
            <button data-testid="fit-selection" disabled={!selectedIds.length} onClick={() => fit(true)}>Fit Selection</button>
            <label><input type="checkbox" checked={zoomThrough} onChange={e => viewStore.setState({ zoomThrough: e.target.checked })} />Zoom-through</label>
            <button onClick={() => openGenerationSettings(map, props.api.id, '', props.containerApi, 'map')}>Map settings…</button>
          </div></details>
        </>}
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
        {pullReport && pullReport.length > 0 && (
          <span
            data-testid="pull-kept-report"
            style={{
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
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!isPopout ? (
            <button
              type="button"
              data-testid={`popout-btn-${props.api.id}`}
              onClick={handlePopout}
            >
              Pop out
            </button>
          ) : (
            <button
              type="button"
              data-testid={`dockback-btn-${props.api.id}`}
              onClick={handleDockBack}
            >
              Dock back
            </button>
          )}
        </div>
      </div>
      {map && <GenerationControls map={map} panelId={props.api.id} api={props.containerApi} />}
      {activeToolId === 'measure' && map && world && <MeasureBar panelId={props.api.id} worldId={world.meta.id} mapId={map.id} />}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        <div
          ref={hostRef}
          data-testid={`canvas-host-${props.api.id}`}
          style={{ width: '100%', height: '100%' }}
        />
        {liveDimensions&&<div data-testid="live-dimensions" style={{position:'absolute',top:8,right:8,pointerEvents:'none',background:'#10151acc',color:'#f8fafc',fontSize:11,borderRadius:4,padding:6}}>Selection extent: {liveDimensions}</div>}
        {interactionMessage&&<div role="status" style={{position:'absolute',top:6,left:8,background:'#10151aee',color:'#f8fafc',fontSize:12,borderRadius:4,padding:8}} onClick={()=>viewStore.setState({interactionMessage:''})}>{interactionMessage}</div>}
        {panelState?.camera && <div style={{ position: 'absolute', bottom: 8, left: 10, pointerEvents: 'none', background: '#10151acc', color: '#f8fafc', fontSize: 11, borderRadius: 4, padding: 5 }}>
          <div style={{ width: 100, borderBottom: '2px solid #e5e7eb' }}>{distanceLabel(100 / panelState.camera.zoom)}</div>
        </div>}
        {calibratingImageId && (
          <div
            data-testid="calibration-bar"
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
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
