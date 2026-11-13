import { useRef } from 'react';
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
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
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <DockviewReact
        components={components}
        theme={themeDark}
        popoutUrl={getPopoutUrl()}
        onReady={onReady}
      />
    </div>
  );
}
