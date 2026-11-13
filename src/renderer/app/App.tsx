import { useEffect, useRef } from 'react';
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
} from 'dockview-react';
import { useStore } from 'zustand';
import 'dockview-react/dist/styles/dockview.css';
import { startWorldPersistence } from '../model/persistence';
import { worldStore } from '../model/store';
import { ThrowawayMapView } from '../spike/ThrowawayMapView';

const components = {
  throwawayMap: ThrowawayMapView,
};

function getPopoutUrl(): string {
  return window.location.protocol === 'app:'
    ? 'app://atlas/popout.html'
    : '/popout.html';
}

export function App() {
  const apiRef = useRef<DockviewApi | null>(null);
  const world = useStore(worldStore, (s) => s.world);
  const dirtyWorld = useStore(worldStore, (s) => s.dirtyWorld);
  const dirtyMapIds = useStore(worldStore, (s) => s.dirtyMapIds);
  const isDirty = dirtyWorld || Object.keys(dirtyMapIds).length > 0;

  useEffect(() => {
    return startWorldPersistence();
  }, []);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;

    event.api.onWillClosePopoutWindow((popoutEvent) => {
      void window.atlasApi.closePopout(popoutEvent.id);
    });

    const panel1 = event.api.addPanel({
      id: 'map-1',
      component: 'throwawayMap',
      title: 'Map 1',
      params: { label: 'Map 1' },
    });

    event.api.addPanel({
      id: 'map-2',
      component: 'throwawayMap',
      title: 'Map 2',
      params: { label: 'Map 2' },
      position: { referencePanel: panel1, direction: 'right' },
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
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        data-testid="status-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '4px 10px',
          fontSize: 12,
          borderBottom: '1px solid #30363d',
        }}
      >
        <span>{world ? world.meta.name : 'No world open'}</span>
        <span data-testid="save-status" style={{ opacity: 0.7 }}>
          {world ? (isDirty ? 'Unsaved changes' : 'Saved') : ''}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DockviewReact
          components={components}
          theme={themeDark}
          popoutUrl={getPopoutUrl()}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
