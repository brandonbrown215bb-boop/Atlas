import { useEffect, useState } from 'react';
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';

export interface MapPanelParams {
  mapId?: string;
}

function PanelHeaderBar(props: {
  title: string;
  panelProps: IDockviewPanelProps;
}) {
  const [isPopout, setIsPopout] = useState(
    () => props.panelProps.api.location.type === 'popout',
  );

  useEffect(() => {
    const disposable = props.panelProps.api.onDidLocationChange((event) => {
      setIsPopout(event.location.type === 'popout');
    });
    return () => disposable.dispose();
  }, [props.panelProps.api]);

  const handlePopout = () => {
    const panel = props.panelProps.containerApi.getPanel(props.panelProps.api.id);
    if (panel) {
      void props.panelProps.containerApi.addPopoutGroup(panel);
    }
  };

  const handleDockBack = () => {
    const mainGroup = props.panelProps.containerApi.groups.find(
      (g) => g.api.location.type === 'grid',
    );
    if (mainGroup) {
      props.panelProps.api.moveTo({ group: mainGroup });
    }
  };

  return (
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
      <strong>{props.title}</strong>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {!isPopout ? (
          <button
            type="button"
            data-testid={`popout-btn-${props.panelProps.api.id}`}
            onClick={handlePopout}
          >
            Pop out
          </button>
        ) : (
          <button
            type="button"
            data-testid={`dockback-btn-${props.panelProps.api.id}`}
            onClick={handleDockBack}
          >
            Dock back
          </button>
        )}
      </div>
    </div>
  );
}

function MapPlaceholderPanel(props: IDockviewPanelProps<MapPanelParams>) {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const mapId = props.params.mapId ?? activeMapId;
  const map = mapId && world ? world.maps[mapId] : undefined;

  return (
    <div
      data-testid={`panel-${props.api.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--atlas-bg)',
        color: 'var(--atlas-text)',
      }}
    >
      <PanelHeaderBar title={map ? map.name : 'Map View'} panelProps={props} />
      <div style={{ padding: 16, fontSize: 13, color: 'var(--atlas-text-muted)' }}>
        {map ? (
          <div>
            <div>Kind: {map.kind}</div>
            <div>Entities: {Object.keys(map.entities).length}</div>
          </div>
        ) : (
          <div>Open or create a world to begin.</div>
        )}
      </div>
    </div>
  );
}

function MapsPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);

  return (
    <div
      data-testid={`panel-${props.api.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--atlas-bg)',
        color: 'var(--atlas-text)',
      }}
    >
      <PanelHeaderBar title="Maps" panelProps={props} />
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {world ? (
          world.meta.maps.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => worldStore.getState().setActiveMap(m.id)}
              style={{
                textAlign: 'left',
                borderColor:
                  m.id === activeMapId ? 'var(--atlas-accent)' : 'var(--atlas-border)',
              }}
            >
              {m.name} ({m.kind})
            </button>
          ))
        ) : (
          <span style={{ fontSize: 12, color: 'var(--atlas-text-muted)' }}>
            No world open
          </span>
        )}
      </div>
    </div>
  );
}

function StubPanel(title: string) {
  return function StubPanelComponent(props: IDockviewPanelProps) {
    return (
      <div
        data-testid={`panel-${props.api.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: 'var(--atlas-bg)',
          color: 'var(--atlas-text)',
        }}
      >
        <PanelHeaderBar title={title} panelProps={props} />
        <div style={{ padding: 12, fontSize: 12, color: 'var(--atlas-text-muted)' }}>
          {title} panel
        </div>
      </div>
    );
  };
}

export const panelComponents = {
  map: MapPlaceholderPanel,
  maps: MapsPanel,
  layers: StubPanel('Layers'),
  inspector: StubPanel('Inspector'),
  places: StubPanel('Places'),
};

export type PanelComponentKey = keyof typeof panelComponents;

export function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  const mapsPanel = api.addPanel({
    id: 'maps',
    component: 'maps',
    title: 'Maps',
  });
  const mapPanel = api.addPanel({
    id: 'map-main',
    component: 'map',
    title: 'Map',
    params: {},
    position: { referencePanel: mapsPanel, direction: 'right' },
  });
  api.addPanel({
    id: 'layers',
    component: 'layers',
    title: 'Layers',
    position: { referencePanel: mapPanel, direction: 'right' },
  });
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: 'layers', direction: 'below' },
  });
  mapsPanel.api.setSize({ width: 220 });
}
