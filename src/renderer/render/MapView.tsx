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
import { buildEntityDisplay } from './drawEntity';
import {
  getCachedAssetTexture,
  loadAssetTexture,
  resolveWorldAssetUrl,
} from './textures';
import { createAreaTool } from '../tools/areaTool';
import { createDevelopAreaTool } from '../tools/developAreaTool';
import { createDoorTool } from '../tools/doorTool';
import { createLabelTool } from '../tools/labelTool';
import { createLightTool } from '../tools/lightTool';
import { createPathTool } from '../tools/pathTool';
import { createPointEditTool } from '../tools/pointEditTool';
import { createPortalTool } from '../tools/portalTool';
import { createSelectTool } from '../tools/selectTool';
import { createWallTool } from '../tools/wallTool';
import type { MapTool, ToolContext } from '../tools/types';

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
  const [renderCount, setRenderCount] = useState(0);

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

  const [calibLine, setCalibLine] = useState<{
    start: Point;
    end: Point;
    pendingConfirm: boolean;
  } | null>(null);
  const [calibLengthInput, setCalibLengthInput] = useState('100');
  const [calibUnit, setCalibUnit] = useState<'ft' | 'mi' | 'm'>('ft');
  const [textureVersion, setTextureVersion] = useState(0);

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
      viewStore.getState().setActiveMapPanelId(props.api.id);
    }
    const locDisposable = props.api.onDidLocationChange((event) => {
      setIsPopout(event.location.type === 'popout');
      setLocationEpoch((n) => n + 1);
    });
    const activeDisposable = props.api.onDidActiveChange((event) => {
      if (event.isActive) {
        viewStore.getState().setActiveMapPanelId(props.api.id);
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

    const selectTool = createSelectTool();
    const areaTool = createAreaTool();
    const pathTool = createPathTool();
    const pointEditTool = createPointEditTool();
    const wallTool = createWallTool();
    const doorTool = createDoorTool();
    const lightTool = createLightTool();
    const labelTool = createLabelTool();
    const portalTool = createPortalTool();
    const developAreaTool = createDevelopAreaTool();
    const getActiveTool = (): MapTool => {
      switch (activeToolIdRef.current) {
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
        default:
          return selectTool;
      }
    };

    const layerContainers = new Map<string, Container>();
    const entityCache = new Map<string, CachedEntityDisplay>();

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
      viewStore.getState().setPanelCamera(props.api.id, initial);
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

    const syncScene = () => {
      if (disposed || !app.renderer) {
        return;
      }
      const m = mapRef.current;
      if (!m) {
        entitiesRoot.removeChildren();
        childMapsContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
        placeOverlayContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
        gridGfx.clear();
        overlayGfx.clear();
        return;
      }

      const cam = getCamera();
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

      // Remove deleted entities from cache
      for (const [eid, cached] of entityCache) {
        if (!m.entities[eid]) {
          cached.container.destroy({ children: true });
          entityCache.delete(eid);
        }
      }

      // Add or update changed entities only
      const selectedSet = selectedSetRef.current;
      const layerGmMap = new Map(m.layers.map((l) => [l.id, l.gmOnly]));
      const activeTool = getActiveTool();
      const previewMap = activeTool.getPreviewEntities?.() ?? null;
      for (const rawEntity of Object.values(m.entities) as Entity[]) {
        const isPreview = Boolean(previewMap?.has(rawEntity.id));
        const entity = previewMap?.get(rawEntity.id) ?? rawEntity;
        let texture: Texture | undefined;
        if (entity.type === 'image') {
          const url = resolveWorldAssetUrl(
            worldPathRef.current,
            assetsIndexRef.current,
            entity.assetId,
          );
          if (url) {
            texture = getCachedAssetTexture(url);
            if (!texture) {
              void loadAssetTexture(url, () => {
                if (!disposed) {
                  setTextureVersion((v) => v + 1);
                }
              });
            }
          }
        }

        const hasTexture = Boolean(texture);
        const isSelected = selectedSet.has(entity.id);
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
          childContainer.addChild(frame);

          const childLayerGmMap = new Map(childMap.layers.map((l) => [l.id, l.gmOnly]));
          const childLayerVisMap = new Map(childMap.layers.map((l) => [l.id, l.visible]));
          for (const layer of childMap.layers) {
            if (!childLayerVisMap.get(layer.id)) continue;
            for (const ent of Object.values(childMap.entities)) {
              if (ent.layerId !== layer.id) continue;
              const disp = buildEntityDisplay(ent, {
                selected: false,
                zoom: cam.zoom,
                layerGmOnly: Boolean(childLayerGmMap.get(layer.id)),
              });
              childContainer.addChild(disp);
            }
          }
          childMapsContainer.addChild(childContainer);
        }
      }

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
      activeTool.drawOverlay(overlayGfx, buildToolContext(m));
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
        getActiveTool().onKey(e, buildToolContext(m));
      }
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
      viewStore.getState().setActiveMapPanelId(props.api.id);
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
      if (currentWorld && e.deltaY < 0) {
        const children = Object.values(currentWorld.maps).filter(
          (c) => c.parent?.mapId === m.id && c.kind !== 'interior',
        );
        const zoomTarget = findZoomInChild(nextCam, m.kind, children, viewW, viewH);
        if (zoomTarget && zoomTarget.parent) {
          const childCam = parentToChildCamera(
            nextCam,
            { x: zoomTarget.parent.x, y: zoomTarget.parent.y },
            zoomTarget.kind,
          );
          viewStore.getState().setSelection([]);
          viewStore.getState().setPanelMap(props.api.id, zoomTarget.id);
          viewStore.getState().setPanelCamera(props.api.id, childCam);
          worldStore.getState().setActiveMap(zoomTarget.id);
          syncScene();
          scheduleRender();
          return;
        }
      } else if (
        currentWorld &&
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
          worldStore.getState().setActiveMap(parentMap.id);
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
          app.destroy(true, { children: true, texture: true });
          return;
        }
        app.stage.eventMode = 'none';
        worldLayer.addChild(gridGfx);
        worldLayer.addChild(entitiesRoot);
        worldLayer.addChild(childMapsContainer);
        worldLayer.addChild(placeOverlayContainer);
        worldLayer.addChild(overlayGfx);
        app.stage.addChild(worldLayer);

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        ownerWin.addEventListener('keydown', onKeyDown);
        ownerWin.addEventListener('keyup', onKeyUp);

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
      ownerWin.removeEventListener('keydown', onKeyDown);
      ownerWin.removeEventListener('keyup', onKeyUp);
      if (app.renderer) {
        app.destroy(true, { children: true, texture: true });
      }
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
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--atlas-border)',
          background: 'var(--atlas-surface)',
          fontSize: 12,
        }}
      >
        <strong>{map ? `${map.name} (${map.kind})` : 'No map'}</strong>
        <span style={{ color: 'var(--atlas-text-muted)' }}>
          {entityCount} entities
        </span>
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
