import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import type { Entity, MapDoc } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { fitBoundsCamera, zoomAtCursor, type CameraState } from './camera';
import { buildEntityDisplay } from './drawEntity';

export interface MapPanelParams {
  mapId?: string;
}

interface CachedEntityDisplay {
  rev: number;
  selected: boolean;
  layerId: string;
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
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const panelState = useStore(viewStore, (s) => s.panels[props.api.id]);
  const selectedIds = useStore(viewStore, (s) => s.selectedEntityIds);

  const effectiveMapId = props.params.mapId ?? panelState?.mapId ?? activeMapId;
  const map: MapDoc | undefined =
    effectiveMapId && world ? world.maps[effectiveMapId] : undefined;

  const mapRef = useRef<MapDoc | undefined>(map);
  mapRef.current = map;
  const selectedSetRef = useRef<Set<string>>(new Set(selectedIds));
  selectedSetRef.current = new Set(selectedIds);

  const scheduleRenderRef = useRef<(() => void) | null>(null);
  const syncSceneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const disposable = props.api.onDidLocationChange((event) => {
      setIsPopout(event.location.type === 'popout');
      setLocationEpoch((n) => n + 1);
    });
    return () => disposable.dispose();
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

    const syncScene = () => {
      if (disposed || !app.renderer) {
        return;
      }
      const m = mapRef.current;
      if (!m) {
        entitiesRoot.removeChildren();
        gridGfx.clear();
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
      for (const entity of Object.values(m.entities) as Entity[]) {
        const isSelected = selectedSet.has(entity.id);
        const cached = entityCache.get(entity.id);
        const needsRebuild =
          !cached ||
          cached.rev !== entity.rev ||
          cached.selected !== isSelected ||
          cached.layerId !== entity.layerId ||
          zoomChangedSignificantly;

        if (needsRebuild) {
          if (cached) {
            cached.container.destroy({ children: true });
          }
          const display = buildEntityDisplay(entity, {
            selected: isSelected,
            zoom: cam.zoom,
          });
          const targetLayer = layerContainers.get(entity.layerId);
          if (targetLayer) {
            targetLayer.addChild(display);
          }
          entityCache.set(entity.id, {
            rev: entity.rev,
            selected: isSelected,
            layerId: entity.layerId,
            container: display,
          });
        }
      }

      if (zoomChangedSignificantly) {
        lastZoomForRebuild = cam.zoom;
      }
      drawGrid(m, cam);
    };

    const scheduleRender = () => {
      if (disposed || dirty) {
        return;
      }
      dirty = true;
      rafId = ownerWin.requestAnimationFrame(() => {
        rafId = null;
        if (disposed || !app.renderer) {
          return;
        }
        dirty = false;
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
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) {
        return;
      }
      const cam = getCamera();
      viewStore.getState().setPanelCamera(props.api.id, {
        ...cam,
        x: cam.x + (e.clientX - lastX),
        y: cam.y + (e.clientY - lastY),
      });
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleRender();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!panning) {
        return;
      }
      panning = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
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
  }, [map, selectedIds]);

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
        ref={hostRef}
        data-testid={`canvas-host-${props.api.id}`}
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      />
    </div>
  );
}
