import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import './theme.css';
import { FloatingWindow } from './FloatingWindow';
import { PopoutPortal } from './PopoutPortal';
import { renderPanelBody } from './dock';
import { hudStore } from './hudStore';
import { startAgentBridge } from '../model/agentBridge';
import { editorHistory } from '../model/drawingHistory';
import { hasParentChanged } from '../geom/pullFromParent';
import { flushDirtyWorld, startWorldPersistence } from '../model/persistence';
import type { MapKind } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore, type ToolId } from '../model/viewStore';
import { activatePropTool } from '../panels/ContextTools';
import { ExportPanel } from '../panels/ExportPanel';
import { PlayerControls } from '../panels/PlayerControls';
import { TransferButton } from '../panels/TransferPanel';
import { MapView } from '../render/MapView';
import { GenerationControls } from '../panels/GenerationControls';

type ThemeMode = 'dark' | 'light';

function getInitialTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const layoutSaveTimerRef = useRef<number | null>(null);
  const layoutHydratedRef = useRef(false);

  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [errorBanner, setErrorBanner] = useState<{
    message: string;
    worldDir?: string;
    backups?: string[];
  } | null>(null);

  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const canUndo = useStore(worldStore, (s) => s.history.past.length > 0);
  const draftUndo = useStore(viewStore, (s) => s.draftUndo);
  const draftRedo = useStore(viewStore, (s) => s.draftRedo);
  const canRedo = useStore(worldStore, (s) => s.history.future.length > 0);
  const dirtyWorld = useStore(worldStore, (s) => s.dirtyWorld);
  const dirtyMapIds = useStore(worldStore, (s) => s.dirtyMapIds);
  const isDirty = dirtyWorld || Object.keys(dirtyMapIds).length > 0;
  const activeTool = useStore(viewStore, (s) => s.activeTool);
  const zoomThrough = useStore(viewStore, (s) => s.zoomThrough);

  const hudPanels = useStore(hudStore, (s) => s.panels);
  const dragOverMain = useStore(hudStore, (s) => s.dragOverMain);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (event.message) setErrorBanner({ message: event.error?.stack ?? event.message });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      setErrorBanner({
        message: error instanceof Error ? error.stack ?? error.message : String(error),
      });
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
        __atlasHudStore?: typeof hudStore;
      }
    ).__atlasWorldStore = worldStore;
    (
      window as unknown as {
        __atlasViewStore?: typeof viewStore;
      }
    ).__atlasViewStore = viewStore;
    (
      window as unknown as {
        __atlasHudStore?: typeof hudStore;
      }
    ).__atlasHudStore = hudStore;

    const stopPersist = startWorldPersistence();
    const stopAgent = startAgentBridge();
    return () => {
      stopPersist();
      stopAgent();
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Global UI layout load + persistence + popout IPC listeners.
  useEffect(() => {
    const stage = stageRef.current;
    const stageW = stage?.clientWidth || window.innerWidth;
    const stageH = stage?.clientHeight || Math.max(400, window.innerHeight - 36);

    void window.atlasApi?.loadUiLayout?.().then((saved) => {
      if (saved) {
        hudStore.getState().hydrateLayout(saved, stageW, stageH);
      } else {
        hudStore.getState().resetLayout(stageW, stageH);
      }
      layoutHydratedRef.current = true;
    });

    const unsubHud = hudStore.subscribe((state, prev) => {
      if (!layoutHydratedRef.current || state.panels === prev.panels) return;
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
      }
      layoutSaveTimerRef.current = window.setTimeout(() => {
        layoutSaveTimerRef.current = null;
        void window.atlasApi?.saveUiLayout?.({ panels: hudStore.getState().panels });
      }, 250);
    });

    const unsubDrag = window.atlasApi?.onPopoutDragOverMain?.((payload) => {
      hudStore.getState().setDragOverMain(
        payload.over ? { id: payload.id, relX: payload.relX, relY: payload.relY } : null,
      );
    });
    const unsubDock = window.atlasApi?.onPopoutDockBack?.((payload) => {
      hudStore.getState().setDragOverMain(null);
      hudStore.getState().dockBackPanel(payload.id, payload.relX, Math.max(4, payload.relY - 36));
    });
    const unsubClosed = window.atlasApi?.onPopoutClosed?.((id) => {
      const p = hudStore.getState().panels[id];
      if (p && p.mode === 'popout') {
        hudStore.getState().closePanel(id);
      }
    });

    let ro: ResizeObserver | null = null;
    if (stage) {
      ro = new ResizeObserver(() => {
        hudStore.getState().clampToStage(stage.clientWidth, stage.clientHeight);
      });
      ro.observe(stage);
    }

    const onBeforeUnload = () => {
      void window.atlasApi?.saveUiLayout?.({ panels: hudStore.getState().panels });
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      unsubHud();
      unsubDrag?.();
      unsubDock?.();
      unsubClosed?.();
      ro?.disconnect();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const activeMap = activeMapId && world ? world.maps[activeMapId] : undefined;
  const parentMap = activeMap?.parent && world ? world.maps[activeMap.parent.mapId] : undefined;
  const parentChanged = Boolean(activeMap && parentMap && hasParentChanged(activeMap, parentMap));

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
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select'))
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        editorHistory();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
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

  const handleNewWorld = async () => {
    const dir = await window.atlasApi.pickFolder('Choose folder for new world');
    if (!dir) return;
    setErrorBanner(null);
    await flushDirtyWorld();
    const res = await window.atlasApi.createWorld(dir, 'New World');
    viewStore.getState().setAssetsIndex({});
    worldStore.getState().loadWorld(res.meta, res.maps, res.worldDir);
  };

  const handleOpenWorld = async () => {
    const dir = await window.atlasApi.pickFolder('Open World Folder');
    if (!dir) return;
    await openWorldDir(dir);
  };

  // After a crash the main process reloads this window; put the world that was open back.
  useEffect(() => {
    void window.atlasApi.currentWorldDir().then(dir => {
      if (dir && !worldStore.getState().world) void openWorldDir(dir);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWorldDir = async (dir: string) => {
    await flushDirtyWorld();
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
    if (!errorBanner?.worldDir || !errorBanner.backups?.[0]) return;
    await flushDirtyWorld();
    const res = await window.atlasApi.restoreBackup(
      errorBanner.worldDir,
      errorBanner.backups[0],
    );
    setErrorBanner(null);
    worldStore.getState().loadWorld(res.meta, res.maps, res.worldDir);
  };

  const handleFitMainMap = () => {
    viewStore.setState({
      fitRequest: { panelId: 'map-main', nonce: Date.now() },
    });
  };

  const handleResetLayout = () => {
    const stage = stageRef.current;
    hudStore.getState().resetLayout(stage?.clientWidth, stage?.clientHeight);
  };

  const panelButtons: Array<{ id: string; label: string; testId?: string }> = [
    { id: 'tools', label: 'Tools' },
    { id: 'maps', label: 'Maps' },
    { id: 'layers', label: 'Layers' },
    { id: 'inspector', label: 'Inspector' },
    { id: 'generator', label: 'Generator' },
    { id: 'assets', label: 'Assets', testId: 'btn-assets' },
    { id: 'places', label: 'Places', testId: 'btn-places' },
    { id: 'settings', label: 'Settings', testId: 'btn-settings' },
  ];

  const openPanels = Object.values(hudPanels).filter((p) => p.open);

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
          alignItems: 'center',
          // Wrap instead of scrolling sideways: buttons that don't fit go to a second line, and the
          // transfer / player drawers (.top-drawer-row) drop below the bar instead of off-screen.
          flexWrap: 'wrap',
          gap: 5,
          rowGap: 4,
          minHeight: 34,
          padding: '4px 8px',
          background: 'var(--atlas-surface)',
          borderBottom: '1px solid var(--atlas-border)',
          fontSize: 12,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        <strong style={{ marginRight: 4 }}>Atlas</strong>
        <button type="button" data-testid="btn-new-world" onClick={handleNewWorld}>
          New
        </button>
        <button type="button" data-testid="btn-open-world" onClick={handleOpenWorld}>
          Open
        </button>
        <button
          type="button"
          data-testid="btn-save-now"
          disabled={!worldPath || !isDirty}
          onClick={() => void flushDirtyWorld()}
        >
          Save
        </button>
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

        {activeMap && (
          <>
            <span style={{ opacity: 0.3 }}>|</span>
            <span data-testid="active-map-title" style={{ fontWeight: 600 }}>
              {activeMap.name} <span style={{ color: 'var(--atlas-text-muted)', fontWeight: 400 }}>({activeMap.kind})</span>
            </span>
            <button type="button" data-testid="fit-map" onClick={handleFitMainMap}>
              Fit
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <input
                type="checkbox"
                checked={zoomThrough}
                onChange={(e) => viewStore.setState({ zoomThrough: e.target.checked })}
              />
              <span>Zoom-through</span>
            </label>
            {parentChanged && (
              <button
                type="button"
                data-testid="btn-pull-from-parent"
                onClick={() =>
                  void worldStore.getState().execute('map.pullFromParent', { mapId: activeMap.id })
                }
                style={{
                  background: '#f59e0b',
                  color: '#111827',
                  fontWeight: 600,
                }}
              >
                Pull from parent
              </button>
            )}
          </>
        )}

        <span style={{ opacity: 0.3 }}>|</span>
        {panelButtons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            data-testid={btn.testId ?? `btn-toggle-${btn.id}`}
            aria-pressed={Boolean(hudPanels[btn.id]?.open)}
            onClick={() => hudStore.getState().togglePanel(btn.id)}
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          data-testid="btn-add-map"
          onClick={() => hudStore.getState().openOrFocusPanel('map', 'map', 'Map')}
        >
          + Map
        </button>
        <button type="button" data-testid="btn-reset-layout" onClick={handleResetLayout}>
          Reset Layout
        </button>

        <span style={{ opacity: 0.3 }}>|</span>
        <PlayerControls />
        <ExportPanel />
        <TransferButton />
        <button
          type="button"
          data-testid="btn-toggle-theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>

        <span
          data-testid="save-status"
          style={{ marginLeft: 'auto', color: 'var(--atlas-text-muted)' }}
        >
          {world ? (
            <>
              {world.meta.name}
              {` — ${isDirty ? 'Unsaved' : 'Saved'}`}
            </>
          ) : (
            'No world open'
          )}
        </span>
      </header>

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
          <span
            style={{
              minWidth: 0,
              maxHeight: 120,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {errorBanner.message}
          </span>
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

      {/* Generate for the current map/selection, always in view: it sits above the map, so floating panels can't cover it. */}
      {activeMap && <GenerationControls map={activeMap} panelId="map-main" />}

      <div
        ref={stageRef}
        data-testid="map-stage"
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
      >
        <MapView panelId="map-main" isMainMap />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {openPanels
            .filter((p) => p.mode === 'floating')
            .map((panel) => (
              <FloatingWindow key={panel.id} panel={panel} stageRef={stageRef}>
                {renderPanelBody(panel)}
              </FloatingWindow>
            ))}

          {openPanels
            .filter((p) => p.mode === 'popout')
            .map((panel) => (
              <PopoutPortal key={panel.id} panel={panel} theme={theme}>
                {renderPanelBody(panel)}
              </PopoutPortal>
            ))}

          {dragOverMain && (
            <div
              style={{
                position: 'absolute',
                left: Math.max(12, dragOverMain.relX - 110),
                top: Math.max(12, dragOverMain.relY - 40),
                width: 220,
                height: 60,
                border: '2px dashed var(--atlas-accent)',
                borderRadius: 8,
                background: 'rgba(88, 166, 255, 0.16)',
                color: 'var(--atlas-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Drop to dock
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
