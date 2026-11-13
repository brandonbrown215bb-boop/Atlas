import type { DockviewApi, IDockviewPanelProps } from 'dockview-react';
import { InspectorPanel } from '../panels/InspectorPanel';
import { LayersPanel } from '../panels/LayersPanel';
import { MapsPanel } from '../panels/MapsPanel';
import { PanelHeaderBar } from '../panels/PanelHeaderBar';
import { SettingsPanel } from '../panels/SettingsPanel';
import { MapView } from '../render/MapView';

export interface MapPanelParams {
  mapId?: string;
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
  layers: LayersPanel,
  inspector: InspectorPanel,
  places: StubPanel('Places'),
  settings: SettingsPanel,
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
