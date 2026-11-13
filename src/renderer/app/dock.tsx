import { useEffect, useState } from 'react';
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react';
import { MapsPanel } from '../panels/MapsPanel';
import { MapView } from '../render/MapView';

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
  map: MapView,
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
