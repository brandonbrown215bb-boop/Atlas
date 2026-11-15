import type { DockviewApi } from 'dockview-react';
import { recoverablePanel } from './PanelErrorBoundary';
import { InspectorPanel } from '../panels/InspectorPanel';
import { LayersPanel } from '../panels/LayersPanel';
import { MapsPanel } from '../panels/MapsPanel';
import { PlacesPanel } from '../panels/PlacesPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { AssetsPanel } from '../panels/AssetsPanel';
import { GeneratorPanel } from '../panels/GeneratorPanel';
import { MapView } from '../render/MapView';

export interface MapPanelParams {
  mapId?: string;
}

export const panelComponents = {
  map: recoverablePanel(MapView),
  maps: recoverablePanel(MapsPanel),
  layers: recoverablePanel(LayersPanel),
  inspector: recoverablePanel(InspectorPanel),
  places: recoverablePanel(PlacesPanel),
  settings: recoverablePanel(SettingsPanel),
  assets: recoverablePanel(AssetsPanel),
  generator: recoverablePanel(GeneratorPanel),
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
