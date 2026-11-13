import type { DockviewApi } from 'dockview-react';
import { InspectorPanel } from '../panels/InspectorPanel';
import { LayersPanel } from '../panels/LayersPanel';
import { MapsPanel } from '../panels/MapsPanel';
import { PlacesPanel } from '../panels/PlacesPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { MapView } from '../render/MapView';

export interface MapPanelParams {
  mapId?: string;
}

export const panelComponents = {
  map: MapView,
  maps: MapsPanel,
  layers: LayersPanel,
  inspector: InspectorPanel,
  places: PlacesPanel,
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
