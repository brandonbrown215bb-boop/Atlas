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
import { flushDirtyWorld, startWorldPersistence } from '../model/persistence';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
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
  const worldPath = useStore(worldStore, (s) => s.worldPath);
  const canUndo = useStore(worldStore, (s) => s.history.past.length > 0);
  const canRedo = useStore(worldStore, (s) => s.history.future.length > 0);
  const dirtyWorld = useStore(worldStore, (s) => s.dirtyWorld);
  const dirtyMapIds = useStore(worldStore, (s) => s.dirtyMapIds);
  const isDirty = dirtyWorld || Object.keys(dirtyMapIds).length > 0;

  useEffect(() => {
    (window as unknown as { __atlasWorldStore?: typeof worldStore }).__atlasWorldStore =
      worldStore;
    return startWorldPersistence();
  }, []);

  useEffect(() => {
    applyThemeToAllWindows(theme, apiRef.current);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        worldStore.getState().undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' ||
          (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        worldStore.getState().redo();
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
    api.addPanel({
      id: component,
      component,
      title,
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
          alignItems: 'center',
          gap: 8,
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
          disabled={!canUndo}
          onClick={() => worldStore.getState().undo()}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="btn-redo"
          disabled={!canRedo}
          onClick={() => worldStore.getState().redo()}
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
          onClick={() => openOrFocusPanel('places', 'Places')}
        >
          + Places
        </button>
        <span
          data-testid="save-status"
          style={{ marginLeft: 'auto', color: 'var(--atlas-text-muted)' }}
        >
          {world ? `${world.meta.name} — ${isDirty ? 'Unsaved' : 'Saved'}` : 'No world open'}
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
          <span>{errorBanner.message}</span>
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
