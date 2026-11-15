import { DEFAULT_BIOMES } from '../model/schema';
import { activatePropTool, ContextTools } from '../panels/ContextTools';
import { editorHistory } from '../model/drawingHistory';
import { extentLabel } from '../model/mapDefaults';
import { navigateToMap } from '../model/navigation';
import { TransferPanel } from '../panels/TransferPanel';
import { ExportPanel } from '../panels/ExportPanel';
import { PlayerControls } from '../panels/PlayerControls';
import { useEffect, useRef, useState } from 'react';
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type SerializedDockview,
} from 'dockview-react';
import { useStore } from 'zustand';
import 'dockview-react/dist/styles/dockview.css';
import './theme.css';
import { startAgentBridge } from '../model/agentBridge';
import { flushDirtyWorld, startWorldPersistence } from '../model/persistence';
import {
  MapKindSchema,
  type AreaRole,
  type MapKind,
  type PathRole,
} from '../model/schema';
import { worldStore } from '../model/store';
import {
  viewStore,
  type DoorKind,
  type DrawMode,
  type PointEditMode,
  type ToolId,
} from '../model/viewStore';
import { buildDefaultLayout, panelComponents, type PanelComponentKey } from './dock';

type ThemeMode = 'dark' | 'light';

function getInitialTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function getPopoutUrl(): string {
  return window.location.protocol === 'app:'
    ? 'app://atlas/popout.html'
    : '/popout.html';
}

function applyThemeToAllWindows(theme: ThemeMode, api: DockviewApi | null): void {
  document.documentElement.setAttribute('data-theme', theme);
  if (!api) {
    return;
  }
  const seenDocs = new Set<Document>([document]);
  for (const panel of api.panels) {
    const doc = panel.view?.content?.element?.ownerDocument;
    if (doc && !seenDocs.has(doc)) {
      seenDocs.add(doc);
      doc.documentElement.setAttribute('data-theme', theme);
    }
  }
}

export function App() {
  const apiRef = useRef<DockviewApi | null>(null);
  const restoringLayoutRef = useRef(false);
  const layoutSaveTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;
  const [errorBanner, setErrorBanner] = useState<{
    message: string;
    worldDir?: string;
    backups?: string[];
  } | null>(null);

  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const assetError = useStore(viewStore, (s) => s.assetError);
  const canUndo = useStore(worldStore, (s) => s.history.past.length > 0);
  const draftUndo = useStore(viewStore, s => s.draftUndo);
  const draftRedo = useStore(viewStore, s => s.draftRedo);
  const canRedo = useStore(worldStore, (s) => s.history.future.length > 0);
  const dirtyWorld = useStore(worldStore, (s) => s.dirtyWorld);
  const dirtyMapIds = useStore(worldStore, (s) => s.dirtyMapIds);
  const isDirty = dirtyWorld || Object.keys(dirtyMapIds).length > 0;

  const activeTool = useStore(viewStore, (s) => s.activeTool);
  const drawMode = useStore(viewStore, (s) => s.drawMode);
  const pointEditMode = useStore(viewStore, (s) => s.pointEditMode);
  const snapToGrid = useStore(viewStore, (s) => s.snapToGrid);
  const areaRole = useStore(viewStore, (s) => s.areaRole);
  const pathRole = useStore(viewStore, (s) => s.pathRole);
  const biomeName = useStore(viewStore,s=>s.biomeName);
  const biomeRadius = useStore(viewStore,s=>s.biomeRadius);
  const biomeErase = useStore(viewStore,s=>s.biomeErase);
  const pathWidth = useStore(viewStore, (s) => s.pathWidth);
  const pathClosed = useStore(viewStore, (s) => s.pathClosed);
  const wallSnapToGrid = useStore(viewStore, (s) => s.wallSnapToGrid);
  const wallBlocksMove = useStore(viewStore, (s) => s.wallBlocksMove);
  const wallBlocksSight = useStore(viewStore, (s) => s.wallBlocksSight);
  const doorKind = useStore(viewStore, (s) => s.doorKind);
  const lightRadius = useStore(viewStore, (s) => s.lightRadius);
  const lightColor = useStore(viewStore, (s) => s.lightColor);
  const labelText = useStore(viewStore, (s) => s.labelText);
  const labelSize = useStore(viewStore, (s) => s.labelSize);
  const portalTargetMapId = useStore(viewStore, (s) => s.portalTargetMapId);
  const developAreaKind = useStore(viewStore, (s) => s.developAreaKind);
  const pendingDevelopRect = useStore(viewStore, (s) => s.pendingDevelopRect);
  const [developName, setDevelopName] = useState('Developed Area');

  useEffect(() => {
    // Canvas callbacks and async jobs run outside React's panel error boundaries.
    const onError = (event: ErrorEvent) => {
      if (event.message) setErrorBanner({ message: event.error?.stack ?? event.message });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      setErrorBanner({ message: error instanceof Error ? error.stack ?? error.message : String(error) });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    (
      window as unknown as {
        __atlasWorldStore?: typeof worldStore;
        __atlasViewStore?: typeof viewStore;
      }
    ).__atlasWorldStore = worldStore;
    (
      window as unknown as {
        __atlasViewStore?: typeof viewStore;
      }
    ).__atlasViewStore = viewStore;
    const stopPersist = startWorldPersistence();
    const stopAgent = startAgentBridge();
    return () => {
      stopPersist();
      stopAgent();
    };
  }, []);

  useEffect(() => {
    applyThemeToAllWindows(theme, apiRef.current);
  }, [theme]);

  const activeMap = activeMapId && world ? world.maps[activeMapId] : undefined;

  useEffect(() => {
    if (activeTool !== 'developArea' || !activeMap) return;
    const defaultChildKind: MapKind =
      activeMap.kind === 'world'
        ? 'region'
        : activeMap.kind === 'region'
          ? 'settlement'
          : activeMap.kind === 'settlement'
            ? 'site'
            : 'settlement';
    viewStore.getState().setDevelopAreaKind(defaultChildKind);
  }, [activeTool, activeMap?.id, activeMap?.kind]);

  useEffect(() => {
    const shortcutTools: Record<string, ToolId> = {
      v: 'select',
      a: 'area',
      p: 'path',
      w: 'wall',
      d: 'door',
      e: 'pointEdit',
      b: 'biome',
      l: 'label',
      m: 'measure',
      f: 'fog',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select'))) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        editorHistory();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' ||
          (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        editorHistory(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) {
        return;
      }
      if (e.key === 'Escape') {
        const vs = viewStore.getState();
        if (vs.pendingDevelopRect) {
          e.preventDefault();
          vs.setPendingDevelopRect(null);
          return;
        }
        if (vs.activeTool !== 'select') {
          e.preventDefault();
          vs.setActiveTool('select');
        }
        return;
      }
      if (e.repeat || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'o') {
        e.preventDefault();
        const mid = worldStore.getState().activeMapId;
        const m = mid ? worldStore.getState().world?.maps[mid] : undefined;
        activatePropTool(m?.kind);
        return;
      }
      const tool = shortcutTools[key];
      if (tool) {
        e.preventDefault();
        viewStore.getState().setActiveTool(tool);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const saveCurrentLayoutNow = async () => {
    const api = apiRef.current;
    const currentWorld = worldStore.getState().world;
    if (!api || !currentWorld) {
      return;
    }
    await window.atlasApi.saveLayout(currentWorld.meta.id, api.toJSON());
  };

  useEffect(() => {
    const onBeforeUnload = () => {
      void saveCurrentLayoutNow();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const restoreOrDefaultLayout = async (worldId: string) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    restoringLayoutRef.current = true;
    try {
      const saved = (await window.atlasApi.loadLayout(
        worldId,
      )) as SerializedDockview | null;
      if (saved && typeof saved === 'object' && 'grid' in saved) {
        try {
          api.fromJSON(saved);
          // Re-apply theme to any restored popout windows once they settle
          window.setTimeout(() => applyThemeToAllWindows(themeRef.current, api), 150);
          return;
        } catch {
          // Fall back to default layout if saved layout is incompatible
        }
      }
      if (api.panels.length === 0) {
        buildDefaultLayout(api);
      }
    } finally {
      window.setTimeout(() => {
        restoringLayoutRef.current = false;
      }, 250);
    }
  };

  // When a world is loaded (including via IPC/test), restore its layout
  const loadedWorldId = world?.meta.id ?? null;
  useEffect(() => {
    if (loadedWorldId && apiRef.current) {
      void restoreOrDefaultLayout(loadedWorldId);
    }
  }, [loadedWorldId]);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;

    event.api.onWillClosePopoutWindow((popoutEvent) => {
      void window.atlasApi.closePopout(popoutEvent.id);
    });

    event.api.onDidLayoutChange(() => {
      applyThemeToAllWindows(themeRef.current, event.api);
      if (restoringLayoutRef.current) {
        return;
      }
      const currentWorld = worldStore.getState().world;
      if (!currentWorld) {
        return;
      }
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
      }
      layoutSaveTimerRef.current = window.setTimeout(() => {
        layoutSaveTimerRef.current = null;
        void window.atlasApi.saveLayout(
          currentWorld.meta.id,
          event.api.toJSON(),
        );
      }, 300);
    });

    if (worldStore.getState().world) {
      void restoreOrDefaultLayout(worldStore.getState().world!.meta.id);
    } else {
      buildDefaultLayout(event.api);
    }
  };

  const handleNewWorld = async () => {
    const dir = await window.atlasApi.pickFolder('Choose folder for new world');
    if (!dir) {
      return;
    }
    setErrorBanner(null);
    const res = await window.atlasApi.createWorld(dir, 'New World');
    viewStore.getState().setAssetsIndex({});
    worldStore.getState().loadWorld(res.meta, res.maps, res.worldDir);
  };

  const handleOpenWorld = async () => {
    const dir = await window.atlasApi.pickFolder('Open World Folder');
    if (!dir) {
      return;
    }
    const res = await window.atlasApi.openWorld(dir);
    if (!res.ok) {
      setErrorBanner({
        message: res.error,
        worldDir: dir,
        backups: res.backups,
      });
      return;
    }
    setErrorBanner(null);
    const index = await window.atlasApi.listWorldAssets(res.worldDir);
    viewStore.getState().setAssetsIndex(index);
    worldStore.getState().loadWorld(res.meta, res.maps, res.worldDir);
  };

  const handleRestoreLatestBackup = async () => {
    if (!errorBanner?.worldDir || !errorBanner.backups?.[0]) {
      return;
    }
    const res = await window.atlasApi.restoreBackup(
      errorBanner.worldDir,
      errorBanner.backups[0],
    );
    setErrorBanner(null);
    worldStore.getState().loadWorld(res.meta, res.maps, res.worldDir);
  };

  const openOrFocusPanel = (component: PanelComponentKey, title: string) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    if (component === 'map') {
      const existingMap = api.panels.find((p) => p.id.startsWith('map-'));
      api.addPanel({
        id: `map-${crypto.randomUUID().slice(0, 6)}`,
        component: 'map',
        title,
        position: existingMap
          ? { referencePanel: existingMap, direction: 'right' }
          : undefined,
      });
      return;
    }
    const existing = api.panels.find((p) => p.id === component);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const inspectorPanel = api.panels.find((p) => p.id === 'inspector');
    const layersPanel = api.panels.find((p) => p.id === 'layers');
    const position =
      component === 'maps'
        ? undefined
        : inspectorPanel
          ? ({ referencePanel: inspectorPanel, direction: 'within' } as const)
          : layersPanel
            ? ({ referencePanel: layersPanel, direction: 'below' } as const)
            : undefined;
    api.addPanel({
      id: component,
      component,
      title,
      position,
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--atlas-bg)',
        color: 'var(--atlas-text)',
      }}
    >
      <header
        data-testid="menu-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'var(--atlas-surface)',
          borderBottom: '1px solid var(--atlas-border)',
          fontSize: 12,
        }}
      >
        <strong style={{ marginRight: 6 }}>Campaign Atlas</strong>
        <button type="button" data-testid="btn-new-world" onClick={handleNewWorld}>
          New World
        </button>
        <button type="button" data-testid="btn-open-world" onClick={handleOpenWorld}>
          Open World
        </button>
        <button
          type="button"
          data-testid="btn-save-now"
          disabled={!worldPath || !isDirty}
          onClick={() => void flushDirtyWorld()}
        >
          Save
        </button>
        <span style={{ opacity: 0.3 }}>|</span>
        <button
          type="button"
          data-testid="btn-undo"
          disabled={!canUndo && !draftUndo}
          onClick={() => editorHistory()}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="btn-redo"
          disabled={!canRedo && !draftRedo}
          onClick={() => editorHistory(true)}
        >
          Redo
        </button>
        <span style={{ opacity: 0.3 }}>|</span>
        <button
          type="button"
          data-testid="btn-toggle-theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          Theme: {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
        <button
          type="button"
          data-testid="btn-add-map"
          onClick={() => openOrFocusPanel('map', 'Map')}
        >
          + Map
        </button>
        <button
          type="button"
          data-testid="btn-places"
          onClick={() => openOrFocusPanel('places', 'Places')}
        >
          + Places
        </button>
        <button
          type="button"
          data-testid="btn-assets"
          onClick={() => openOrFocusPanel('assets', 'Assets')}
        >
          Assets
        </button>
        <button
          type="button"
          data-testid="btn-settings"
          onClick={() => openOrFocusPanel('settings', 'Settings')}
        >
          Settings
        </button>
        <span style={{ opacity: 0.3 }}>|</span>
        <PlayerControls />
        <ExportPanel />
        <TransferPanel />
        <span
          data-testid="save-status"
          style={{ marginLeft: 'auto', color: 'var(--atlas-text-muted)', order: 1 }}
        >
          {world ? (
            <>
              {world.meta.name}
              {activeMapId && (
                <> · {world.meta.maps.find((m) => m.id === activeMapId)?.name}</>
              )}
              {` — ${isDirty ? 'Unsaved' : 'Saved'}`}
            </>
          ) : (
            'No world open'
          )}
        </span>
      </header>

      <div
        data-testid="tool-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          background: 'var(--atlas-surface)',
          borderBottom: '1px solid var(--atlas-border)',
          fontSize: 12,
        }}
      >
        <ContextTools onOpenAssets={() => openOrFocusPanel('assets', 'Assets')} />
        {activeTool === 'biome' && <>
          <label>Biome <select aria-label="Paint biome" value={biomeName} onChange={e=>viewStore.setState({biomeName:e.target.value})}>{(world?.meta.climate?.biomes ?? DEFAULT_BIOMES).map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select></label>
          <label>Brush radius (ft) <input aria-label="Biome brush radius" type="number" min="1" value={Number((biomeRadius/.3048).toFixed(1))} onChange={e=>viewStore.setState({biomeRadius:Math.max(.3048,Number(e.target.value)*.3048)})} /></label>
          <label><input type="checkbox" checked={biomeErase} onChange={e=>viewStore.setState({biomeErase:e.target.checked})} />Erase</label>
        </>}
        {activeTool === 'pointEdit' && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Mode:</span>
              <select
                data-testid="select-point-edit-mode"
                value={pointEditMode}
                onChange={(e) =>
                  viewStore
                    .getState()
                    .setPointEditMode(e.target.value as PointEditMode)
                }
              >
                <option value="edit">Edit vertices</option>
                <option value="add">Add to area</option>
                <option value="subtract">Subtract (carve hole)</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                data-testid="checkbox-snap-grid"
                checked={snapToGrid}
                onChange={(e) =>
                  viewStore.getState().setSnapToGrid(e.target.checked)
                }
              />
              <span>Snap to grid</span>
            </label>
          </>
        )}

        {(activeTool === 'area' || activeTool === 'path') && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Mode:</span>
              <select
                data-testid="select-draw-mode"
                value={drawMode}
                onChange={(e) =>
                  viewStore.getState().setDrawMode(e.target.value as DrawMode)
                }
              >
                <option value="click">Click points</option>
                <option value="freehand">Freehand</option>
              </select>
            </label>

            {activeTool === 'area' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>Role:</span>
                <select
                  data-testid="select-area-role"
                  value={areaRole}
                  onChange={(e) =>
                    viewStore.getState().setAreaRole(e.target.value as AreaRole)
                  }
                >
                  <option value="land">land</option>
                  <option value="water">water</option>
                  <option value="plateau">plateau</option>
                  <option value="district">district</option>
                  <option value="building">building</option>
                  <option value="floor">floor</option>
                  {(world?.meta.climate?.biomes ?? DEFAULT_BIOMES).map(b=><option key={b.name} value={`biome:${b.name}`}>{b.name}</option>)}
                </select>
              </label>
            )}

            {activeTool === 'path' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>Role:</span>
                  <select
                    data-testid="select-path-role"
                    value={pathRole}
                    onChange={(e) =>
                      viewStore.getState().setPathRole(e.target.value as PathRole)
                    }
                  >
                    <option value="road">road</option>
                    <option value="river">river</option>
                    <option value="cliff">cliff</option>
                    <option value="cityWall">cityWall</option>
                    <option value="trail">trail</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>New path width (ft):</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={Number((pathWidth/.3048).toFixed(2))}
                    onChange={(e) => {
                      const val = Number.parseFloat(e.target.value);
                      if (Number.isFinite(val) && val > 0) {
                        viewStore.getState().setPathWidth(val * .3048);
                      }
                    }}
                    style={{ width: 56 }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={pathClosed}
                    onChange={(e) =>
                      viewStore.getState().setPathClosed(e.target.checked)
                    }
                  />
                  <span>Closed</span>
                </label>
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                data-testid="checkbox-snap-grid"
                checked={snapToGrid}
                onChange={(e) =>
                  viewStore.getState().setSnapToGrid(e.target.checked)
                }
              />
              <span>Snap to grid</span>
            </label>
          </>
        )}

        {(activeTool === 'area' || activeTool === 'path' || activeTool === 'wall' ||
          (activeTool === 'pointEdit' && pointEditMode !== 'edit')) && (
          <small>Enter: finish · Ctrl+Z / Backspace: undo point · Ctrl+Y: redo point · Esc: cancel</small>
        )}

        {activeTool === 'wall' && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                data-testid="checkbox-wall-snap"
                checked={wallSnapToGrid}
                onChange={(e) =>
                  viewStore.getState().setWallSnapToGrid(e.target.checked)
                }
              />
              <span>Snap to grid</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={wallBlocksMove}
                onChange={(e) =>
                  viewStore.getState().setWallBlocksMove(e.target.checked)
                }
              />
              <span>Blocks move</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={wallBlocksSight}
                onChange={(e) =>
                  viewStore.getState().setWallBlocksSight(e.target.checked)
                }
              />
              <span>Blocks sight</span>
            </label>
          </>
        )}

        {activeTool === 'door' && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Kind:</span>
              <select
                data-testid="select-door-kind"
                value={doorKind}
                onChange={(e) =>
                  viewStore.getState().setDoorKind(e.target.value as DoorKind)
                }
              >
                <option value="door">door</option>
                <option value="secret">secret</option>
              </select>
            </label>
          </>
        )}

        {activeTool === 'light' && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Radius (m):</span>
              <input
                type="number"
                min={0.5}
                step={1}
                value={lightRadius}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value);
                  if (Number.isFinite(val) && val > 0) {
                    viewStore.getState().setLightRadius(val);
                  }
                }}
                style={{ width: 56 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Color:</span>
              <input
                type="color"
                value={lightColor}
                onChange={(e) =>
                  viewStore.getState().setLightColor(e.target.value)
                }
              />
            </label>
          </>
        )}

        {activeTool === 'label' && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Text:</span>
              <input
                type="text"
                value={labelText}
                onChange={(e) =>
                  viewStore.getState().setLabelText(e.target.value)
                }
                style={{ width: 110 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Size:</span>
              <input
                type="number"
                min={6}
                step={2}
                value={labelSize}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value);
                  if (Number.isFinite(val) && val >= 1) {
                    viewStore.getState().setLabelSize(val);
                  }
                }}
                style={{ width: 56 }}
              />
            </label>
          </>
        )}

        {activeTool === 'portal' && world && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Target map:</span>
              <select
                data-testid="select-portal-target"
                value={portalTargetMapId ?? world.meta.maps[0]?.id ?? ''}
                onChange={(e) =>
                  viewStore.getState().setPortalTargetMapId(e.target.value)
                }
              >
                {world.meta.maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.kind})
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {activeTool === 'developArea' && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            {pendingDevelopRect ? (
              (() => {
                const confirmDevelopArea = () => {
                  if (!developName.trim()) return;
                  const res = worldStore.getState().execute('map.developArea', {
                    parentMapId: pendingDevelopRect.mapId,
                    name: developName.trim(),
                    kind: developAreaKind,
                    rect: pendingDevelopRect.rect,
                  }) as { id: string };
                  const vs = viewStore.getState();
                  vs.setPendingDevelopRect(null);
                  vs.setActiveTool('select');
                  const targetPanelId = vs.activeMapPanelId ?? 'map-main';
                  vs.setPanelMap(targetPanelId, res.id);
                  navigateToMap(res.id);
                };
                return <>
                  <span>{extentLabel(pendingDevelopRect.rect)}</span>
                  <label>Width (mi) <input data-testid="develop-area-width" type="number" min="0.0001" step="0.01" value={Number((pendingDevelopRect.rect.w/1609.344).toFixed(4))} onChange={e=>{const w=Number(e.target.value)*1609.344;if(w>0)viewStore.getState().setPendingDevelopRect({...pendingDevelopRect,rect:{...pendingDevelopRect.rect,x:pendingDevelopRect.rect.x+(pendingDevelopRect.rect.w-w)/2,w}});}} /></label>
                  <label>Height (mi) <input data-testid="develop-area-height" type="number" min="0.0001" step="0.01" value={Number((pendingDevelopRect.rect.h/1609.344).toFixed(4))} onChange={e=>{const h=Number(e.target.value)*1609.344;if(h>0)viewStore.getState().setPendingDevelopRect({...pendingDevelopRect,rect:{...pendingDevelopRect.rect,y:pendingDevelopRect.rect.y+(pendingDevelopRect.rect.h-h)/2,h}});}} /></label>
                  {developAreaKind==='settlement'&&pendingDevelopRect.rect.w*pendingDevelopRect.rect.h>16000000&&<span>This is region-sized. You can develop it, but draw a district under 6.18 sq mi for town generation.</span>}
                  <input
                    type="text"
                    data-testid="develop-area-name"
                    placeholder="Child map name..."
                    value={developName}
                    onChange={(e) => setDevelopName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmDevelopArea();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        viewStore.getState().setPendingDevelopRect(null);
                      }
                    }}
                    style={{ width: 130 }}
                  />
                  <select
                    data-testid="select-develop-kind"
                    value={developAreaKind}
                    onChange={(e) =>
                      viewStore.getState().setDevelopAreaKind(e.target.value as MapKind)
                    }
                  >
                    {MapKindSchema.options
                      .filter((k) => k !== 'interior')
                      .map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    data-testid="btn-confirm-develop"
                    disabled={developName.trim().length === 0}
                    onClick={confirmDevelopArea}
                  >
                    Create Child Map
                  </button>
                  <button
                    type="button"
                    data-testid="btn-cancel-develop"
                    onClick={() => viewStore.getState().setPendingDevelopRect(null)}
                  >
                    Cancel
                  </button>
                </>;
              })()
            ) : (
              <span style={{ color: 'var(--atlas-text-muted)' }}>
                Drag a rectangle on the map to develop a child area
              </span>
            )}
          </>
        )}

        {assetError && (
          <span
            data-testid="toolbar-asset-error"
            style={{ color: 'var(--atlas-danger)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span>{assetError}</span>
            <button type="button" aria-label="Dismiss asset error" onClick={() => viewStore.setState({ assetError: '' })}>
              ×
            </button>
          </span>
        )}
      </div>

      {errorBanner && (
        <div
          data-testid="error-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            background: 'var(--atlas-danger)',
            color: '#fff',
            fontSize: 12,
          }}
        >
          <span style={{ minWidth: 0, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{errorBanner.message}</span>
          {errorBanner.backups && errorBanner.backups.length > 0 && (
            <button type="button" onClick={handleRestoreLatestBackup}>
              Restore newest backup ({errorBanner.backups[0]})
            </button>
          )}
          <button
            type="button"
            style={{ marginLeft: 'auto' }}
            onClick={() => setErrorBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <DockviewReact
          components={panelComponents}
          theme={theme === 'dark' ? themeDark : themeLight}
          popoutUrl={getPopoutUrl()}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
